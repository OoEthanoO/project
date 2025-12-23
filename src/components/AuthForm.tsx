import { FormEvent, useState } from 'react';

type Props = {
  onLogin: (email: string, password: string, remember: boolean) => Promise<void> | void;
  onRegister: (email: string, password: string, name: string, remember: boolean) => Promise<void> | void;
};

const AuthForm = ({ onLogin, onRegister }: Props) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
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

  return (
    <div className="panel" style={{ maxWidth: 420, margin: '40px auto', paddingBottom: 20 }}>
      <div className="header">
        <div>
          <p className="title">{mode === 'login' ? 'Sign in' : 'Create account'}</p>
          <p className="muted">Access your planner with email + password.</p>
        </div>
      </div>
      <form className="task-card" onSubmit={handleSubmit} style={{ borderStyle: 'dashed' }}>
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
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} id="remember" />
          <label htmlFor="remember" className="muted">
            Remember me
          </label>
        </div>
        {info && (
          <p className="muted" style={{ color: '#5bd0ff', marginTop: 8, fontWeight: 600 }}>
            {info}
          </p>
        )}
        {error && (
          <p className="muted" style={{ color: '#f88', marginTop: 8 }}>
            {error}
          </p>
        )}
        <div className="task-actions" style={{ marginTop: 12 }}>
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
            }}
          >
            {mode === 'login' ? 'Need an account?' : 'Have an account?'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AuthForm;
