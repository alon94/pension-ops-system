/** טיפוסי אימות והרשאות (פרק 13 §13.1). */

export type UserRole = 'OPERATOR' | 'MANAGER' | 'AUDITOR' | 'REGULATOR';

export interface UserRecord {
  userId: string;
  email: string;
  role: UserRole;
  fullName?: string;
  active: boolean;
  lastLoginAt?: string;
}

export interface UserWithPassword extends UserRecord {
  passwordHash: string;
}

export interface AuthJwtPayload {
  sub: string;  // user_id
  email: string;
  role: UserRole;
  name?: string;
}

export interface LoginResponse {
  token: string;
  user: UserRecord;
}
