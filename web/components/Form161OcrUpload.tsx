'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { A8ExtractResult, api, TerminationDetail } from '../lib/api';
import { fmtIls } from '../lib/format';

/**
 * §11.2 A8 — העלאת סריקת טופס 161 → Claude Vision מחלץ שדות →
 * המשתמש בודק/עורך → יוצר FORM_161 בסטטוס DRAFT.
 */
export function Form161OcrUpload({ termination, accountId, customerId, employerId, canSubmit }: {
  termination: TerminationDetail;
  accountId?: string;
  customerId?: string;
  employerId?: string;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<A8ExtractResult | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  function mediaTypeOf(f: File): string | null {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return null;
  }

  async function runOcr(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const mediaType = mediaTypeOf(file);
    if (!mediaType) { setError('פורמט לא נתמך — PDF/JPG/PNG/GIF/WebP בלבד'); return; }
    setExtracting(true); setError(null); setResult(null); setDraft(null);
    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const out = await api.extractForm161({
        contentBase64: base64, mediaType, fileName: file.name,
        terminationEventId: termination.terminationEventId, accountId, customerId, employerId,
      });
      setResult(out);
      if (out.data) setDraft({ ...out.data.extracted });
    } catch (e) { setError((e as Error).message); }
    finally { setExtracting(false); }
  }

  async function submit() {
    if (!draft || !accountId || !customerId || !employerId) return;
    setSubmitting(true); setError(null);
    try {
      await api.createForm161(termination.terminationEventId, {
        accountId, customerId, employerId,
        formNumber: draft.formNumber || undefined,
        totalSeveranceAmount: Number(draft.totalSeveranceAmount) || 0,
        redemptionAmount: Number(draft.redemptionAmount) || 0,
        fixationAmount: Number(draft.fixationAmount) || 0,
        taxWithholdingAmount: Number(draft.taxWithholdingAmount) || 0,
        signedByEmployeeAt: draft.signedByEmployeeAt || undefined,
        signedByEmployerAt: draft.signedByEmployerAt || undefined,
        signedByAdvisorAt: draft.signedByAdvisorAt || undefined,
      });
      router.refresh();
      setResult(null); setDraft(null); setFile(null);
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  if (!canSubmit) {
    return (
      <div className="card p-4 bg-ink-50 text-sm muted">
        העלאת טופס 161 זמינה למשתמשי OPERATOR ו-MANAGER בלבד.
      </div>
    );
  }

  return (
    <div className="card p-5 relative overflow-hidden space-y-3">
      <div className="absolute top-0 right-0 h-full w-1 bg-brand-500" />
      <div>
        <h3 className="font-semibold text-ink-900 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          חילוץ טופס 161 מסריקה (A8)
        </h3>
        <p className="text-xs muted mt-1">
          העלה PDF / תמונה. Claude Vision יחלץ את השדות — תוכל לעבור עליהם ולאשר.
        </p>
      </div>

      {!result && (
        <form onSubmit={runOcr} className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm flex-1 min-w-[200px] file:btn-secondary file:btn-sm file:ml-2 file:cursor-pointer text-ink-600" />
          <button type="submit" disabled={!file || extracting} className="btn-primary">
            {extracting ? 'מחלץ…' : 'הפעל A8'}
          </button>
        </form>
      )}

      {error && (
        <div className="text-sm text-danger-700 bg-danger-50 ring-1 ring-danger-100 rounded-lg p-2.5">{error}</div>
      )}

      {result?.data && draft && (
        <div className="space-y-3 animate-fade-in">
          <div className={`rounded-lg ring-1 p-2.5 text-xs ${result.data.fallback ? 'bg-warning-50 ring-warning-100 text-warning-700' : 'bg-success-50 ring-success-100 text-success-700'}`}>
            {result.data.fallback
              ? `⚠ ANTHROPIC_API_KEY חסר — חולץ ע"י mock דטרמיניסטי (${result.data.model})`
              : `✓ חולץ ע"י ${result.data.model} (in=${result.data.tokensIn} out=${result.data.tokensOut})`}
            {result.data.extracted.notes && <div className="mt-1 italic">{result.data.extracted.notes}</div>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="מספר טופס" value={draft.formNumber ?? ''} onChange={(v) => setDraft({ ...draft, formNumber: v })} />
            <Field label="סה&quot;כ פיצויים (ש&quot;ח)" type="number" value={draft.totalSeveranceAmount} onChange={(v) => setDraft({ ...draft, totalSeveranceAmount: v })} />
            <Field label="פדיון (ש&quot;ח)" type="number" value={draft.redemptionAmount} onChange={(v) => setDraft({ ...draft, redemptionAmount: v })} />
            <Field label="קיבוע (ש&quot;ח)" type="number" value={draft.fixationAmount} onChange={(v) => setDraft({ ...draft, fixationAmount: v })} />
            <Field label="ניכוי מס (ש&quot;ח)" type="number" value={draft.taxWithholdingAmount} onChange={(v) => setDraft({ ...draft, taxWithholdingAmount: v })} />
            <Field label="חתימת עובד" type="date" value={draft.signedByEmployeeAt ?? ''} onChange={(v) => setDraft({ ...draft, signedByEmployeeAt: v })} />
            <Field label="חתימת מעסיק" type="date" value={draft.signedByEmployerAt ?? ''} onChange={(v) => setDraft({ ...draft, signedByEmployerAt: v })} />
            <Field label="חתימת יועץ מס" type="date" value={draft.signedByAdvisorAt ?? ''} onChange={(v) => setDraft({ ...draft, signedByAdvisorAt: v })} />
          </div>

          <div className="text-xs bg-ink-50 ring-1 ring-ink-200 rounded-lg p-2.5 text-ink-700">
            <span className="font-medium">צ&apos;ק אריתמטי:</span> {fmtIls(Number(draft.redemptionAmount) + Number(draft.fixationAmount))}
            {' '}={' '}{fmtIls(Number(draft.totalSeveranceAmount))}
            {Math.abs((Number(draft.redemptionAmount) + Number(draft.fixationAmount)) - Number(draft.totalSeveranceAmount)) > 1 && (
              <span className="text-danger-700 font-medium"> ✗ סטייה</span>
            )}
          </div>

          {result.data.validationIssues.length > 0 && (
            <div className="text-sm bg-warning-50 ring-1 ring-warning-100 rounded-lg p-2.5 space-y-1">
              <div className="font-medium text-warning-700">אילוצי §8.4 שאינם מתקיימים — תיקון לפני שמירה:</div>
              <ul className="list-disc list-inside text-warning-700 text-xs space-y-0.5">
                {result.data.validationIssues.map((i, n) => <li key={n}><code className="font-mono">{i.code}</code> — {i.message}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={submit} disabled={submitting || !accountId || !customerId || !employerId} className="btn-primary">
              {submitting ? 'שומר…' : 'אשר וצור טופס 161'}
            </button>
            <button onClick={() => { setResult(null); setDraft(null); }} className="btn-secondary">
              נקה והעלה מחדש
            </button>
          </div>
          {(!accountId || !customerId || !employerId) && (
            <div className="text-xs text-warning-700">⚠ חסר חשבון/לקוח/מעסיק במידע על אירוע סיום העבודה — שמירה לא תהיה אפשרית עד שיתווסף.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: any; onChange: (v: any) => void; type?: string }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="input" />
    </label>
  );
}
