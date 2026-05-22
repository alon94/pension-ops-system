import Link from 'next/link';
import { StatusBadge } from '../../components/Badge';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';

export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<string, string> = {
  AGENT_AUTOMATED: 'A6 — זיהוי אוטומטי',
  SALARY_REPORT: 'דוח שכר',
  CLEARING: 'מסלקה',
  MANUAL: 'ידני',
};

type KpiTone = 'warning' | 'success' | 'neutral';

export default async function TerminationsPage() {
  const [active, completed] = await Promise.all([
    api.terminations(),
    api.terminations('COMPLETED'),
  ]);
  const awaitingForm = active.filter((t) => t.formsCount === 0).length;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">סיומי עבודה וטופס 161</h1>
          <p className="muted text-sm mt-1">זיהוי, תיעוד, ואישור סיומי עבודה — פרק 8 באפיון.</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Kpi label="אירועים פעילים" value={active.length} tone={active.length > 0 ? 'warning' : 'success'} />
        <Kpi label="ממתינים לטופס 161" value={awaitingForm} tone={awaitingForm > 0 ? 'warning' : 'neutral'} />
        <Kpi label="הסתיימו" value={completed.length} tone="success" />
      </div>

      <section className="space-y-3">
        <h2 className="section-title">אירועים פעילים</h2>
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>לקוח</th>
                <th>סטטוס</th>
                <th>מקור זיהוי</th>
                <th>תאריך סיום</th>
                <th>טפסי 161</th>
                <th>זוהה</th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center muted">אין אירועי סיום עבודה פעילים</td></tr>
              )}
              {active.map((t) => (
                <tr key={t.terminationEventId}>
                  <td>
                    <Link href={`/terminations/${t.terminationEventId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">
                      {t.customerName ?? '—'}
                    </Link>
                    {t.customerIsraelId && <div className="text-xs muted mt-0.5">ת.ז. {t.customerIsraelId}</div>}
                  </td>
                  <td><StatusBadge value={t.status} /></td>
                  <td className="text-xs text-ink-600">{SOURCE_LABELS[t.detectionSource] ?? t.detectionSource}</td>
                  <td>
                    {t.confirmedTerminationDate ? fmtDate(t.confirmedTerminationDate) : <span className="text-ink-400">—</span>}
                  </td>
                  <td>
                    {t.formsCount === 0 ? (
                      <span className="badge bg-warning-50 text-warning-700 ring-warning-100">אין טופס</span>
                    ) : (
                      <span className="text-sm">
                        <span className="font-medium text-ink-800">{t.formsCount}</span>
                        {t.latestFormStatus && (
                          <span className="text-xs muted mr-1.5">({t.latestFormStatus})</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="text-xs muted">{fmtDateTime(t.detectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title text-ink-600">היסטוריה (הסתיימו)</h2>
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>לקוח</th>
                  <th>תאריך סיום</th>
                  <th>סטטוס טופס 161 אחרון</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((t) => (
                  <tr key={t.terminationEventId}>
                    <td>
                      <Link href={`/customers/${t.customerId}`} className="text-ink-800 hover:text-brand-700 hover:underline font-medium">
                        {t.customerName ?? '—'}
                      </Link>
                    </td>
                    <td>{fmtDate(t.confirmedTerminationDate)}</td>
                    <td className="text-ink-600">{t.latestFormStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="card p-5">
        <div className="font-medium text-ink-900 mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-info-600" />
          SLA — שלבי תהליך (§8.3)
        </div>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-ink-700">
          <li>זיהוי וודאות — יום 0–7</li>
          <li>איסוף מסמכים (טופס 161 חתום, אישור פיטורים) — יום 7–30</li>
          <li>החלטות הלקוח (פדיון / קיבוע / המשכיות / העברה) — יום 30–90</li>
          <li>ביצוע דרך היצרן — יום 90+</li>
        </ol>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: KpiTone }) {
  const t = {
    warning: { text: 'text-warning-700', bar: 'bg-warning-500' },
    success: { text: 'text-success-700', bar: 'bg-success-500' },
    neutral: { text: 'text-ink-800',     bar: 'bg-ink-300' },
  }[tone];
  return (
    <div className="card relative overflow-hidden p-5">
      <div className={`absolute top-0 right-0 h-full w-1 ${t.bar}`} />
      <div className="text-xs muted font-medium">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${t.text} tabular-nums`}>{value}</div>
    </div>
  );
}
