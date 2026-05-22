import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SeverityBadge, StatusBadge } from '../../../components/Badge';
import { RejectActions } from '../../../components/RejectActions';
import { api } from '../../../lib/api';
import { fmtDateTime, fmtRelative } from '../../../lib/format';

export const dynamic = 'force-dynamic';

// המעברים מועתקים מ-src/rejects/reject-lifecycle.service.ts §7.4
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'ESCALATED', 'DISMISSED'],
  IN_PROGRESS: ['WAITING_MANUFACTURER', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'DISMISSED'],
  WAITING_MANUFACTURER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'DISMISSED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'DISMISSED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

export default async function RejectDetailPage({ params }: { params: { id: string } }) {
  const all = await api.rejects({ limit: 500 });
  const r = all.find((x) => x.rejectId === params.id);
  if (!r) {
    const resolved = await api.rejects({ status: 'RESOLVED', limit: 500 });
    const r2 = resolved.find((x) => x.rejectId === params.id);
    if (!r2) notFound();
    return <RejectView r={r2} allowedTransitions={[]} />;
  }
  const allowed = TRANSITIONS[r.status] ?? [];
  return <RejectView r={r} allowedTransitions={allowed} />;
}

function RejectView({ r, allowedTransitions }: { r: any; allowedTransitions: string[] }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <Link href="/rejects" className="text-sm muted hover:text-ink-900 inline-flex items-center gap-1 transition-colors">
        <span>←</span> חזרה לרשימה
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">{r.rejectCode}</h1>
          <div className="text-sm muted mt-1">
            {r.rejectType}
            {r.sourceEntity ? ` · ${r.sourceEntity}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge value={r.severity} />
          <StatusBadge value={r.status} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="זוהה" value={fmtDateTime(r.detectedAt)} />
            <Field label="יעד SLA" value={
              <>
                <div>{fmtDateTime(r.slaDueAt)}</div>
                <div className="text-xs muted mt-0.5">{fmtRelative(r.slaDueAt)}</div>
              </>
            } />
            <Field label="משויך" value={r.assignee ?? <span className="text-ink-400">—</span>} />
            <Field label="לקוח" value={r.customerId ? (
              <Link href={`/customers/${r.customerId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">{r.customerName}</Link>
            ) : <span className="text-ink-400">—</span>} />
          </div>
          {r.rejectReason && (
            <div>
              <div className="label-text">סיבה</div>
              <div className="bg-ink-50 ring-1 ring-ink-200 rounded-lg p-3 text-ink-800 text-sm leading-relaxed">{r.rejectReason}</div>
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="font-semibold text-ink-900 mb-4">פעולות (§7.4)</div>
          {allowedTransitions.length === 0 ? (
            <div className="text-sm muted">סטטוס טרמינלי — אין פעולות זמינות</div>
          ) : (
            <RejectActions rejectId={r.rejectId} allowed={allowedTransitions} />
          )}
        </div>
      </div>
    </div>
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
