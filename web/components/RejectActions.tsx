'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../lib/api';

const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: 'התחל טיפול',
  WAITING_MANUFACTURER: 'שלח ליצרן',
  WAITING_CUSTOMER: 'פנייה ללקוח',
  ESCALATED: 'הסלם למנהל',
  RESOLVED: 'סמן כפתור',
  DISMISSED: 'דחה',
};

const STATUS_VARIANT: Record<string, string> = {
  RESOLVED: 'btn-primary',
  ESCALATED: 'btn-danger',
};

export function RejectActions({ rejectId, allowed }: { rejectId: string; allowed: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mfrKey, setMfrKey] = useState('MGD');

  async function go(to: string) {
    setBusy(to);
    setError(null);
    try {
      await api.transitionReject(rejectId, {
        to,
        by: 'ref-ui',
        note: note || undefined,
        manufacturerKey: to === 'WAITING_MANUFACTURER' ? mfrKey : undefined,
        resolutionSummary: to === 'RESOLVED' ? (note || 'נפתר') : undefined,
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label-text">הערה / סיכום פתרון (אופציונלי)</span>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="…"
          className="input min-h-[60px]" rows={2}
        />
      </label>
      {allowed.includes('WAITING_MANUFACTURER') && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-600 font-medium">קוד יצרן ל-SLA:</span>
          <select value={mfrKey} onChange={(e) => setMfrKey(e.target.value)} className="input py-1.5 w-auto">
            <option>MGD</option><option>HRL</option><option>CLAL</option><option>PHNX</option>
            <option>MNRH</option><option>ALTS</option><option>MTDS</option><option>MOR</option><option>AMIT</option>
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {allowed.map((s) => (
          <button
            key={s}
            disabled={busy !== null}
            onClick={() => go(s)}
            className={STATUS_VARIANT[s] ?? 'btn-secondary'}
          >
            {busy === s ? 'מבצע…' : STATUS_LABELS[s] ?? s}
          </button>
        ))}
      </div>
      {error && (
        <div className="text-sm text-danger-700 bg-danger-50 ring-1 ring-danger-100 rounded-lg p-2.5 animate-fade-in">
          {error}
        </div>
      )}
    </div>
  );
}
