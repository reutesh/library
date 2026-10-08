import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהתחברות');
      setBusy(false);
    }
  };

  return (
    <div id="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>📚 מנהל ספרייה</h1>
        <p className="login-subtitle">התחברות למערכת</p>
        <div className="form-group">
          <label htmlFor="login-username">שם משתמש</label>
          <input
            id="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">סיסמה</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'מתחבר...' : 'התחברות'}
        </button>
      </form>
    </div>
  );
}