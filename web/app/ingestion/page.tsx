import Link from 'next/link';
import { IngestUpload } from '../../components/IngestUpload';
import { api } from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  completed:   'bg-success-50 text-success-700 ring-success-100',
  failed:      'bg-danger-50 text-danger-700 ring-danger-100',
  rolled_back: 'bg-danger-50 text-danger-700 ring-danger-100',
  received:    'bg-ink-100 text-ink-700 ring-ink-200',
  parsing:     'bg-info-50 text-info-700 ring-info-100',
  validating:  'bg-info-50 text-info-700 ring-info-100',
  promoting:   'bg-info-50 text-info-700 ring-info-100',
};

export default async function IngestionPage() {
  const user = getCurrentUser();
  const canUpload = !!user && (user.role === 'OPERATOR' || user.role === 'MANAGER');
  const runs = await api.ingestionRuns(50);

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">קליטה ממסלקה</h1>
          <p className="muted text-sm mt-1">צינור Receive → Parse → Validate → Promote → Post-Process · פרק 5 באפיון.</p>
        </div>
        <div className="text-xs muted">
          <span className="font-medium text-ink-800">{runs.length}</span> ריצות · file watcher פעיל ב-
          <code className="bg-ink-100 px-1.5 py-0.5 rounded-md font-mono text-ink-700">.dev-inbox/</code>
        </div>
      </div>

      <IngestUpload canUpload={canUpload} />

      <section className="space-y-3">
        <h2 className="section-title">ריצות אחרונות</h2>
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>שם קובץ</th>
                <th>מקור</th>
                <th>סטטוס</th>
                <th>רשומות</th>
                <th>שגיאות</th>
                <th>ריג&apos;קטים</th>
                <th>התקבל</th>
                <th>סיים</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={8} className="p-10 text-center muted">אין ריצות עדיין</td></tr>
              )}
              {runs.map((r) => (
                <tr key={r.ingestionRunId} className="align-top">
                  <td>
                    <Link href={`/ingestion/${r.ingestionRunId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">
                      {r.sourceFileName ?? '—'}
                    </Link>
                    <div className="text-xs text-ink-400 font-mono mt-0.5 truncate max-w-[200px]" title={r.fileHash}>
                      hash {r.fileHash.slice(0, 10)}…
                    </div>
                  </td>
                  <td className="text-xs text-ink-600">{r.source ?? '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_TONE[r.status] ?? 'bg-ink-100 text-ink-700 ring-ink-200'}`}>
                      {r.status}
                    </span>
                    {r.error && <div className="text-xs text-danger-700 mt-1.5 max-w-[200px]">{r.error}</div>}
                  </td>
                  <td className="text-ink-800 tabular-nums">{r.rawCount}</td>
                  <td>
                    {r.errorCount > 0 ? (
                      <div>
                        <span className="text-ink-800 tabular-nums">{r.errorCount}</span>
                        {r.criticalCount > 0 && (
                          <span className="text-danger-700 text-xs font-medium mr-1.5">({r.criticalCount} CRIT)</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-400 tabular-nums">0</span>
                    )}
                  </td>
                  <td className="text-ink-800 tabular-nums">{r.rejectsCount}</td>
                  <td className="text-xs muted whitespace-nowrap">{fmtDateTime(r.receivedAt)}</td>
                  <td className="text-xs muted whitespace-nowrap">{r.completedAt ? fmtDateTime(r.completedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="card p-5">
        <div className="font-medium text-ink-900 mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-info-600" />
          איך מגיעים קבצים למערכת
        </div>
        <ul className="list-disc list-inside space-y-1.5 text-sm text-ink-700">
          <li><strong className="text-ink-900">File watcher:</strong> כל קובץ שמושלך לתיקייה <code className="bg-ink-100 px-1.5 py-0.5 rounded text-xs font-mono">.dev-inbox/</code> בשרת — נסרק כל 5 שניות ועובר את הצינור.</li>
          <li><strong className="text-ink-900">העלאה ידנית מה-UI:</strong> לחיצה על &quot;קלוט&quot; למעלה (OPERATOR/MANAGER בלבד).</li>
          <li><strong className="text-ink-900">SFTP אמיתי:</strong> בפרודקשן <code className="bg-ink-100 px-1.5 py-0.5 rounded text-xs font-mono">FileSource</code> מוחלף ב-SFTP poller מול אופניר/פאזל. אותו pipeline.</li>
        </ul>
      </div>
    </div>
  );
}
