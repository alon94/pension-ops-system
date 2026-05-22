import { BlockDef, FieldDef } from './blocks';
import { ParseError } from './types';

const DATE_RE = /^(\d{4})-?(\d{2})-?(\d{2})$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const INT_RE = /^-?\d+$/;

/** האם המחרוזת תאריך תקין בפורמט YYYYMMDD או YYYY-MM-DD (§5.3). */
export function isParseableDate(value: string): boolean {
  const m = DATE_RE.exec(value.trim());
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/**
 * אילוצי תקינות per-record בשלב הפענוח (§5.3):
 *  - שדה חובה ריק => ERROR
 *  - תאריך לא תקין => ERROR
 *  - שדה מספרי עם תו לא מספרי => ERROR
 *  - enum לא מוכר => WARN (מטופל בשלב התיקוף מול REF; כאן רק פורמט)
 */
export function checkField(
  block: BlockDef,
  field: FieldDef,
  rawValue: string,
  recordSeq: number,
  sourceOffset: string,
): ParseError[] {
  const value = (rawValue ?? '').trim();
  const errors: ParseError[] = [];

  if (value === '') {
    if (field.required) {
      errors.push({
        severity: 'ERROR',
        code: 'P001_REQUIRED_FIELD_EMPTY',
        message: `שדה חובה ריק: ${block.code}.${field.name}`,
        blockCode: block.code,
        recordSeq,
        field: field.name,
      });
    }
    return errors;
  }

  if (field.kind === 'date' && !isParseableDate(value)) {
    errors.push({
      severity: 'ERROR',
      code: 'P002_BAD_DATE_FORMAT',
      message: `תאריך לא תקין '${value}' בשדה ${block.code}.${field.name}`,
      blockCode: block.code,
      recordSeq,
      field: field.name,
    });
  }

  if (field.kind === 'decimal' && !DECIMAL_RE.test(value)) {
    errors.push({
      severity: 'ERROR',
      code: 'P003_NON_NUMERIC',
      message: `ערך לא מספרי '${value}' בשדה decimal ${block.code}.${field.name}`,
      blockCode: block.code,
      recordSeq,
      field: field.name,
    });
  }

  if (field.kind === 'int' && !INT_RE.test(value)) {
    errors.push({
      severity: 'ERROR',
      code: 'P003_NON_NUMERIC',
      message: `ערך לא שלם '${value}' בשדה int ${block.code}.${field.name}`,
      blockCode: block.code,
      recordSeq,
      field: field.name,
    });
  }

  return errors;
}
