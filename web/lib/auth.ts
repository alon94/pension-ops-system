import 'server-only';
import { cookies } from 'next/headers';

export const COOKIE_NAME = 'pension_jwt';
export const MAX_AGE_SECONDS = 12 * 60 * 60; // תואם ל-JWT_EXPIRY בשרת

export type UserRole = 'OPERATOR' | 'MANAGER' | 'AUDITOR' | 'REGULATOR';

export interface CurrentUser {
  sub: string;
  email: string;
  role: UserRole;
  name?: string;
}

/** קורא את ה-JWT מ-cookie (server-side בלבד; client קורא דרך document.cookie). */
export function readJwtCookie(): string | null {
  return cookies().get(COOKIE_NAME)?.value ?? null;
}

/** מפענח JWT ללא verify — רק ה-payload, להצגה ב-UI. הסמכות עצמה מאומתת בשרת. */
export function decodeJwt(token: string | null): CurrentUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const p = JSON.parse(json);
    if (!p.sub || !p.role) return null;
    return { sub: p.sub, email: p.email, role: p.role, name: p.name };
  } catch {
    return null;
  }
}

export function getCurrentUser(): CurrentUser | null {
  return decodeJwt(readJwtCookie());
}
