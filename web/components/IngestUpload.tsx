'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, IngestOutcome } from '../lib/api';

/**
 * §5.2 — העלאת קובץ XML/Fixed-Width למסלקה ידנית.
 * Manager-only. הקובץ נקרא בדפדפן, מומר ל-base64, ונשלח ל-POST /ingestion/files.
 */
export function IngestUpload({ canUpload }: { canUpload: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canUpload) {
    return (
      <div className="card p-4 bg-ink-50 text-sm muted">
        העלאת קבצים זמינה למשתמשי OPERATOR ו-MANAGER בלבד.
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const base64 = typeof window !== 'undefined'
        ? btoa(String.fromCharCode(...new Uint8Array(buf)))
        : Buffer.from(buf).toString('base64');
      const out = await api.ingestFile(file.name, base64);
      setResult(out);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 h-full w-1 bg-brand-500" />
      <div className="mb-3">
        <h3 className="font-semibold text-ink-900 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          העלאת קובץ ידנית
        </h3>
        <p className="text-xs muted mt-1">
          XML או Fixed-Width לפי תקן מבנה אחיד. הקובץ עובר את כל שלבי הצינור (§5.1).
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          type="file" accept=".xml,.txt,.dat,.fw,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm flex-1 min-w-[200px] file:btn-secondary file:btn-sm file:ml-2 file:cursor-pointer text-ink-600"
        />
        <button type="submit" disabled={!file || busy} className="btn-primary">
          {busy ? 'מזרים…' : 'קלוט'}
        </button>
      </form>
      {error && (
        <div className="mt-3 text-sm text-danger-700 bg-danger-50 ring-1 ring-danger-100 rounded-lg p-2.5 animate-fade-in">
          {error}
        </div>
      )}
      {result && (
        <div className={`mt-3 rounded-lg ring-1 p-3 text-sm animate-fade-in ${
          result.status === 'completed' ? 'bg-success-50 ring-success-100 text-success-700'
          : result.status === 'duplicate' ? 'bg-warning-50 ring-warning-100 text-warning-700'
          : 'bg-danger-50 ring-danger-100 text-danger-700'}`}>
          <div className="font-medium">
            {result.status === 'completed' && '✓ הקובץ נקלט בהצלחה'}
            {result.status === 'duplicate' && '⚠ קובץ זהה כבר נקלט בעבר (file_hash זהה)'}
            {result.status === 'failed' && `✗ הקליטה נכשלה — ${result.error}`}
          </div>
          {result.ingestionRunId && (
            <div className="text-xs mt-1.5">
              run: <code className="bg-white/70 px-1.5 py-0.5 rounded font-mono">{result.ingestionRunId}</code>
            </div>
          )}
          {result.promoted && (
            <div className="text-xs mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">
              {Object.entries(result.promoted).filter(([, n]) => n > 0).map(([k, n]) => (
                <div key={k}><span className="font-medium">{k}:</span> {n}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
