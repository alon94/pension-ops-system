/**
 * הגדרת בלוקי "מבנה אחיד" (§2.4).
 * מספרי הבלוקים אינדיקטיביים — מבוססים על מסמכי מבנה אחיד פומביים, יש לתקף
 * מול הספציפיקציה הרשמית העדכנית (§2.4 + פרק 16 — שאלות פתוחות).
 *
 * לכל בלוק: קוד, שם, האם יכול לחזור פעמים רבות, ופריסת השדות ל-Fixed-Width
 * (offset 0-based, width). פורמט XML משתמש בשמות השדות (fieldName) כ-tag names.
 */

export type BlockCode =
  | '010' // Header
  | '020' // Customer Identification
  | '030' // Manufacturer Identification
  | '040' // Product / Account Details
  | '050' // Balance Details
  | '060' // Coverage Details
  | '070' // Employment & Deposits
  | '080' // Beneficiaries
  | '090' // Withdrawals & Loans
  | '999'; // Trailer

export interface FieldDef {
  /** שם לוגי — משמש כ-tag ב-XML וכמפתח ב-RAW_STAGING.fields */
  name: string;
  /** offset התחלתי (0-based) בפורמט Fixed-Width */
  offset: number;
  /** רוחב בתווים בפורמט Fixed-Width */
  width: number;
  /** טיפוס לוגי — משמש את שלב הפענוח לאיתור שגיאות per-record */
  kind: 'string' | 'date' | 'decimal' | 'int' | 'enum';
  required?: boolean;
}

export interface BlockDef {
  code: BlockCode;
  name: string;
  /** האם הבלוק יכול להופיע פעמים רבות בקובץ (§2.4) */
  repeatable: boolean;
  /** סך רוחב הרשומה בפורמט Fixed-Width (כולל 3 התווים של קוד הבלוק בתחילת השורה) */
  recordWidth: number;
  fields: FieldDef[];
}

/** בכל שורת Fixed-Width 3 התווים הראשונים הם קוד הבלוק. */
export const BLOCK_CODE_WIDTH = 3;

function f(name: string, offset: number, width: number, kind: FieldDef['kind'], required = false): FieldDef {
  return { name, offset, width, kind, required };
}

export const BLOCKS: Record<BlockCode, BlockDef> = {
  '010': {
    code: '010',
    name: 'Header',
    repeatable: false,
    recordWidth: 53,
    fields: [
      f('inquiryNumber', 3, 20, 'string', true),
      f('fileDate', 23, 8, 'date', true),
      f('providerCode', 31, 10, 'string', true),
      f('standardVersion', 41, 12, 'string', true),
    ],
  },
  '020': {
    code: '020',
    name: 'Customer Identification',
    repeatable: true,
    recordWidth: 113,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('israelId', 13, 9, 'string', true),
      f('firstName', 22, 30, 'string', true),
      f('lastName', 52, 30, 'string', true),
      f('birthDate', 82, 8, 'date', true),
      f('gender', 90, 1, 'enum'),
      f('city', 91, 22, 'string'),
    ],
  },
  '030': {
    code: '030',
    name: 'Manufacturer Identification',
    repeatable: true,
    recordWidth: 53,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('manufacturerCode', 13, 10, 'string', true),
      f('manufacturerName', 23, 30, 'string', true),
    ],
  },
  '040': {
    code: '040',
    name: 'Product / Account Details',
    repeatable: true,
    recordWidth: 112,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('manufacturerCode', 13, 10, 'string', true),
      f('policyNumber', 23, 20, 'string', true),
      f('productCode', 43, 10, 'string', true),
      f('openedDate', 53, 8, 'date', true),
      f('accountStatus', 61, 2, 'enum', true),
      f('riskTrackCode', 63, 10, 'string'),
      f('managementFeeDeposit', 73, 7, 'decimal'),
      f('managementFeeBalance', 80, 7, 'decimal'),
      f('closedDate', 87, 8, 'date'),
      f('subPolicyCode', 95, 10, 'string'),
    ],
  },
  '050': {
    code: '050',
    name: 'Balance Details',
    repeatable: true,
    recordWidth: 91,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('policyNumber', 13, 20, 'string', true),
      f('snapshotDate', 33, 8, 'date', true),
      f('severance', 41, 13, 'decimal', true),
      f('tagmulimEmployee', 54, 13, 'decimal', true),
      f('tagmulimEmployer', 67, 13, 'decimal', true),
      f('allowance', 80, 13, 'decimal', true),
      // total מחושב כסכום הרכיבים; נשמר ב-fields אם הופיע, אחרת מחושב.
    ],
  },
  '060': {
    code: '060',
    name: 'Coverage Details',
    repeatable: true,
    recordWidth: 86,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('policyNumber', 13, 20, 'string', true),
      f('coverageTypeCode', 33, 6, 'enum', true),
      f('insuredAmount', 39, 13, 'decimal'),
      f('premium', 52, 10, 'decimal'),
      f('underwritingStatus', 62, 2, 'enum'),
      f('coverageFrom', 64, 8, 'date'),
      f('coverageTo', 72, 8, 'date'),
    ],
  },
  '070': {
    code: '070',
    name: 'Employment & Deposits',
    repeatable: true,
    recordWidth: 124,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('policyNumber', 13, 20, 'string', true),
      f('employerCompanyId', 33, 9, 'string', true),
      f('employerName', 42, 30, 'string'),
      f('employmentStart', 72, 8, 'date', true),
      f('employmentEnd', 80, 8, 'date'),
      f('depositMonth', 88, 6, 'string', true),
      f('amountEmployee', 94, 10, 'decimal', true),
      f('amountEmployer', 104, 10, 'decimal', true),
      f('amountSeverance', 114, 10, 'decimal', true),
    ],
  },
  '080': {
    code: '080',
    name: 'Beneficiaries',
    repeatable: true,
    recordWidth: 86,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('policyNumber', 13, 20, 'string', true),
      f('beneficiaryName', 33, 30, 'string', true),
      f('beneficiaryId', 63, 9, 'string'),
      f('relation', 72, 8, 'enum'),
      f('sharePercent', 80, 6, 'decimal', true),
    ],
  },
  '090': {
    code: '090',
    name: 'Withdrawals & Loans',
    repeatable: true,
    recordWidth: 90,
    fields: [
      f('lotId', 3, 10, 'string', true),
      f('policyNumber', 13, 20, 'string', true),
      f('movementType', 33, 4, 'enum', true), // WD = withdrawal, LN = loan
      f('movementDate', 37, 8, 'date', true),
      f('gross', 45, 13, 'decimal'),
      f('net', 58, 13, 'decimal'),
      f('tax', 71, 13, 'decimal'),
      f('loanExternalId', 84, 6, 'string'),
    ],
  },
  '999': {
    code: '999',
    name: 'Trailer',
    repeatable: false,
    recordWidth: 23,
    fields: [
      f('recordCount', 3, 10, 'int', true),
      f('checksum', 13, 10, 'string', true),
    ],
  },
};

export const ALL_BLOCK_CODES = Object.keys(BLOCKS) as BlockCode[];

export function isBlockCode(code: string): code is BlockCode {
  return code in BLOCKS;
}
