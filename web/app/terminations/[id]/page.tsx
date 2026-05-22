import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '../../../components/Badge';
import { Form161OcrUpload } from '../../../components/Form161OcrUpload';
import { api } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/auth';
import { fmtDate, fmtDateTime, fmtIls } from '../../../lib/format';

export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<string, string> = {
  AGENT_AUTOMATED: 'A6 — זיהוי אוטומטי',
  SALARY_REPORT: 'דוח שכר',
  CLEARING: 'מסלקה',
  MANUAL: 'ידני',
};

export default async function TerminationDetailPage({ params }: { params: { id: string } }) {
  const user = getCurrentUser();
  const canSubmit = !!user && (user.role === 'OPERATOR' || user.role === 'MANAGER');
  let t;
  try { t = await api.terminationDetail(params.id); }
  catch { notFound(); }

  return (
    <div className="space-y-6 animate-fade-in">
      <Link href="/terminations" className="text-sm muted hover:text-ink-900 inline-flex items-center gap-1 transition-colors">
        <span>←</span> חזרה לרשימה
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">סיום עבודה — {t.customerName ?? 'לקוח לא ידוע'}</h1>
          <div className="text-sm muted mt-1 font-mono">{t.terminationEventId}</div>
        </div>
        <StatusBadge value={t.status} />
      </div>

      <div className="card p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="לקוח" value={
          <Link href={`/customers/${t.customerId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">{t.customerName ?? '—'}</Link>
        } />
        <Field label="ת.ז." value={t.customerIsraelId ?? '—'} />
        <Field label="מקור זיהוי" value={SOURCE_LABELS[t.detectionSource] ?? t.detectionSource} />
        <Field label="זוהה" value={fmtDateTime(t.detectedAt)} />
        <Field label="תאריך סיום" value={t.confirmedTerminationDate ? fmtDate(t.confirmedTerminationDate) : '—'} />
        <Field label="טפסים" value={<span className="tabular-nums">{t.formsCount}</span>} />
        {t.notes && <Field label="הערות" value={t.notes} fullWidth />}
      </div>

      <section className="space-y-3">
        <h2 className="section-title">טפסי 161</h2>
        <div className="card overflow-hidden">
          {t.forms.length === 0 ? (
            <div className="p-10 text-center muted text-sm">
              אין טפסי 161 — העלה סריקה למטה כדי להתחיל.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>מספר</th>
                  <th>סטטוס</th>
                  <th>סה&quot;כ פיצויים</th>
                  <th>פדיון</th>
                  <th>קיבוע</th>
                  <th>חתימות</th>
                </tr>
              </thead>
              <tbody>
                {t.forms.map((f) => (
                  <tr key={f.form161Id}>
                    <td className="font-medium text-ink-900">{f.formNumber ?? <span className="text-ink-400 font-normal">—</span>}</td>
                    <td><StatusBadge value={f.validationStatus} /></td>
                    <td className="tabular-nums">{fmtIls(f.totalSeveranceAmount)}</td>
                    <td className="tabular-nums">{fmtIls(f.redemptionAmount)}</td>
                    <td className="tabular-nums">{fmtIls(f.fixationAmount)}</td>
                    <td className="text-xs text-ink-600 space-y-0.5">
                      {f.signedByEmployeeAt && <div>עובד: {fmtDate(f.signedByEmployeeAt)}</div>}
                      {f.signedByEmployerAt && <div>מעסיק: {fmtDate(f.signedByEmployerAt)}</div>}
                      {f.signedByAdvisorAt && <div>יועץ: {fmtDate(f.signedByAdvisorAt)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Form161OcrUpload
        termination={t}
        accountId={t.accountId}
        customerId={t.customerId}
        employerId={t.employerId}
        canSubmit={canSubmit}
      />
    </div>
  );
}

function Field({ label, value, fullWidth = false }: { label: string; value: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'col-span-2 md:col-span-4' : ''}>
      <div className="text-xs muted font-medium">{label}</div>
      <div className="mt-1 text-ink-900 text-sm">{value}</div>
    </div>
  );
}
