'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, UserListItem } from '../lib/api';

export function UserRowActions({ user }: { user: UserListItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true); setErr(null);
    try { await api.setUserActive(user.userId, !user.active); router.refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function reset(e: React.FormEvent) {
    e.preventDefault(); if (!newPw) return;
    setBusy(true); setErr(null);
    try { await api.resetUserPassword(user.userId, newPw); setPwOpen(false); setNewPw(''); router.refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <button onClick={toggle} disabled={busy} className="btn-secondary btn-sm">
        {user.active ? 'השבת' : 'הפעל'}
      </button>
      <button onClick={() => setPwOpen(!pwOpen)} disabled={busy} className="btn-secondary btn-sm">
        אפס סיסמה
      </button>
      {pwOpen && (
        <form onSubmit={reset} className="flex gap-1 animate-fade-in">
          <input
            type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
            minLength={8} placeholder="סיסמה חדשה (8+)"
            className="input py-1 px-2 text-xs w-44"
          />
          <button type="submit" disabled={busy || newPw.length < 8} className="btn-primary btn-sm">
            אישור
          </button>
        </form>
      )}
      {err && <span className="text-xs text-danger-700">{err}</span>}
    </div>
  );
}

export function CreateUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'OPERATOR' | 'MANAGER' | 'AUDITOR' | 'REGULATOR'>('OPERATOR');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(false);
    try {
      await api.createUser({ email, password, role, fullName: fullName || undefined });
      setEmail(''); setFullName(''); setPassword(''); setOk(true);
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <label className="block">
        <span className="label-text">שם מלא</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" />
      </label>
      <label className="block">
        <span className="label-text">דוא&quot;ל *</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
      </label>
      <label className="block">
        <span className="label-text">תפקיד</span>
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className="input">
          <option value="OPERATOR">רפרנט תפעולי</option>
          <option value="MANAGER">מנהל סוכנות</option>
          <option value="AUDITOR">בקר רגולציה</option>
          <option value="REGULATOR">גורם רגולטורי</option>
        </select>
      </label>
      <label className="block">
        <span className="label-text">סיסמה ראשונית (8+) *</span>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
      </label>
      <div className="lg:col-span-4 flex items-center gap-3 pt-2 border-t border-ink-100">
        <button type="submit" disabled={busy || !email || password.length < 8} className="btn-primary">
          {busy ? 'יוצר…' : 'הוסף משתמש'}
        </button>
        {ok && <span className="text-sm text-success-700 font-medium animate-fade-in">✓ המשתמש נוצר בהצלחה</span>}
        {err && <span className="text-sm text-danger-700">{err}</span>}
      </div>
    </form>
  );
}

/** ויידג'ט שמופיע בכותרת אפליקציה — לכל משתמש לשנות סיסמה לעצמו. */
export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(false);
    try { await api.changeMyPassword(current, next); setOk(true); setCurrent(''); setNext(''); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-ghost btn-sm">שנה סיסמה</button>;
  }
  return (
    <div className="absolute top-12 left-2 card p-5 w-80 z-20 animate-fade-in">
      <div className="flex justify-between items-center mb-3">
        <div className="font-semibold text-ink-900">שינוי סיסמה</div>
        <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-900 text-lg leading-none">✕</button>
      </div>
      <form onSubmit={submit} className="space-y-2">
        <input type="password" placeholder="סיסמה נוכחית" value={current} onChange={(e) => setCurrent(e.target.value)} required className="input" />
        <input type="password" placeholder="סיסמה חדשה (8+ תווים)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} className="input" />
        <button type="submit" disabled={busy || !current || next.length < 8} className="btn-primary w-full">
          {busy ? 'משנה…' : 'אישור'}
        </button>
        {ok && <div className="text-xs text-success-700">✓ הסיסמה הוחלפה</div>}
        {err && <div className="text-xs text-danger-700">{err}</div>}
      </form>
    </div>
  );
}
