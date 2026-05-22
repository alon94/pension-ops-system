import { api } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/format';
import { CreateUserForm, UserRowActions } from '../../../components/AdminUsers';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  OPERATOR: 'רפרנט תפעולי',
  MANAGER: 'מנהל סוכנות',
  AUDITOR: 'בקר רגולציה',
  REGULATOR: 'גורם רגולטורי',
};

const ROLE_TONE: Record<string, string> = {
  OPERATOR: 'bg-info-50 text-info-700 ring-info-100',
  MANAGER: 'bg-success-50 text-success-700 ring-success-100',
  AUDITOR: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  REGULATOR: 'bg-warning-50 text-warning-700 ring-warning-100',
};

export default async function AdminUsersPage() {
  const users = await api.listUsers();
  const active = users.filter((u) => u.active).length;
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">ניהול משתמשים</h1>
          <p className="muted text-sm mt-1">פעולות זמינות למשתמשי MANAGER בלבד · פרק 13 באפיון.</p>
        </div>
        <div className="text-sm muted">
          <span className="font-medium text-ink-800">{active}</span> פעילים מתוך {users.length}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">משתמשי המערכת</h2>
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>שם</th>
                <th>דוא&quot;ל</th>
                <th>תפקיד</th>
                <th>סטטוס</th>
                <th>כניסה אחרונה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className={u.active ? '' : 'opacity-60'}>
                  <td className="font-medium text-ink-900">
                    {u.fullName ?? <span className="text-ink-400 font-normal">—</span>}
                  </td>
                  <td className="font-mono text-xs text-ink-700">{u.email}</td>
                  <td>
                    <span className={`badge ${ROLE_TONE[u.role] ?? 'bg-ink-100 text-ink-700 ring-ink-200'}`}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td>
                    {u.active ? (
                      <span className="badge badge-dot bg-success-50 text-success-700 ring-success-100">פעיל</span>
                    ) : (
                      <span className="badge badge-dot bg-ink-100 text-ink-600 ring-ink-200">מושבת</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {u.lastLoginAt ? (
                      <span className="text-ink-700">{fmtDateTime(u.lastLoginAt)}</span>
                    ) : (
                      <span className="text-ink-400">לא נכנס</span>
                    )}
                  </td>
                  <td><UserRowActions user={u} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">הוספת משתמש</h2>
        <CreateUserForm />
      </section>
    </div>
  );
}
