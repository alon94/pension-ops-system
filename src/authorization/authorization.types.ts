/** ייפוי כוח, תבניות ופרטיות (פרק 10). */

export type AuthScope = 'full' | 'specific_products' | 'specific_manufacturers' | 'read_only';

export type AuthStatus = 'active' | 'expired' | 'revoked' | 'superseded' | 'disputed';

export type AuthChannel = 'digital' | 'paper' | 'oral_recorded';

export interface AuthorizationTemplate {
  templateId: string;
  version: string;
  effectiveFrom: string; // ISO date
  effectiveTo?: string;
  textHe?: string;
  textEn?: string;
  regulatorApproved: boolean;
  approvalReference?: string;
}

export interface Authorization {
  authorizationId: string;
  customerId: string;
  scope: AuthScope;
  scopeDetailsJson?: {
    products?: string[];
    manufacturers?: string[];
  };
  templateId?: string;
  signatureHash?: string;
  signedAt: string;       // ISO
  validFrom: string;      // ISO date
  validTo: string;        // ISO date
  channel: AuthChannel;
  digitalSignatureProvider?: string;
  documentId?: string;
  status: AuthStatus;
  revokedAt?: string;
  revokedReason?: string;
  revokedBy?: 'customer' | 'agent' | 'system_auto';
}

export type NewAuthorization = Omit<
  Authorization,
  'authorizationId' | 'status' | 'revokedAt' | 'revokedReason' | 'revokedBy'
> & { status?: AuthStatus };
