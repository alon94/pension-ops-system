import { BlockCode } from './blocks';

/**
 * רשומה גולמית אחידה — היחידה שנשמרת ב-RAW_STAGING (§5.3).
 * שורה אחת לכל record גולמי מהקובץ.
 */
export interface ParsedRecord {
  blockCode: BlockCode;
  /** מספר רץ של הרשומה בקובץ (1-based, על פני כל הבלוקים) */
  recordSeq: number;
  /** ערכי השדות לפי שמות לוגיים מ-blocks.ts */
  fields: Record<string, string>;
  /** מיקום מקור — מספר שורה (FW) או נתיב XPath (XML) — לצורך debug ו-traceability */
  sourceOffset: string;
}

export type FileFormat = 'XML' | 'FIXED_WIDTH';

export interface ParsedFile {
  format: FileFormat;
  parserVersion: string;
  records: ParsedRecord[];
  /** שגיאות פענוח ברמת רשומה (§5.3) — לא עוצרות את הקובץ אלא אם CRITICAL */
  parseErrors: ParseError[];
  /** תוצאת בדיקת trailer 999 מול ספירה בפועל */
  trailer: TrailerCheck;
}

export interface ParseError {
  severity: 'CRITICAL' | 'ERROR' | 'WARN';
  code: string;
  message: string;
  blockCode?: BlockCode;
  recordSeq?: number;
  field?: string;
}

export interface TrailerCheck {
  declaredRecordCount: number | null;
  actualRecordCount: number;
  /** האם בלוק 999 קיים והספירה תואמת (§5.3 — אי-תאימות => CRITICAL) */
  ok: boolean;
}
