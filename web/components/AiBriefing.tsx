'use client';

import { useState } from 'react';
import { api, BriefingResponse } from '../lib/api';
import { fmtDateTime } from '../lib/format';

/**
 * A1 — Meeting Quality Agent briefing panel.
 * קורא לנתיב POST /agent-context/:id/briefing שמריץ Claude עם prompt caching.
 * אם אין ANTHROPIC_API_KEY בשרת — fallback דטרמיניסטי שמוצג עם תג ברור.
 */
export function AiBriefing({ customerId }: { customerId: string }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BriefingResponse | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.briefing(customerId, reason || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 relative overflow-hidden space-y-3">
      <div className="absolute top-0 right-0 h-full w-1 bg-brand-500" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink-900 flex items-center gap-2">
            <svg className="h-4 w-4 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"/>
            </svg>
            תקציר לקראת פגישה (A1)
          </h3>
          <p className="text-xs muted mt-1">
            מופק ע&quot;י Claude מעל AGENT_CONTEXT (§5.6, §11.2). prompt caching פעיל.
          </p>
        </div>
        {data && (
          <div className="text-left text-xs text-ink-400 shrink-0">
            <div className="font-medium text-ink-600">{data.fallback ? 'מצב fallback' : data.model}</div>
            <div className="mt-0.5">{fmtDateTime(data.generatedAt)}</div>
            {data.cacheRead != null && data.cacheRead > 0 && (
              <div className="text-success-700 mt-0.5">cache hit: {data.cacheRead} tok</div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="סיבת הפגישה (אופציונלי)"
          className="input flex-1"
        />
        <button onClick={generate} disabled={loading} className="btn-primary">
          {loading ? 'מנסח…' : data ? 'נסח שוב' : 'הפק תקציר'}
        </button>
      </div>

      {error && (
        <div className="text-sm text-danger-700 bg-danger-50 ring-1 ring-danger-100 rounded-lg p-2.5">{error}</div>
      )}

      {data && (
        <div className="space-y-2">
          {data.fallback && (
            <div className="text-xs text-warning-700 bg-warning-50 ring-1 ring-warning-100 rounded-lg p-2.5">
              ⚠ ANTHROPIC_API_KEY לא מוגדר בשרת — מוצג תקציר דטרמיניסטי. הגדר את המפתח לקבלת
              תקציר נרטיבי מ-Claude.
            </div>
          )}
          <div className="bg-ink-50 ring-1 ring-ink-200 rounded-lg p-4 text-sm text-ink-900 whitespace-pre-wrap leading-relaxed">
            {data.briefing}
          </div>
          {(data.inputTokens != null || data.outputTokens != null) && (
            <div className="text-xs text-ink-400">
              tokens: in {data.inputTokens ?? 0} · out {data.outputTokens ?? 0}
              {data.cacheCreation != null && data.cacheCreation > 0 && ` · cache write ${data.cacheCreation}`}
            </div>
          )}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="text-sm muted">
          לחץ &quot;הפק תקציר&quot; לקבלת סקירה של 3–5 פסקאות על מצב הלקוח, דגלים שדורשים תשומת לב,
          והזדמנויות לדיון.
        </div>
      )}
    </div>
  );
}
