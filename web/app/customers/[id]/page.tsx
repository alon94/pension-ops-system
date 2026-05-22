import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AiBriefing } from '../../../components/AiBriefing';
import { SeverityBadge, StatusBadge } from '../../../components/Badge';
import { api } from '../../../lib/api';
import { fmtDate, fmtDateTime, fmtIls, fmtMonth } from '../../../lib/format';

export const dynamic = 'force-dynamic';

const FLAG_LABELS: Record<string, string> = {
  OPEN_REJECT_HIGH: 'יש ריג\'קט פתוח ברמת HIGH+',
  STALE_REJECT_30D: 'ריג\'קט פתוח מעל 30 יום',
  MULTIPLE_REJECTS: 'יותר מ-3 ריג\'קטים פעילים',
};

export default async function CustomerPage({ params }: { params: { id: string } }) {
  let data;
  try { data = await api.customer360(params.id); }
  catch { notFound(); }
  if (!data) notFound();

  const c = data.customer;
  const auth = data.authorization;
  const totalBalance = data.accounts.reduce((s, a) => s + (a.latestBalance?.total ?? 0), 0);

  return (
    <div className="space-y-8 animate-fade-in">
      <Link href="/customers" className="text-sm muted hover:text-ink-900 inline-flex items-center gap-1 transition-colors">
        <span>←</span> חזרה לחיפוש
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">{c.firstName} {c.lastName}</h1>
          <div className="text-sm muted mt-1">
            ת.ז. {c.israelId}
            {c.birthDate && ` · נולד/ה ${fmtDate(c.birthDate)}`}
            {c.city && ` · ${c.city}`}
          </div>
        </div>
        <div className="text-left">
          <div className="text-xs muted font-medium">סך נכסים פנסיוניים</div>
          <div className="text-3xl font-bold text-brand-700 tabular-nums mt-1">{fmtIls(totalBalance)}</div>
        </div>
      </div>

      {/* Risk flags */}
      {data.riskFlags.length > 0 && (
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 h-full w-1 bg-warning-500" />
          <div className="font-semibold text-warning-700 mb-2 flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            דגלי סיכון
          </div>
          <ul className="space-y-1 text-sm text-ink-800">
            {data.riskFlags.map((f) => <li key={f} className="flex items-start gap-2"><span className="text-warning-600 mt-1">•</span>{FLAG_LABELS[f] ?? f}</li>)}
          </ul>
        </div>
      )}

      <AiBriefing customerId={c.customerId} />

      <Section title="ייפוי כוח (פרק 10)">
        {auth ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="סטטוס" value={<StatusBadge value={auth.status} />} />
            <Field label="היקף" value={auth.scope} />
            <Field label="תוקף עד" value={fmtDate(auth.validTo)} />
            <Field label="ימים לפקיעה" value={
              auth.daysUntilExpiry < 30
                ? <span className="text-danger-700 font-bold tabular-nums">{auth.daysUntilExpiry}</span>
                : <span className="tabular-nums">{auth.daysUntilExpiry}</span>
            } />
          </div>
        ) : (
          <div className="text-sm text-danger-700 bg-danger-50 ring-1 ring-danger-100 rounded-lg p-3 -m-1">
            ⚠ אין ייפוי כוח פעיל — לא ניתן להגיש INQUIRY חדש
          </div>
        )}
      </Section>

      <Section title={`חשבונות (${data.accounts.length})`} unpadded>
        <table className="table">
          <thead>
            <tr>
              <th>פוליסה</th>
              <th>יצרן</th>
              <th>מוצר</th>
              <th>סטטוס</th>
              <th>נפתח</th>
              <th>יתרה אחרונה</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center muted">אין חשבונות</td></tr>
            )}
            {data.accounts.map((a) => (
              <tr key={a.accountId}>
                <td className="font-medium text-ink-900">{a.policyNumber}</td>
                <td>{a.manufacturerName} <span className="text-xs text-ink-400">({a.manufacturerCode})</span></td>
                <td className="text-ink-600">{a.productCode ?? '—'}</td>
                <td className="text-ink-600">{a.currentStatus}</td>
                <td className="text-ink-600">{fmtDate(a.openedDate)}</td>
                <td>
                  {a.latestBalance ? (
                    <>
                      <div className="font-medium text-ink-900 tabular-nums">{fmtIls(a.latestBalance.total)}</div>
                      <div className="text-xs text-ink-400 mt-0.5">לתאריך {fmtDate(a.latestBalance.snapshotDate)}</div>
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title={`הפקדות אחרונות (${data.recentDeposits.length})`}>
          {data.recentDeposits.length === 0 ? (
            <div className="text-sm muted">אין הפקדות</div>
          ) : (
            <ul className="divide-y divide-ink-100 -my-2">
              {data.recentDeposits.map((d, i) => (
                <li key={i} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-ink-900">{fmtMonth(d.depositMonth)}</div>
                    <div className="text-xs muted mt-0.5">פוליסה {d.policyNumber}</div>
                  </div>
                  <div className="font-medium text-ink-800 tabular-nums">{fmtIls(d.total)}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`אירועי סיום עבודה (${data.terminations.length})`}>
          {data.terminations.length === 0 ? (
            <div className="text-sm muted">אין אירועי סיום עבודה</div>
          ) : (
            <ul className="divide-y divide-ink-100 -my-2">
              {data.terminations.map((t) => (
                <li key={t.terminationEventId} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <StatusBadge value={t.status} />
                    <div className="text-xs muted">{fmtDate(t.detectedAt)}</div>
                  </div>
                  {t.confirmedTerminationDate && (
                    <div className="text-xs muted mt-1">סיום בפועל: {fmtDate(t.confirmedTerminationDate)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title={`ריג'קטים (${data.rejects.length})`}>
        {data.rejects.length === 0 ? (
          <div className="text-sm muted">אין ריג&apos;קטים</div>
        ) : (
          <ul className="divide-y divide-ink-100 -my-2">
            {data.rejects.map((r) => (
              <li key={r.rejectId} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <Link href={`/rejects/${r.rejectId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">
                    {r.rejectCode}
                  </Link>
                  <SeverityBadge value={r.severity} />
                  <StatusBadge value={r.status} />
                </div>
                <div className="text-xs muted">{fmtDateTime(r.detectedAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children, unpadded = false }: { title: string; children: React.ReactNode; unpadded?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="section-title">{title}</h2>
      <div className={`card overflow-hidden ${unpadded ? '' : 'p-5'}`}>{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs muted font-medium">{label}</div>
      <div className="mt-1 text-ink-900 text-sm">{value}</div>
    </div>
  );
}
