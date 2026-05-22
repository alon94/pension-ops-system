import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/format';

export const dynamic = 'force-dynamic';

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'bg-danger-50 text-danger-700 ring-danger-100',
  ERROR:    'bg-orange-50 text-orange-700 ring-orange-100',
  WARN:     'bg-warning-50 text-warning-700 ring-warning-100',
  INFO:     'bg-ink-100 text-ink-700 ring-ink-200',
};

type KpiTone = 'danger' | 'success' | 'info' | 'neutral';

export default async function IngestionRunPage({ params }: { params: { id: string } }) {
  let run;
  try { run = await api.ingestionRun(params.id); }
  catch { notFound(); }

  return (
    <div className="space-y-6 animate-fade-in">
      <Link href="/ingestion" className="text-sm muted hover:text-ink-900 inline-flex items-center gap-1 transition-colors">
        <span>←</span> חזרה לרשימת ריצות
      </Link>

      <div>
        <h1 className="page-title">{run.sourceFileName ?? 'ריצה ללא שם'}</h1>
        <div className="text-sm muted mt-1 font-mono">{run.ingestionRunId}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="סטטוס" value={run.status} tone={run.status === 'completed' ? 'success' : run.status === 'failed' || run.status === 'rolled_back' ? 'danger' : 'info'} />
        <Kpi label="רשומות גולמיות" value={run.rawCount} tone="neutral" />
        <Kpi label="שגיאות" value={run.errorCount} tone={run.criticalCount > 0 ? 'danger' : run.errorCount > 0 ? 'info' : 'success'} />
        <Kpi label="ריג'קטים שנפתחו" value={run.rejectsCount} tone={run.rejectsCount > 0 ? 'danger' : 'neutral'} />
      </div>

      <div className="card p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="מקור" value={run.source ?? '—'} />
        <Field label="גרסת Parser" value={run.parserVersion ?? '—'} />
        <Field label="התקבל" value={fmtDateTime(run.receivedAt)} />
        <Field label="הסתיים" value={run.completedAt ? fmtDateTime(run.completedAt) : '—'} />
        <Field label="file_hash" value={<code className="text-xs font-mono bg-ink-100 px-1.5 py-0.5 rounded break-all">{run.fileHash}</code>} fullWidth />
        {run.error && <Field label="שגיאה" value={<span className="text-danger-700">{run.error}</span>} fullWidth />}
      </div>

      {run.promotedByEntity.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title">קידום למודל הנקי</h2>
          <div className="card p-5">
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              {run.promotedByEntity.map((p) => (
                <li key={p.entity} className="flex justify-between py-1">
                  <span className="font-mono text-ink-700">{p.entity}</span>
                  <span className="text-ink-900 font-medium tabular-nums">{p.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="section-title">שגיאות וקיפוצי תיקוף</h2>
        <div className="card overflow-hidden">
          {run.errors.length === 0 ? (
            <div className="p-10 text-center muted text-sm">אין שגיאות</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>חומרה</th>
                  <th>קוד</th>
                  <th>תיאור</th>
                  <th>בלוק / רשומה</th>
                </tr>
              </thead>
              <tbody>
                {run.errors.map((e, i) => (
                  <tr key={i} className="align-top">
                    <td>
                      <span className={`badge ${SEVERITY_TONE[e.severity] ?? ''}`}>{e.severity}</span>
                    </td>
                    <td className="font-mono text-xs text-ink-800">{e.code}</td>
                    <td className="text-ink-700">{e.message}</td>
                    <td className="text-xs muted space-y-0.5">
                      {e.blockCode && <div>בלוק {e.blockCode}</div>}
                      {e.recordSeq !== undefined && <div>רשומה #{e.recordSeq}</div>}
                      {e.field && <div>שדה: <code className="font-mono">{e.field}</code></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone: KpiTone }) {
  const t = {
    danger:  { text: 'text-danger-700',  bar: 'bg-danger-500' },
    success: { text: 'text-success-700', bar: 'bg-success-500' },
    info:    { text: 'text-brand-700',   bar: 'bg-brand-500' },
    neutral: { text: 'text-ink-800',     bar: 'bg-ink-300' },
  }[tone];
  return (
    <div className="card relative overflow-hidden p-5">
      <div className={`absolute top-0 right-0 h-full w-1 ${t.bar}`} />
      <div className="text-xs muted font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${t.text} tabular-nums`}>{value}</div>
    </div>
  );
}

function Field({ label, value, fullWidth = false }: { label: string; value: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'col-span-2 md:col-span-4' : ''}>
      <div className="text-xs muted font-medium">{label}</div>
      <div className="mt-1 text-ink-900 text-sm break-all">{value}</div>
    </div>
  );
}
