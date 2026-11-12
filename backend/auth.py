import argparse
import hashlib
import hmac
import io
import os
import secrets
import smtplib
from contextlib import closing
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from threading import BoundedSemaphore
from time import time
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, Response, UploadFile
from PIL import ImageOps, UnidentifiedImageError
from pydantic import BaseModel, EmailStr, Field, SecretStr, TypeAdapter, ValidationError, field_validator

from .database import assign_legacy_catches, connect, init_db
from .imaging import jpeg_bytes, open_photo

SESSION_COOKIE = "reef_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
ATTEMPT_WINDOW = 10 * 60
MAX_ATTEMPTS = 20
RESET_SECONDS = 30 * 60
MAX_AVATAR_BYTES = 3 * 1024 * 1024
HASH_SLOTS = BoundedSemaphore(2)
EMAIL = TypeAdapter(EmailStr)
router = APIRouter(prefix="/api/auth")


@dataclass(frozen=True)
class User:
    id: int
    email: str
    name: str
    has_avatar: bool = False
    avatar_version: str | None = None


class Login(BaseModel):
    email: EmailStr
    password: SecretStr = Field(min_length=1, max_length=128)


class Registration(Login):
    name: str = Field(min_length=1, max_length=80)
    password: SecretStr = Field(min_length=15, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Enter your name.")
        return name


class AccountUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Enter your name.")
        return name


class PasswordChange(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=15, max_length=128)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    new_password: SecretStr = Field(min_length=15, max_length=128)


class AccountDeletion(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=128)
    confirmation: str = Field(max_length=20)

    @field_validator("confirmation")
    @classmethod
    def confirm_delete(cls, value: str) -> str:
        if value.strip().upper() != "DELETE":
            raise ValueError("Type DELETE to confirm account deletion.")
        return "DELETE"


def require_client_header(
    client_header: Annotated[str | None, Header(alias="X-Reef-Request", description="Set to 1 for write requests.")] = None,
) -> None:
    if client_header != "1":
        raise HTTPException(403, "This action requires a request from the app.")


def limit_auth_attempts(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    now = int(time())
    window = now // ATTEMPT_WINDOW
    with closing(connect()) as db, db:
        db.execute("DELETE FROM auth_attempts WHERE window < ?", (window,))
        attempts, = db.execute("""
            INSERT INTO auth_attempts (client, window, attempts) VALUES (?, ?, 1)
            ON CONFLICT(window, client) DO UPDATE SET attempts = attempts + 1
            RETURNING attempts
        """, (client, window)).fetchone()
        if attempts > MAX_ATTEMPTS:
            retry = (window + 1) * ATTEMPT_WINDOW - now
            raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.",
                                headers={"Retry-After": str(retry)})


def hash_password(password: SecretStr, salt: bytes) -> bytes:
    # Cap concurrent scrypt calls to bound the process's memory use.
    with HASH_SLOTS:
        return hashlib.scrypt(password.get_secret_value().encode("utf-8"), salt=salt,
                              n=2**15, r=8, p=3, dklen=32, maxmem=64 * 1024 * 1024)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def current_user(request: Request) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with closing(connect()) as db:
        row = db.execute("""
            SELECT users.id, users.email, users.name,
                   CASE WHEN users.avatar IS NULL THEN 0 ELSE 1 END, users.avatar_updated_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        """, (token_hash(token), int(time()))).fetchone()
    return User(*row) if row else None


def require_user(request: Request) -> User:
    user = current_user(request)
    if user is None:
        raise HTTPException(401, "Sign in to access your catch records.")
    return user


SignedInUser = Annotated[User, Depends(require_user)]
WriteAccess = [Depends(require_client_header)]


def start_session(request: Request, db, user: User) -> str:
    previous = request.cookies.get(SESSION_COOKIE)
    if previous:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(previous),))
    now = int(time())
    db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token_hash(token), user.id, now + SESSION_SECONDS))
    return token


def set_session_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                        samesite="strict", secure=request.url.scheme == "https")


@router.post("/register", status_code=201, dependencies=WriteAccess)
def register(credentials: Registration, request: Request, response: Response):
    limit_auth_attempts(request)
    email = credentials.email.casefold()
    salt = secrets.token_bytes(16)
    password_hash = hash_password(credentials.password, salt)
    with closing(connect()) as db, db:
        result = db.execute("""
            INSERT INTO users (email, name, salt, password_hash) VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO NOTHING RETURNING id
        """, (email, credentials.name, salt, password_hash))
        inserted = result.fetchone()
        if inserted is None:
            raise HTTPException(409, "An account already uses that email. Sign in instead.")
        user = User(inserted[0], email, credentials.name, False, None)
        token = start_session(request, db, user)
    set_session_cookie(request, response, token)
    return {"user": asdict(user)}


@router.post("/login", dependencies=WriteAccess)
def login(credentials: Login, request: Request, response: Response):
    limit_auth_attempts(request)
    with closing(connect()) as db:
        row = db.execute("""SELECT id, email, name,
                            CASE WHEN avatar IS NULL THEN 0 ELSE 1 END, avatar_updated_at,
                            salt, password_hash FROM users WHERE email = ?""",
                         (credentials.email.casefold(),)).fetchone()
        salt, expected = row[5:] if row else (bytes(16), bytes(32))
        matches = hmac.compare_digest(hash_password(credentials.password, salt), expected)
        if row is None or not matches:
            raise HTTPException(401, "Email or password is incorrect.")
        user = User(*row[:5])
        with db:
            token = start_session(request, db, user)
    set_session_cookie(request, response, token)
    return {"user": asdict(user)}


@router.get("/session")
def session(request: Request):
    user = current_user(request)
    return {"user": asdict(user) if user else None}


@router.patch("/account", dependencies=WriteAccess)
def update_account(payload: AccountUpdate, user: SignedInUser):
    with closing(connect()) as db, db:
        db.execute("UPDATE users SET name = ? WHERE id = ?", (payload.name, user.id))
    return {"user": asdict(User(user.id, user.email, payload.name, user.has_avatar, user.avatar_version))}


@router.get("/avatar")
def avatar(user: SignedInUser):
    with closing(connect()) as db:
        row = db.execute("SELECT avatar FROM users WHERE id = ?", (user.id,)).fetchone()
    if row is None or row[0] is None:
        raise HTTPException(404, "Profile image not found.")
    return Response(bytes(row[0]), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/avatar", dependencies=WriteAccess)
async def upload_avatar(user: SignedInUser, file: Annotated[UploadFile, File()]):
    raw = await file.read(MAX_AVATAR_BYTES + 1)
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "Profile images must be 3 MB or smaller.")
    try:
        image = open_photo(raw)
    except (OSError, ValueError, UnidentifiedImageError) as error:
        raise HTTPException(422, "Use a valid JPEG, PNG, or WebP profile image.") from error
    avatar_image = ImageOps.fit(image, (256, 256), centering=(0.5, 0.4))
    encoded = jpeg_bytes(avatar_image)
    version = datetime.now(timezone.utc).isoformat()
    with closing(connect()) as db, db:
        db.execute("UPDATE users SET avatar = ?, avatar_updated_at = ? WHERE id = ?", (encoded, version, user.id))
    return {"user": asdict(User(user.id, user.email, user.name, True, version))}


@router.delete("/avatar", dependencies=WriteAccess)
def delete_avatar(user: SignedInUser):
    with closing(connect()) as db, db:
        db.execute("UPDATE users SET avatar = NULL, avatar_updated_at = NULL WHERE id = ?", (user.id,))
    return {"user": asdict(User(user.id, user.email, user.name, False, None))}


@router.post("/change-password", dependencies=WriteAccess)
def change_password(payload: PasswordChange, user: SignedInUser, request: Request, response: Response):
    with closing(connect()) as db, db:
        salt, expected = db.execute("SELECT salt, password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
        if not hmac.compare_digest(hash_password(payload.current_password, salt), expected):
            raise HTTPException(401, "Current password is incorrect.")
        new_salt = secrets.token_bytes(16)
        db.execute("UPDATE users SET salt = ?, password_hash = ? WHERE id = ?",
                   (new_salt, hash_password(payload.new_password, new_salt), user.id))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user.id,))
        token = start_session(request, db, user)
    set_session_cookie(request, response, token)
    return {"message": "Password updated. Other sessions were signed out."}


@router.delete("/account", dependencies=WriteAccess)
def delete_account(payload: AccountDeletion, user: SignedInUser, request: Request):
    with closing(connect()) as db, db:
        row = db.execute("SELECT salt, password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
        if row is None or not hmac.compare_digest(hash_password(payload.current_password, row[0]), row[1]):
            raise HTTPException(401, "Current password is incorrect.")
        db.execute("DELETE FROM users WHERE id = ?", (user.id,))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, httponly=True, samesite="strict",
                           secure=request.url.scheme == "https")
    return response


def send_reset_email(email: str, token: str) -> bool:
    host = os.environ.get("REEF_SMTP_HOST")
    sender = os.environ.get("REEF_SMTP_FROM")
    base_url = os.environ.get("REEF_RESET_BASE_URL")
    if not all((host, sender, base_url)):
        return False
    message = EmailMessage()
    message["Subject"] = "Reset your Reef Catch Monitor password"
    message["From"] = sender
    message["To"] = email
    reset_url = f"{base_url.rstrip('/')}?reset_token={quote(token)}"
    message.set_content(
        "A password reset was requested for your Reef Catch Monitor account.\n\n"
        f"Open this secure link to choose a new password:\n{reset_url}\n\n"
        f"Or enter this one-time reset code manually:\n{token}\n\n"
        "This link expires in 30 minutes and can only be used once. If you did not request this, ignore this email."
    )
    port = int(os.environ.get("REEF_SMTP_PORT", "587"))
    username = os.environ.get("REEF_SMTP_USER")
    password = os.environ.get("REEF_SMTP_PASSWORD")
    with smtplib.SMTP(host, port, timeout=10) as smtp:
        smtp.starttls()
        if username and password:
            smtp.login(username, password)
        smtp.send_message(message)
    return True


@router.post("/forgot-password", dependencies=WriteAccess)
def forgot_password(payload: PasswordResetRequest, request: Request):
    limit_auth_attempts(request)
    token = secrets.token_urlsafe(36)
    email = payload.email.casefold()
    with closing(connect()) as db, db:
        db.execute("DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL", (int(time()),))
        row = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if row:
            db.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (row[0],))
            db.execute("INSERT INTO password_reset_tokens VALUES (?, ?, ?, NULL)",
                       (token_hash(token), row[0], int(time()) + RESET_SECONDS))
    delivered = False
    if row:
        try:
            delivered = send_reset_email(email, token)
        except (OSError, smtplib.SMTPException):
            delivered = False
    delivery_configured = bool(os.environ.get("REEF_SMTP_HOST") and os.environ.get("REEF_SMTP_FROM")
                               and os.environ.get("REEF_RESET_BASE_URL"))
    result = {"message": "If that account exists, password-reset instructions are available through the configured delivery method.",
              "delivery_configured": delivery_configured}
    if row and os.environ.get("REEF_DEV_SHOW_RESET_TOKEN") == "1":
        result["development_token"] = token
    return result


@router.post("/reset-password", dependencies=WriteAccess)
def reset_password(payload: PasswordResetConfirm, request: Request):
    limit_auth_attempts(request)
    now = int(time())
    with closing(connect()) as db, db:
        row = db.execute("""SELECT user_id FROM password_reset_tokens
                          WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL""",
                         (token_hash(payload.token), now)).fetchone()
        if row is None:
            raise HTTPException(400, "This reset token is invalid or expired.")
        salt = secrets.token_bytes(16)
        db.execute("UPDATE users SET salt = ?, password_hash = ? WHERE id = ?",
                   (salt, hash_password(payload.new_password, salt), row[0]))
        db.execute("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?", (now, token_hash(payload.token)))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (row[0],))
    return {"message": "Password reset. Sign in with your new password."}


@router.post("/logout", status_code=204, dependencies=WriteAccess)
def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with closing(connect()) as db, db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, httponly=True, samesite="strict",
                           secure=request.url.scheme == "https")
    return response


def main() -> None:
    parser = argparse.ArgumentParser(description="Assign unowned catches from the single-user app.")
    parser.add_argument("action", choices=["assign-legacy"])
    parser.add_argument("email", help="Email of the account that should receive all old catches.")
    args = parser.parse_args()
    try:
        email = EMAIL.validate_python(args.email).casefold()
        init_db()
        count = assign_legacy_catches(email)
    except ValidationError:
        parser.exit(2, "Enter a valid account email.\n")
    except ValueError as error:
        parser.exit(2, f"{error}\n")
    print(f"Assigned {count} catch record(s) to {email}.")


if __name__ == "__main__":
    main()
