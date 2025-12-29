import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountUser } from '../types';

type AdminSummary = {
  adminEmail: string;
  userCount: number;
  totalBalanceCents: number;
  topBalances: { id: string; email: string; name: string | null; balanceCents: number; createdAt?: string }[];
  topupCount?: number;
  usageCount?: number;
  topupSumCents?: number;
  usageSumCents?: number;
  maxUsageCents?: number;
  recentTopups?: { id: string; userId: string; amountCents: number; createdAt: string; provider: string | null; reference: string | null; status: string }[];
};

const fmtUsd = (cents?: number) => `$${((cents || 0) / 100).toFixed(2)}`;

const AdminPanel = ({ user }: { user: AccountUser | null }) => {
  const [apiKey, setApiKey] = useState('');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isAdminUser = !!user;

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const { apiCall } = await import('../lib/api-client.js');
      const res = await apiCall('/api/admin/summary', {
        headers: {
          'x-admin-key': apiKey,
          'x-admin-email': user?.email || ''
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load');
      }
      setSummary(data);
    } catch (err) {
      setError((err as Error).message);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // auto-load if key is already present in sessionStorage
    const savedKey = sessionStorage.getItem('admin.apiKey');
    if (savedKey) {
      setApiKey(savedKey);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (apiKey) {
      sessionStorage.setItem('admin.apiKey', apiKey);
    } else {
      sessionStorage.removeItem('admin.apiKey');
    }
  }, [apiKey]);

  if (!isAdminUser) {
    return (
      <div className="panel" style={{ maxWidth: 640, margin: '40px auto' }}>
        <div className="header">
          <p className="title">Admin</p>
          <p className="muted">You must be signed in to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 960, margin: '40px auto', paddingBottom: 20 }}>
      <div className="header">
        <div>
          <p className="title">Admin dashboard</p>
          <p className="muted">Secure view of balances and recent activity.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="secondary" onClick={() => navigate('/')}>
            ← Back to planner
          </button>
          <input
            type="password"
            value={apiKey}
            placeholder="Admin API key"
            onChange={(e) => setApiKey(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button className="primary" onClick={load} disabled={!apiKey || loading}>
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
      </div>
      {error && (
        <div className="task-card" style={{ border: '1px solid #f88' }}>
          <p className="muted" style={{ color: '#f88' }}>
            {error}
          </p>
        </div>
      )}
      {summary && (
        <>
          <div className="task-card">
            <p className="task-title">Overview</p>
            <p className="muted">Users: {summary.userCount}</p>
            <p className="muted">Total balance: {fmtUsd(summary.totalBalanceCents)}</p>
            <p className="muted">
              Top-ups: {summary.topupCount ?? 0} ({fmtUsd(summary.topupSumCents)})
            </p>
            <p className="muted">
              Usage charges: {summary.usageCount ?? 0} ({fmtUsd(summary.usageSumCents)})
            </p>
            <p className="muted">Largest single charge: {fmtUsd(summary.maxUsageCents)}</p>
          </div>
          <div className="task-card">
            <p className="task-title">Top balances</p>
            <div className="muted" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 8 }}>
              <strong>Email</strong>
              <strong>Name</strong>
              <strong>Balance</strong>
            </div>
            {summary.topBalances.map((u) => (
              <div
                key={u.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 120px',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid #1f2a44'
                }}
                className="muted"
              >
                <span>{u.email}</span>
                <span>{u.name || '—'}</span>
                <span>{fmtUsd(u.balanceCents)}</span>
              </div>
            ))}
          </div>
          <div className="task-card">
            <p className="task-title">Recent top-ups</p>
            {!summary.recentTopups?.length && <p className="muted">No top-ups yet.</p>}
            {summary.recentTopups?.map((t) => (
              <div
                key={t.id}
                style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 1fr', gap: 8, padding: '6px 0' }}
                className="muted"
              >
                <span>{t.id}</span>
                <span>{fmtUsd(t.amountCents)}</span>
                <span>{new Date(t.createdAt).toLocaleString()}</span>
                <span>
                  {t.provider || 'manual'} · {t.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminPanel;
