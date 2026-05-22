import Link from 'next/link';
import { api, AuthorizationListItem } from '../../lib/api';
import { fmtDate } from '../../lib/format';

export const dynamic = 'force-dynamic';

const SCOPE_LABELS: Record<string, string> = {
  full: 'מלא',
  read_only: 'קריאה בלבד',
  specific_products: 'מוצרים ספציפיים',
  specific_manufacturers: 'יצרנים ספציפיים',
};

const CHANNEL_LABELS: Record<string, string> = {
  digital: 'דיגיטלי',
  paper: 'נייר',
  oral_recorded: 'הקלטה',
};

type KpiTone = 'success' | 'warning' | 'neutral' | 'danger';

export default async function AuthorizationsPage() {
  const view = await api.authorizationsView();

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">ניהול ייפויי כוח</h1>
          <p className="muted text-sm mt-1">תוקף, scope, ביטולים ופקיעות — פרק 10 באפיון.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="פעילים" value={view.active.length} tone="success" />
        <Kpi label="פגי תוקף קרוב" value={view.expiringSoon.length} tone={view.expiringSoon.length > 0 ? 'warning' : 'neutral'} />
        <Kpi label="פגי תוקף" value={view.expired.length} tone={view.expired.length > 0 ? 'danger' : 'neutral'} />
        <Kpi label="מבוטלים / superseded" value={view.revoked.length} tone="neutral" />
      </div>

      {view.expiringSoon.length > 0 && (
        <Section title="פגי תוקף בקרוב (30 יום)" accent="warning">
          <AuthTable items={view.expiringSoon} emphasizeDays />
        </Section>
      )}

      <Section title="פעילים" accent="success">
        <AuthTable items={view.active} />
      </Section>

      {view.expired.length > 0 && (
        <Section title="פגי תוקף">
          <AuthTable items={view.expired} />
        </Section>
      )}

      {view.revoked.length > 0 && (
        <Section title="מבוטלים / הוחלפו">
          <AuthTable items={view.revoked} showRevocation />
        </Section>
      )}

      <div className="card p-5">
        <div className="font-medium text-ink-900 mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-info-600" />
          מדיניות (§10)
        </div>
        <ul className="list-disc list-inside space-y-1 text-sm text-ink-700">
          <li>תוקף ייפוי כוח 2–3 שנים מהחתימה — נדרש חידוש לפני פקיעה (§10.1).</li>
          <li>פגי תוקף לא מאפשרים INQUIRY חדש למסלקה (§10.4).</li>
          <li>חתימה דיגיטלית מחייבת אימות SMS OTP + ת.ז. (§10.3 A).</li>
          <li>לקוח DECEASED או חסר כשירות משפטית — לא ניתן ליצור ייפוי כוח חדש (§10.5).</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: 'success' | 'warning' }) {
  const accentBar = accent === 'warning' ? 'bg-warning-500' : accent === 'success' ? 'bg-success-500' : 'bg-ink-300';
  return (
    <section className="space-y-3">
      <h2 className="section-title">{title}</h2>
      <div className="card overflow-hidden relative">
        {accent && <div className={`absolute top-0 right-0 h-full w-1 ${accentBar}`} />}
        {children}
      </div>
    </section>
  );
}

function AuthTable({ items, emphasizeDays = false, showRevocation = false }: { items: AuthorizationListItem[]; emphasizeDays?: boolean; showRevocation?: boolean }) {
  if (items.length === 0) {
    return <div className="p-10 text-center muted text-sm">אין רשומות</div>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>לקוח</th>
          <th>היקף</th>
          <th>ערוץ</th>
          <th>נחתם</th>
          <th>תוקף עד</th>
          <th>ימים נותרים</th>
          {showRevocation && <th>סיבת ביטול</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <tr key={a.authorizationId}>
            <td>
              <Link href={`/customers/${a.customerId}`} className="text-ink-800 hover:text-brand-700 hover:underline font-medium">
                {a.customerName ?? '—'}
              </Link>
              {a.customerIsraelId && <div className="text-xs muted mt-0.5">ת.ז. {a.customerIsraelId}</div>}
            </td>
            <td>{SCOPE_LABELS[a.scope] ?? a.scope}</td>
            <td className="text-ink-600">{CHANNEL_LABELS[a.channel] ?? a.channel}</td>
            <td className="text-xs muted">{fmtDate(a.signedAt)}</td>
            <td>{fmtDate(a.validTo)}</td>
            <td className={`text-sm tabular-nums ${emphasizeDays && a.daysUntilExpiry < 30 ? 'text-danger-700 font-bold' : 'text-ink-700'}`}>
              {a.daysUntilExpiry < 0 ? `פג לפני ${-a.daysUntilExpiry} ימים` : `${a.daysUntilExpiry} ימים`}
            </td>
            {showRevocation && (
              <td className="text-xs text-ink-600">{a.revokedReason ?? '—'}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: KpiTone }) {
  const t = {
    success: { text: 'text-success-700', bar: 'bg-success-500' },
    warning: { text: 'text-warning-700', bar: 'bg-warning-500' },
    danger:  { text: 'text-danger-700',  bar: 'bg-danger-500' },
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
