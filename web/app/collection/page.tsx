import Link from 'next/link';
import { StatusBadge } from '../../components/Badge';
import { api } from '../../lib/api';
import { fmtDate, fmtIls, fmtMonth } from '../../lib/format';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  MISSING: 'חסר',
  WRONG_FUND: 'קופה שגויה',
  WRONG_AMOUNT: 'סכום שגוי',
  WRONG_SPLIT: 'פיצול שגוי',
  LATE: 'הפקדה באיחור',
  OVER_CAP: 'חריגת תקרה',
  EMPLOYER_INSOLVENT: 'מעסיק חדל פירעון',
};

type KpiTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function CollectionPage({ searchParams }: { searchParams: { month?: string } }) {
  const month = searchParams?.month ?? currentMonth();
  let view = await api.collectionView(month);
  if (view.totals.all === 0 && !searchParams?.month) {
    view = await api.collectionView('202404');
  }

  const totalByType = Object.values(view.byType).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">בקרת גבייה</h1>
          <p className="muted text-sm mt-1">פערים חודשיים בין הפקדות בפועל לציפיות שכר/חוזה — פרק 9 באפיון.</p>
        </div>
        <div className="flex items-center gap-2 text-sm muted">
          <span>חודש:</span>
          <code className="bg-ink-100 text-ink-700 px-2 py-1 rounded-md text-xs font-medium">{fmtMonth(view.referenceMonth)}</code>
          <span className="text-xs">
            <Link href="/collection?month=202404" className="text-brand-700 hover:text-brand-800 hover:underline">202404</Link>
            {' · '}
            <Link href="/collection?month=202403" className="text-brand-700 hover:text-brand-800 hover:underline">202403</Link>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="סה&quot;כ פערים בחודש" value={String(view.totals.all)} tone="neutral" />
        <Kpi label="פתוחים" value={String(view.totals.open)} tone={view.totals.open > 0 ? 'danger' : 'success'} />
        <Kpi label="נסגרו" value={String(view.totals.resolved)} tone="success" />
        <Kpi label="סכום פתוח" value={fmtIls(view.totals.sumAmount)} tone="info" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="section-title">פילוח לפי סוג פער</h2>
          <div className="card p-5">
            {totalByType === 0 ? (
              <div className="text-sm muted">אין נתונים</div>
            ) : (
              <ul className="space-y-3">
                {Object.entries(view.byType).map(([type, n]) => {
                  const pct = (n / totalByType) * 100;
                  return (
                    <li key={type} className="text-sm">
                      <div className="flex justify-between mb-1.5">
                        <span className="text-ink-800 font-medium">
                          {TYPE_LABELS[type] ?? type}
                          <span className="text-xs text-ink-400 mr-1.5 font-normal">({type})</span>
                        </span>
                        <span className="text-ink-700 tabular-nums font-medium">{n}</span>
                      </div>
                      <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-title">מעסיקים עם פערים גבוהים</h2>
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr><th>מעסיק</th><th>פערים</th><th>סכום</th></tr>
              </thead>
              <tbody>
                {view.topEmployers.length === 0 && (
                  <tr><td colSpan={3} className="p-6 text-center muted text-sm">אין מעסיקים עם פערים פתוחים</td></tr>
                )}
                {view.topEmployers.map((e) => (
                  <tr key={e.employerId}>
                    <td className="font-medium text-ink-900">{e.employerName ?? <span className="text-ink-400 font-normal">—</span>}</td>
                    <td className="text-ink-700 tabular-nums">{e.openCount}</td>
                    <td className="text-ink-800 tabular-nums">{fmtIls(e.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">פערים אחרונים</h2>
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>סוג</th>
                <th>סטטוס</th>
                <th>לקוח</th>
                <th>מעסיק</th>
                <th>סכום</th>
                <th>זוהה</th>
              </tr>
            </thead>
            <tbody>
              {view.recentDiscrepancies.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center muted">אין פערים</td></tr>
              )}
              {view.recentDiscrepancies.map((d) => (
                <tr key={d.discrepancyId}>
                  <td>
                    <div className="font-medium text-ink-900">{TYPE_LABELS[d.discrepancyType] ?? d.discrepancyType}</div>
                    <div className="text-xs text-ink-400 mt-0.5">{d.discrepancyType}</div>
                  </td>
                  <td><StatusBadge value={d.status} /></td>
                  <td>
                    {d.customerId ? (
                      <Link href={`/customers/${d.customerId}`} className="text-ink-800 hover:text-brand-700 hover:underline font-medium">
                        {d.customerName ?? '—'}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="text-ink-700">{d.employerName ?? '—'}</td>
                  <td className="text-ink-800 tabular-nums font-medium">{fmtIls(d.discrepancyAmount)}</td>
                  <td className="text-xs muted">{fmtDate(d.detectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: KpiTone }) {
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
