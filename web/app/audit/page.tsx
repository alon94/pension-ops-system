import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { AuditFilters } from '../../components/AuditFilters';

export const dynamic = 'force-dynamic';

interface SearchParams { actor?: string; action?: string; entity?: string; since?: string }

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const [entries, versions] = await Promise.all([
    api.audit({
      actor: searchParams.actor, action: searchParams.action,
      entity: searchParams.entity, since: searchParams.since, limit: 200,
    }),
    api.regulationVersions(),
  ]);

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Audit &amp; Compliance</h1>
          <p className="muted text-sm mt-1">חיפוש ב-AUDIT_LOG ומצב גרסת מבנה אחיד · §12.2 #8 · גישה: Auditor / Manager.</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">סינון</h2>
        <AuditFilters initial={searchParams} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">רישומים</h2>
          <span className="text-sm muted">{entries.length} תוצאות</span>
        </div>
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>מועד</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Entity ID</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center muted">אין רישומים תואמים</td></tr>
              )}
              {entries.map((e) => (
                <tr key={e.auditId} className="align-top">
                  <td className="text-xs text-ink-600 whitespace-nowrap">{fmtDateTime(e.occurredAt)}</td>
                  <td className="text-sm font-medium text-ink-900">{e.actor}</td>
                  <td>
                    <code className="bg-ink-100 text-ink-800 px-2 py-0.5 rounded-md text-xs">{e.action}</code>
                  </td>
                  <td className="text-sm text-ink-700">{e.entity ?? <span className="text-ink-400">—</span>}</td>
                  <td className="text-xs muted max-w-[180px] truncate" title={e.entityId ?? undefined}>
                    {e.entityId ?? '—'}
                  </td>
                  <td className="text-xs text-ink-500 max-w-[260px]">
                    {e.meta ? (
                      <details>
                        <summary className="cursor-pointer text-ink-700 hover:text-brand-700 select-none">פרטים</summary>
                        <pre className="text-xs whitespace-pre-wrap mt-1.5 bg-ink-50 ring-1 ring-ink-200 p-2 rounded-md">{JSON.stringify(e.meta, null, 2)}</pre>
                      </details>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">גרסאות מבנה אחיד נתמכות (§5.3, §17.5)</h2>
        <div className="card overflow-hidden">
          {versions.length === 0 ? (
            <div className="p-10 text-center muted text-sm">לא הוגדרו גרסאות ב-REGULATION_VERSION</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>גרסת Parser</th>
                  <th>תקפה מתאריך</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.parserVersion}>
                    <td className="font-mono text-ink-800">{v.parserVersion}</td>
                    <td>{v.effectiveFrom}</td>
                    <td className="text-sm text-ink-600">{v.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
