import Link from 'next/link';
import { SeverityBadge, StatusBadge } from '../../components/Badge';
import { api } from '../../lib/api';
import { fmtDateTime, fmtRelative } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default async function RejectsListPage() {
  const rejects = await api.rejects({ limit: 100 });
  const overdue = rejects.filter((r) => r.slaDueAt && new Date(r.slaDueAt).getTime() < Date.now()).length;
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">ניהול ריג&apos;קטים</h1>
          <p className="muted text-sm mt-1">קטלוג R001–R015, SLA פנימי וחיצוני, אסקלציה — פרק 7 באפיון.</p>
        </div>
        <div className="text-sm muted">
          <span className="font-medium text-ink-800">{rejects.length}</span> פתוחים
          {overdue > 0 && <span className="text-danger-700 mr-2">· {overdue} חורגי SLA</span>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>קוד</th>
              <th>סוג</th>
              <th>חומרה</th>
              <th>סטטוס</th>
              <th>לקוח</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {rejects.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center muted">אין ריג&apos;קטים פתוחים</td>
              </tr>
            )}
            {rejects.map((r) => (
              <tr key={r.rejectId}>
                <td>
                  <Link href={`/rejects/${r.rejectId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">
                    {r.rejectCode}
                  </Link>
                </td>
                <td className="text-ink-600">{r.rejectType}</td>
                <td><SeverityBadge value={r.severity} /></td>
                <td><StatusBadge value={r.status} /></td>
                <td>
                  {r.customerId ? (
                    <Link href={`/customers/${r.customerId}`} className="text-ink-800 hover:text-brand-700 hover:underline font-medium">
                      {r.customerName ?? '—'}
                    </Link>
                  ) : '—'}
                  {r.customerIsraelId && <div className="text-xs muted mt-0.5">ת.ז. {r.customerIsraelId}</div>}
                </td>
                <td className="text-xs">
                  <div className="text-ink-700">{fmtRelative(r.slaDueAt)}</div>
                  <div className="text-ink-400 mt-0.5">{fmtDateTime(r.slaDueAt)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
