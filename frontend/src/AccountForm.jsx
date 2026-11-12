import React, { useEffect, useRef, useState } from 'react';

export default function AccountForm({ onAuthenticate, initialResetToken = '', onResetComplete, onExitRecovery }) {
  const [mode, setMode] = useState(() => initialResetToken || new URLSearchParams(window.location.search).has('reset_token')
    ? 'reset' : new URLSearchParams(window.location.search).has('forgot-password') ? 'recover' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resetToken, setResetToken] = useState(() => initialResetToken || new URLSearchParams(window.location.search).get('reset_token') || '');
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const notice = useRef(null);
  const registration = mode === 'register';
  const recovery = mode === 'recover';
  const resetting = mode === 'reset';

  useEffect(() => {
    if (!initialResetToken && !new URLSearchParams(window.location.search).has('reset_token')) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [initialResetToken]);

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setError('');
    setMessage('');
    setPassword('');
    setConfirm('');
    if (next !== 'reset') setResetToken('');
    setShowPassword(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    if (next === 'recover') url.searchParams.set('forgot-password', '1');
    else url.searchParams.delete('forgot-password');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    if (next === 'login') onExitRecovery?.();
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError('');
    setPending(true);
    try {
      if ((registration || resetting) && password !== confirm) throw new Error('The passwords must match.');
      if (recovery) {
        const response = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reef-Request': '1' }, body: JSON.stringify({ email: email.trim() }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Unable to request a reset.');
        setMode('reset');
        setResetToken(result.development_token || '');
        setMessage(result.development_token
          ? 'Development reset code loaded. Choose a new password.'
          : result.delivery_configured
            ? 'If an account matches that email, a secure reset link has been sent. Enter the code from the email below.'
            : 'Request accepted. Email delivery is not configured on this installation; ask the administrator to configure recovery email.');
        const url = new URL(window.location.href);
        url.searchParams.delete('forgot-password');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        return;
      }
      if (resetting) {
        const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reef-Request': '1' }, body: JSON.stringify({ token: resetToken.trim(), new_password: password }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Unable to reset the password.');
        setMode('login'); setPassword(''); setConfirm(''); setResetToken(''); setMessage(result.message);
        if (onResetComplete) onResetComplete(result.message);
        return;
      }
      const values = { email: email.trim(), password };
      if (registration) values.name = name.trim();
      await onAuthenticate(mode, values);
    } catch (problem) {
      setError(problem.message);
      requestAnimationFrame(() => notice.current?.focus());
    } finally {
      setPending(false);
    }
  }

  return <section className="panel account-panel" aria-labelledby="account-title">
    {!recovery && !resetting && <div className="account-tabs" role="group" aria-label="Account options">
      <button className="button" type="button" aria-pressed={!registration} disabled={pending} onClick={() => switchMode('login')}>Sign in</button>
      <button className="button" type="button" aria-pressed={registration} disabled={pending} onClick={() => switchMode('register')}>Sign up</button>
    </div>}
    {(recovery || resetting) && <ol className="recovery-progress" aria-label="Password recovery progress">
      <li className={recovery ? 'current' : 'complete'}><span>{recovery ? '1' : '✓'}</span> Verify email</li>
      <li className={resetting ? 'current' : ''}><span>2</span> New password</li>
    </ol>}
    <h2 id="account-title">{registration ? 'Create your account' : recovery ? 'Reset your password' : resetting ? 'Choose a new password' : 'Sign in to your workspace'}</h2>
    <p>{registration ? 'Create an account to start your private catch register.' : recovery ? 'Enter your account email. We never reveal whether an address is registered.' : resetting ? 'Enter the one-time token and a secure new passphrase.' : 'Open your photo workspace and saved catches.'}</p>
    <form className="fields" onSubmit={submit} aria-busy={pending}>
      {error && <div className="alert" role="alert" tabIndex={-1} ref={notice}>{error}</div>}
      {message && <div className="success" role="status">{message}</div>}
      {registration && <label>Name<input required autoComplete="name" maxLength={80} value={name}
        onChange={event => setName(event.target.value)} /></label>}
      {!resetting && <label>Email address<input required type="email" autoComplete="username" maxLength={254}
        value={email} onChange={event => setEmail(event.target.value)} /></label>}
      {resetting && <label>One-time reset code<input required autoFocus autoComplete="one-time-code" minLength={32} maxLength={256}
        placeholder="Paste the code from your email" value={resetToken} onChange={event => setResetToken(event.target.value.trim())} /></label>}
      {!recovery && <label>{resetting ? 'New password' : 'Password'}<input required type={showPassword ? 'text' : 'password'}
        autoComplete={(registration || resetting) ? 'new-password' : 'current-password'} minLength={(registration || resetting) ? 15 : undefined}
        maxLength={128} aria-describedby={(registration || resetting) ? 'password-help' : undefined}
        value={password} onChange={event => setPassword(event.target.value)} /></label>}
      {(registration || resetting) && <>
        <p className="password-help" id="password-help">Use at least 15 characters. A memorable passphrase is fine.</p>
        <label>Confirm password<input required type={showPassword ? 'text' : 'password'}
          autoComplete="new-password" maxLength={128} value={confirm}
          onChange={event => setConfirm(event.target.value)} /></label>
        {resetting && <div className="password-rules" aria-live="polite">
          <span className={password.length >= 15 ? 'done' : ''}>{password.length >= 15 ? '✓' : '○'} At least 15 characters</span>
          <span className={confirm && password === confirm ? 'done' : ''}>{confirm && password === confirm ? '✓' : '○'} Passwords match</span>
        </div>}
      </>}
      {!recovery && <label className="checkbox"><input type="checkbox" checked={showPassword}
        onChange={event => setShowPassword(event.target.checked)} /> Show password</label>
      }
      <button className="button primary" type="submit" disabled={pending}>
        {pending ? 'Please wait…' : registration ? 'Create account' : recovery ? 'Request reset' : resetting ? 'Reset password' : 'Sign in'}
      </button>
      {!registration && !recovery && !resetting && <button className="text-button account-recovery" type="button" onClick={() => switchMode('recover')}>Forgot password?</button>}
      {(recovery || resetting) && <button className="text-button account-recovery" type="button" onClick={() => switchMode('login')}>Back to sign in</button>}
      {resetting && email && <button className="text-button account-recovery" type="button" onClick={() => switchMode('recover')}>Send another reset link</button>}
    </form>
  </section>;
}
