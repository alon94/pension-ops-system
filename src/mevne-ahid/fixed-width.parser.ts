import { BLOCKS, BLOCK_CODE_WIDTH, isBlockCode } from './blocks';
import { checkField } from './field-checks';
import { MevneAhidParser } from './parser.interface';
import { ParseError, ParsedFile, ParsedRecord, TrailerCheck } from './types';

/**
 * Parser לפורמט רוחב-שורה קבוע (Fixed-Width) — מערכות מורשת של גופים ותיקים (§2.4).
 * שורה = קוד בלוק (3 תווים) + שדות לפי פריסת ה-BlockDef.
 */
export class FixedWidthParser implements MevneAhidParser {
  readonly format = 'FIXED_WIDTH' as const;

  parse(content: Buffer, parserVersion: string): ParsedFile {
    const text = content.toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const records: ParsedRecord[] = [];
    const parseErrors: ParseError[] = [];
    let declaredRecordCount: number | null = null;
    let dataRecordCount = 0;
    let seq = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sourceOffset = `line:${i + 1}`;
      const code = line.slice(0, BLOCK_CODE_WIDTH).trim();

      if (!isBlockCode(code)) {
        parseErrors.push({
          severity: 'ERROR',
          code: 'P010_UNKNOWN_BLOCK',
          message: `קוד בלוק לא מוכר '${code}' בשורה ${i + 1}`,
          recordSeq: i + 1,
        });
        continue;
      }

      seq += 1;
      const block = BLOCKS[code];
      const fields: Record<string, string> = {};

      for (const field of block.fields) {
        const value = line.slice(field.offset, field.offset + field.width).trim();
        fields[field.name] = value;
        parseErrors.push(...checkField(block, field, value, seq, sourceOffset));
      }

      if (code === '999') {
        const n = Number(fields.recordCount);
        declaredRecordCount = Number.isFinite(n) ? n : null;
      } else {
        dataRecordCount += 1;
      }

      records.push({ blockCode: code, recordSeq: seq, fields, sourceOffset });
    }

    const trailer = this.checkTrailer(declaredRecordCount, dataRecordCount, parseErrors);
    return { format: this.format, parserVersion, records, parseErrors, trailer };
  }

  private checkTrailer(declared: number | null, actual: number, parseErrors: ParseError[]): TrailerCheck {
    // §5.3 — אי-תאימות trailer => CRITICAL (עוצר את כל הקליטה).
    if (declared === null) {
      parseErrors.push({
        severity: 'CRITICAL',
        code: 'P020_MISSING_TRAILER',
        message: 'בלוק 999 (Trailer) חסר או שספירת הרשומות בו אינה תקינה',
      });
      return { declaredRecordCount: declared, actualRecordCount: actual, ok: false };
    }
    const ok = declared === actual;
    if (!ok) {
      parseErrors.push({
        severity: 'CRITICAL',
        code: 'P021_TRAILER_MISMATCH',
        message: `אי-תאימות trailer: declared=${declared}, actual=${actual}`,
      });
    }
    return { declaredRecordCount: declared, actualRecordCount: actual, ok };
  }
}
