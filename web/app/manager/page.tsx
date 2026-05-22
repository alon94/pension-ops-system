import { api } from '../../lib/api';
import { fmtIls } from '../../lib/format';

export const dynamic = 'force-dynamic';

type KpiTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

export default async function ManagerDashboardPage() {
  const stats = await api.managerStats();
  const maxByCode = Math.max(1, ...stats.rejects.byCode.map((x) => x.count));

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">דשבורד מנהל סוכנות</h1>
          <p className="muted text-sm mt-1">KPIs ותמונת מצב חוצת-מערכת — §12.2 #7</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">סקירה כללית</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Kpi label="לקוחות" value={stats.overview.customers} tone="neutral" />
          <Kpi label="חשבונות פעילים" value={stats.overview.activeAccounts} tone="info" />
          <Kpi label="סך נכסים מנוהלים" value={fmtIls(stats.overview.totalAssets)} tone="info" />
          <Kpi label="קליטות 30 ימים" value={stats.overview.ingestionRuns30d} tone="neutral" />
          <Kpi label="קליטות שנכשלו" value={stats.overview.ingestionFailures30d}
               tone={stats.overview.ingestionFailures30d > 0 ? 'danger' : 'success'} />
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="section-title">ריג&apos;קטים</h2>
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="פתוחים" value={stats.rejects.open} tone="danger" />
              <Stat label="נסגרו 30 יום" value={stats.rejects.resolved30d} tone="success" />
              <Stat
                label="זמן ממוצע לפתרון"
                value={stats.rejects.avgResolutionHours != null ? `${stats.rejects.avgResolutionHours.toFixed(1)}h` : '—'}
                tone="neutral"
              />
            </div>
            <div>
              <div className="text-xs font-medium muted mb-2 uppercase tracking-wide">פילוח לפי קוד (Top 10)</div>
              {stats.rejects.byCode.length === 0 ? (
                <div className="text-sm muted">אין ריג&apos;קטים פתוחים</div>
              ) : (
                <ul className="space-y-2">
                  {stats.rejects.byCode.map((r) => (
                    <li key={r.rejectCode} className="text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="font-mono text-xs text-ink-800">{r.rejectCode}</span>
                        <span className="text-ink-700 tabular-nums font-medium">{r.count}</span>
                      </div>
                      <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                        <div className="h-full bg-danger-500 rounded-full transition-all" style={{ width: `${(r.count / maxByCode) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-title">בקרת גבייה</h2>
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="פערים פתוחים" value={stats.collection.openDiscrepancies} tone="warning" />
              <Stat label="סכום פתוח" value={fmtIls(stats.collection.sumOpenAmount)} tone="info" />
            </div>
            <div>
              <div className="text-xs font-medium muted mb-2 uppercase tracking-wide">מעסיקים מובילים (Top 5)</div>
              {stats.collection.topEmployers.length === 0 ? (
                <div className="text-sm muted">אין נתונים</div>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {stats.collection.topEmployers.map((e, i) => (
                    <li key={i} className="flex justify-between py-1">
                      <span className="text-ink-800">{e.employerName ?? <span className="text-ink-400">לא מזוהה</span>}</span>
                      <span className="text-ink-700 tabular-nums font-medium">{e.openCount}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">גופים מוסדיים — ריג&apos;קטים פתוחים</h2>
        <div className="card overflow-hidden">
          {stats.manufacturers.length === 0 ? (
            <div className="p-10 text-center muted text-sm">אין ריג&apos;קטים מוסדיים פתוחים</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>גוף מוסדי</th><th>ריג&apos;קטים פתוחים</th></tr>
              </thead>
              <tbody>
                {stats.manufacturers.map((m) => (
                  <tr key={m.manufacturerName}>
                    <td className="font-medium text-ink-900">{m.manufacturerName}</td>
                    <td className="text-danger-700 font-bold tabular-nums">{m.openRejects}</td>
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
    warning: { text: 'text-warning-700', bar: 'bg-warning-500' },
    info:    { text: 'text-brand-700',   bar: 'bg-brand-500' },
    success: { text: 'text-success-700', bar: 'bg-success-500' },
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

function Stat({ label, value, tone }: { label: string; value: number | string; tone: KpiTone }) {
  const colors = {
    danger:  'text-danger-700',
    warning: 'text-warning-700',
    info:    'text-brand-700',
    success: 'text-success-700',
    neutral: 'text-ink-800',
  }[tone];
  return (
    <div>
      <div className="text-xs muted font-medium">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${colors} tabular-nums`}>{value}</div>
    </div>
  );
}
