'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '../../lib/api';

const DEMO_USERS = [
  { email: 'operator@demo.local', password: 'operator123', role: 'OPERATOR — רפרנט (ת.ז. מוסתרת)' },
  { email: 'manager@demo.local',  password: 'manager123',  role: 'MANAGER — מנהל סוכנות (גישה מלאה)' },
  { email: 'auditor@demo.local',  password: 'auditor123',  role: 'AUDITOR — בקר רגולציה' },
  { email: 'regulator@demo.local', password: 'regulator123', role: 'REGULATOR — גורם רגולטורי' },
];

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [email, setEmail] = useState('manager@demo.local');
  const [password, setPassword] = useState('manager123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { token } = await authApi.login(email, password);
      document.cookie = `pension_jwt=${encodeURIComponent(token)}; path=/; max-age=${12 * 3600}; samesite=lax`;
      router.push(next);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function quickLogin(u: { email: string; password: string }) {
    setEmail(u.email);
    setPassword(u.password);
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center -mt-6">
      <div className="card p-8 max-w-md w-full space-y-6 animate-fade-in shadow-soft-lg">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 grid place-items-center text-white text-sm font-bold shadow-soft">
            ת״פ
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-900 tracking-tight">תפעול פנסיוני</h1>
            <p className="text-xs muted mt-0.5">נדרשת הזדהות לכניסה למערכת</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="label-text">דוא&quot;ל</span>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="input" autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="label-text">סיסמה</span>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="input" autoComplete="current-password"
            />
          </label>
          {error && (
            <div className="text-sm text-danger-700 bg-danger-50 ring-1 ring-danger-100 rounded-lg p-2.5 animate-fade-in">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'מאמת…' : 'כניסה'}
          </button>
        </form>

        <div className="border-t border-ink-100 pt-4">
          <div className="text-xs muted mb-2">משתמשי דמו (לחץ למילוי מהיר):</div>
          <ul className="space-y-1">
            {DEMO_USERS.map((u) => (
              <li key={u.email}>
                <button
                  type="button" onClick={() => quickLogin(u)}
                  className="w-full text-right text-xs text-ink-700 hover:bg-ink-50 px-2.5 py-2 rounded-md transition-colors"
                >
                  <div className="font-mono text-ink-900">{u.email}</div>
                  <div className="text-ink-500 mt-0.5">{u.role}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
