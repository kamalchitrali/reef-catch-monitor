# Deployment guide

Reef Catch Monitor can run locally with SQLite or on a small Linux server with PostgreSQL. Build the React frontend before starting FastAPI in a production-style setup because FastAPI serves the generated `frontend/dist` files.

## Environment variables

Start from `.env.example`, but do not commit a real environment file. The application reads variables from its process environment; production values belong in a protected service environment file or secret manager.

| Variable | Purpose |
| --- | --- |
| `REEF_DATA_DIR` | Writable directory for SQLite and local model artifacts. |
| `REEF_DATABASE_URL` | PostgreSQL connection URL. Omit it to use SQLite. |
| `REEF_SMTP_HOST`, `REEF_SMTP_PORT`, `REEF_SMTP_USER`, `REEF_SMTP_PASSWORD` | Optional password-recovery email transport. |
| `REEF_SMTP_FROM` | Sender shown on recovery email. |
| `REEF_RESET_BASE_URL` | Public HTTPS application URL used in reset links. |
| `REEF_DEV_SHOW_RESET_TOKEN` | Local development aid only. Never enable in production. |

Use a generated database password and URL-encode special characters placed inside a PostgreSQL URL. Restrict environment files to the service account.

## Local development

Requirements: Python 3.11 or newer and Node.js 22 or newer.

```bash
git clone https://github.com/kamalchitrali/reef-catch-monitor.git
cd reef-catch-monitor
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
```

Run FastAPI in one terminal:

```bash
source .venv/bin/activate
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Run Vite in a second terminal:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. SQLite data is created in `data/`, which is ignored by Git.

## Local production-style build

This serves the compiled frontend and API from the same Uvicorn process:

```bash
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Keep Uvicorn bound to `127.0.0.1` when it sits behind a reverse proxy. Binding to `0.0.0.0` exposes it to the local network and should be protected by a firewall.

To test PostgreSQL locally, set `POSTGRES_PASSWORD` and start the included database:

```bash
export POSTGRES_PASSWORD='replace-with-a-generated-password'
docker compose up -d postgres
export REEF_DATABASE_URL='postgresql://reef_user:replace-with-a-generated-password@127.0.0.1:5432/reef_catch'
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Common Ubuntu server setup

The AWS and DigitalOcean paths share these application steps. Use a current Ubuntu LTS image, install Python, Nginx, Git, and Node.js 22, then create a non-login service account:

```bash
sudo useradd --system --create-home --home-dir /opt/reef-catch-monitor --shell /usr/sbin/nologin reefcatch
sudo git clone https://github.com/kamalchitrali/reef-catch-monitor.git /opt/reef-catch-monitor/app
sudo chown -R reefcatch:reefcatch /opt/reef-catch-monitor
sudo -u reefcatch python3 -m venv /opt/reef-catch-monitor/app/.venv
sudo -u reefcatch /opt/reef-catch-monitor/app/.venv/bin/pip install -r /opt/reef-catch-monitor/app/backend/requirements.txt
sudo -u reefcatch npm --prefix /opt/reef-catch-monitor/app/frontend ci
sudo -u reefcatch npm --prefix /opt/reef-catch-monitor/app run build
sudo install -d -o reefcatch -g reefcatch -m 750 /var/lib/reef-catch-monitor
```

Create `/etc/reef-catch-monitor.env` with `REEF_DATABASE_URL`, `REEF_DATA_DIR=/var/lib/reef-catch-monitor`, the public `REEF_RESET_BASE_URL`, and optional SMTP settings. Protect it with `root:reefcatch` ownership and mode `640`.

The supplied service matches the `/opt/reef-catch-monitor/app` layout above. Install the service and Nginx configuration from the repository:

```bash
cd /opt/reef-catch-monitor/app
sudo cp deploy/reef-catch.service /etc/systemd/system/reef-catch.service
sudo cp deploy/nginx.conf /etc/nginx/sites-available/reef-catch-monitor
sudo ln -s /etc/nginx/sites-available/reef-catch-monitor /etc/nginx/sites-enabled/reef-catch-monitor
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now reef-catch
sudo systemctl reload nginx
```

Replace `catch.example.org` in the Nginx file with the real domain. Issue an HTTPS certificate before accepting credentials. For example, use Certbot's Nginx integration, then verify `https://your-domain.example/api/health`.

## AWS

A practical small deployment uses one EC2 instance for Nginx/FastAPI and Amazon RDS for PostgreSQL.

1. Create a VPC with an EC2 instance in a public subnet and RDS PostgreSQL in private subnets. Do not make RDS publicly accessible.
2. Allow inbound TCP 80 and 443 to the EC2 security group. Restrict TCP 22 to a trusted administrator IP or use AWS Systems Manager Session Manager instead.
3. Allow PostgreSQL TCP 5432 on the RDS security group only from the EC2 security group.
4. Attach an encrypted EBS volume, use an Elastic IP if needed, and point the DNS record at the instance or load balancer.
5. Follow **Common Ubuntu server setup**. Put the RDS connection URL in `/etc/reef-catch-monitor.env`; use `sslmode=require` when required by the database policy.
6. Use an Application Load Balancer plus AWS Certificate Manager for managed TLS, or terminate TLS with Nginx and Certbot on the instance. When using a load balancer, accept forwarded headers only from the trusted proxy path.
7. Store backups with RDS automated backups and snapshots. Back up the data directory separately because it can contain the trained model. Use Amazon SES or another authenticated SMTP provider for password recovery.

For production hardening, store secrets in AWS Systems Manager Parameter Store or Secrets Manager and inject them at service startup rather than leaving database credentials in a general-purpose shell profile.

## DigitalOcean

A practical setup uses an Ubuntu Droplet and a DigitalOcean Managed PostgreSQL cluster.

1. Create a Droplet in the same region/VPC as the database. Add an SSH key and disable password-based SSH after confirming key access.
2. In Cloud Firewalls, allow inbound 80 and 443 from the internet and restrict 22 to trusted administrator addresses.
3. Add only the Droplet or its VPC as a trusted source for the managed database. Do not expose PostgreSQL broadly.
4. Follow **Common Ubuntu server setup** and place the managed database connection URL in `/etc/reef-catch-monitor.env`. Keep the provider's TLS parameters, including `sslmode=require`.
5. Point the domain at the Droplet, replace the example Nginx server name, and enable HTTPS with Certbot before allowing sign-in.
6. Enable managed database backups and Droplet backups or snapshots. Independently back up `/var/lib/reef-catch-monitor` and verify restoration.

DigitalOcean Spaces can hold separately managed original research photos, but the current application stores its normalized upload inside the database. Do not move application records to object storage without an explicit schema and migration change.

## Release and operations checklist

- Run `python -m pytest` and `npm run build` before deployment.
- Back up the database and data directory before upgrading.
- Pull the release, reinstall changed dependencies, rebuild the frontend, and restart `reef-catch`.
- Start the application once with a single process so forward-only migrations complete before adding workers.
- Check `systemctl status reef-catch`, Nginx logs, and `/api/health` after every release.
- Keep PostgreSQL private, require HTTPS, and never enable `REEF_DEV_SHOW_RESET_TOKEN` outside local development.
- Schedule encrypted backups and test a restore regularly.
