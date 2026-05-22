import Link from 'next/link';
import { SeverityBadge, StatusBadge } from '../components/Badge';
import { CustomerSearch } from '../components/CustomerSearch';
import { api } from '../lib/api';
import { fmtDateTime, fmtRelative } from '../lib/format';

export const dynamic = 'force-dynamic';

type KpiTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

export default async function DashboardPage() {
  const [stats, rejects] = await Promise.all([api.stats(), api.rejects({ limit: 20 })]);
  const highPlus = stats.rejects.bySeverity.CRITICAL + stats.rejects.bySeverity.HIGH;
  const failRate = stats.ingestion.last24h > 0 ? Math.round((stats.ingestion.failed24h / stats.ingestion.last24h) * 100) : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">דשבורד יומי</h1>
          <p className="muted text-sm mt-1">סקירה תפעולית של ריג&apos;קטים, גבייה, סיומי עבודה וקליטה.</p>
        </div>
        <div className="text-xs muted">
          עודכן לאחרונה: {fmtDateTime(new Date().toISOString())}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="ריג'קטים פתוחים"
          value={stats.rejects.total}
          sub={highPlus > 0 ? `${highPlus} ב-HIGH+` : 'אין חמורים'}
          tone={stats.rejects.bySeverity.CRITICAL > 0 ? 'danger' : highPlus > 0 ? 'warning' : 'info'}
          icon={IconAlert}
        />
        <Kpi
          label="חריגות SLA"
          value={stats.rejects.overdue}
          sub={stats.rejects.overdue > 0 ? 'דורש הסלמה' : 'הכל בזמן'}
          tone={stats.rejects.overdue > 0 ? 'danger' : 'success'}
          icon={IconClock}
        />
        <Kpi
          label="סיומי עבודה פעילים"
          value={stats.terminations.active}
          sub="ממתינים לטופס 161"
          tone="warning"
          icon={IconBriefcase}
        />
        <Kpi
          label="פערי גבייה פתוחים"
          value={stats.collection.openDiscrepancies}
          sub="חודש פעיל"
          tone="neutral"
          icon={IconCoin}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">תיבת הטיפול</h2>
            <Link href="/rejects" className="text-sm text-brand-700 hover:text-brand-800 hover:underline">
              לכל הריג&apos;קטים ←
            </Link>
          </div>
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>קוד</th>
                  <th>חומרה</th>
                  <th>סטטוס</th>
                  <th>לקוח</th>
                  <th>SLA</th>
                  <th>משויך</th>
                </tr>
              </thead>
              <tbody>
                {rejects.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-10 text-center">
                      <div className="flex flex-col items-center gap-2 text-ink-500">
                        <IconCheck className="h-8 w-8 text-success-600" />
                        <div className="text-sm font-medium text-ink-700">אין ריג&apos;קטים פתוחים</div>
                        <div className="text-xs">כל הריג&apos;קטים נפתרו או דחו.</div>
                      </div>
                    </td>
                  </tr>
                )}
                {rejects.map((r) => (
                  <tr key={r.rejectId}>
                    <td>
                      <Link href={`/rejects/${r.rejectId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">
                        {r.rejectCode}
                      </Link>
                      <div className="text-xs text-ink-500 mt-0.5">{r.rejectType}</div>
                    </td>
                    <td><SeverityBadge value={r.severity} /></td>
                    <td><StatusBadge value={r.status} /></td>
                    <td>
                      {r.customerId ? (
                        <Link href={`/customers/${r.customerId}`} className="text-ink-800 hover:text-brand-700 hover:underline font-medium">
                          {r.customerName ?? '—'}
                        </Link>
                      ) : '—'}
                      <div className="text-xs text-ink-500 mt-0.5">{r.customerIsraelId ? `ת.ז. ${r.customerIsraelId}` : ''}</div>
                    </td>
                    <td className="text-xs">
                      <div className="text-ink-700">{fmtRelative(r.slaDueAt)}</div>
                      <div className="text-ink-400 mt-0.5">{fmtDateTime(r.slaDueAt)}</div>
                    </td>
                    <td className="text-ink-600">{r.assignee ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="section-title">חיפוש מהיר</h2>
          <CustomerSearch />
          <div className="card p-5 mt-4">
            <div className="flex items-center gap-2 text-ink-900 font-medium text-sm">
              <IconUpload className="h-4 w-4 text-brand-600" />
              קליטה ב-24 שעות אחרונות
            </div>
            <div className="mt-4 space-y-2.5 text-sm">
              <Row label="סה״כ ריצות" value={stats.ingestion.last24h} />
              <Row label="נכשלו" value={stats.ingestion.failed24h} tone={stats.ingestion.failed24h > 0 ? 'danger' : undefined} />
              {stats.ingestion.last24h > 0 && (
                <div className="pt-2 border-t border-ink-100">
                  <div className="flex justify-between text-xs muted mb-1">
                    <span>שיעור הצלחה</span>
                    <span className="font-medium text-ink-700">{100 - failRate}%</span>
                  </div>
                  <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${failRate > 20 ? 'bg-danger-600' : failRate > 5 ? 'bg-warning-600' : 'bg-success-600'} transition-all`}
                      style={{ width: `${100 - failRate}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="flex justify-between items-center">
      <span className="muted">{label}</span>
      <span className={`font-semibold ${tone === 'danger' ? 'text-danger-700' : 'text-ink-900'}`}>{value}</span>
    </div>
  );
}

function Kpi({ label, value, sub, tone, icon: Icon }: { label: string; value: number; sub?: string; tone: KpiTone; icon: React.FC<{ className?: string }> }) {
  // טבלת tones — text + accent bar + icon bg
  const t = {
    danger:  { text: 'text-danger-700',  bar: 'bg-danger-500',  iconBg: 'bg-danger-50 text-danger-600' },
    warning: { text: 'text-warning-700', bar: 'bg-warning-500', iconBg: 'bg-warning-50 text-warning-600' },
    info:    { text: 'text-brand-700',   bar: 'bg-brand-500',   iconBg: 'bg-brand-50 text-brand-600' },
    success: { text: 'text-success-700', bar: 'bg-success-500', iconBg: 'bg-success-50 text-success-600' },
    neutral: { text: 'text-ink-800',     bar: 'bg-ink-300',     iconBg: 'bg-ink-100 text-ink-600' },
  }[tone];
  return (
    <div className="card card-hover relative overflow-hidden p-5">
      <div className={`absolute top-0 right-0 h-full w-1 ${t.bar}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs muted font-medium">{label}</div>
          <div className={`text-3xl font-bold mt-1 ${t.text} tabular-nums`}>{value}</div>
          {sub && <div className="text-xs muted mt-1">{sub}</div>}
        </div>
        <div className={`shrink-0 h-9 w-9 rounded-lg grid place-items-center ${t.iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

// ---------- אייקונים inline (SVG) — אין תלות בספריה ----------
function IconAlert({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}
function IconClock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
function IconBriefcase({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  );
}
function IconCoin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 5 2c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  );
}
function IconUpload({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}
