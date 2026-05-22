'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CurrentUser, UserRole } from '../lib/auth';
import { LogoutButton } from './LogoutButton';

/** §13 — Header עם ניווט role-aware, active state, ו-chip של משתמש מחובר. */

interface NavLink { href: string; label: string; allowedRoles?: UserRole[] }

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'דשבורד' },
  { href: '/rejects', label: 'ריג\'קטים' },
  { href: '/collection', label: 'גבייה' },
  { href: '/terminations', label: 'סיומי עבודה' },
  { href: '/authorizations', label: 'ייפויי כוח' },
  { href: '/customers', label: 'לקוחות' },
  { href: '/ingestion', label: 'קליטה', allowedRoles: ['OPERATOR', 'MANAGER', 'AUDITOR'] },
  { href: '/manager', label: 'מנהל', allowedRoles: ['MANAGER'] },
  { href: '/admin/users', label: 'משתמשים', allowedRoles: ['MANAGER'] },
  { href: '/audit', label: 'Audit', allowedRoles: ['AUDITOR', 'MANAGER'] },
];

const ROLE_LABELS: Record<UserRole, string> = {
  OPERATOR: 'רפרנט',
  MANAGER: 'מנהל',
  AUDITOR: 'בקר',
  REGULATOR: 'רגולציה',
};

const ROLE_TONE: Record<UserRole, string> = {
  OPERATOR: 'bg-info-50 text-info-700 ring-info-100',
  MANAGER: 'bg-success-50 text-success-700 ring-success-100',
  AUDITOR: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  REGULATOR: 'bg-warning-50 text-warning-700 ring-warning-100',
};

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppHeader({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const visible = NAV_LINKS.filter((l) => !l.allowedRoles || l.allowedRoles.includes(user.role));
  return (
    <header className="bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/75 border-b border-ink-200/60 sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-800 grid place-items-center text-white text-xs font-bold shadow-soft">
            ת״פ
          </div>
          <span className="font-bold text-base text-ink-900 group-hover:text-brand-700 transition-colors">תפעול פנסיוני</span>
        </Link>
        <nav className="flex items-center gap-0.5 flex-wrap">
          {visible.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-link ${active ? 'nav-link-active font-medium' : ''}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="mr-auto flex items-center gap-3 text-sm">
          <div className="text-left leading-tight hidden sm:block">
            <div className="text-ink-800 font-medium">{user.name ?? user.email}</div>
            <div className="text-xs text-ink-500">{user.email}</div>
          </div>
          <span className={`badge ${ROLE_TONE[user.role]}`}>{ROLE_LABELS[user.role]}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
