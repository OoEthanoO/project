import { FormEvent, useState } from 'react';

type Props = {
  onLogin: (email: string, password: string, remember: boolean) => Promise<void> | void;
  onRegister: (email: string, password: string, name: string, remember: boolean) => Promise<void> | void;
  onResendVerification?: (email: string) => Promise<string | void> | string | void;
  notice?: string;
  onClearNotice?: () => void;
};

const AuthForm = ({ onLogin, onRegister, onResendVerification, notice, onClearNotice }: Props) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resendBusy, setResendBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    onClearNotice?.();
    if (!email.trim() || !password.trim()) {
      setError('Email and password required');
      return;
    }
    try {
      if (mode === 'login') {
        await onLogin(email.trim(), password.trim(), remember);
        setInfo('');
      } else {
        if (!name.trim()) {
          setError('Name required');
          return;
        }
        await onRegister(email.trim(), password.trim(), name.trim(), remember);
        setMode('login');
        setInfo('Check your email to confirm your account, then sign in.');
      }
    } catch (err) {
      const message = (err as Error).message || 'Login failed';
      if (message.toLowerCase().includes('verify your email')) {
        setInfo('We sent a verification email. Please confirm your address, then sign in.');
        setError('');
      } else {
        setError(message);
      }
    }
  };

  const handleResend = async () => {
    if (!email.trim() || !onResendVerification) return;
    setError('');
    setInfo('');
    setResendBusy(true);
    try {
      const message = await onResendVerification(email.trim());
      setInfo(message || 'If that email exists, a verification email has been sent.');
    } catch (err) {
      setError((err as Error).message || 'Failed to resend verification email');
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-hero">
        <div className="auth-brand">YanPlanner</div>
        <p className="auth-tagline">Turn assignments and exams into a day-by-day plan.</p>
        <p className="auth-intro">
          Capture tasks, attach materials, and let the planner surface the best next step for today.
        </p>
        <div className="auth-highlights">
          <div className="auth-highlight">
            <p className="auth-highlight-title">Stay organized</p>
            <p className="auth-highlight-text">Tasks, notes, and files in one place.</p>
          </div>
          <div className="auth-highlight">
            <p className="auth-highlight-title">Plan faster</p>
            <p className="auth-highlight-text">Generate one focused subtask at a time.</p>
          </div>
          <div className="auth-highlight">
            <p className="auth-highlight-title">Keep momentum</p>
            <p className="auth-highlight-text">See what is next without the stress.</p>
          </div>
        </div>
      </div>
      <div className="panel auth-panel">
        <div className="auth-panel-header">
          <p className="title auth-title">{mode === 'login' ? 'Sign in' : 'Create account'}</p>
          <p className="muted auth-subtitle">Access your planner with email and password.</p>
        </div>
        <form className="task-card auth-form" onSubmit={handleSubmit}>
          {notice && (
            <div className="muted" style={{ color: '#5bd0ff', marginBottom: 10, fontWeight: 600 }}>
              {notice}
            </div>
          )}
          <div className="form-row">
            <div>
              <label className="muted">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode === 'register' && (
              <div>
                <label className="muted">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div>
              <label className="muted">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          <div className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              id="remember"
            />
            <label htmlFor="remember" className="muted">
              Remember me
            </label>
          </div>
          {info && (
            <p className="muted" style={{ color: '#5bd0ff', marginTop: 8, fontWeight: 600, margin: 0 }}>
              {info}
            </p>
          )}
          {error && (
            <p className="muted" style={{ color: '#f88', marginTop: 8, margin: 0 }}>
              {error}
            </p>
          )}
          <div className="task-actions auth-actions">
            <button className="primary" type="submit">
              {mode === 'login' ? 'Login' : 'Register'}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setMode((m) => (m === 'login' ? 'register' : 'login'));
                setError('');
                setInfo('');
                onClearNotice?.();
              }}
            >
              {mode === 'login' ? 'Need an account?' : 'Have an account?'}
            </button>
          </div>
          {mode === 'login' && onResendVerification && (
            <button
              className="auth-resend"
              type="button"
              onClick={handleResend}
              disabled={!email.trim() || resendBusy}
            >
              {resendBusy ? 'Sending verification email…' : 'Resend verification email'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default AuthForm;
