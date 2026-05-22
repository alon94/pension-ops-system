import { XMLParser } from 'fast-xml-parser';
import { BLOCKS, isBlockCode } from './blocks';
import { checkField } from './field-checks';
import { MevneAhidParser } from './parser.interface';
import { ParseError, ParsedFile, ParsedRecord, TrailerCheck } from './types';

/**
 * Parser לפורמט XML — רוב הגופים החדישים (§2.4).
 *
 * מבנה צפוי:
 *   <MevneAhid standardVersion="2024.1">
 *     <Block code="010"><Record><inquiryNumber>..</inquiryNumber>..</Record></Block>
 *     <Block code="020"><Record>..</Record><Record>..</Record></Block>
 *     ...
 *     <Block code="999"><Record><recordCount>..</recordCount><checksum>..</checksum></Record></Block>
 *   </MevneAhid>
 */
export class XmlParser implements MevneAhidParser {
  readonly format = 'XML' as const;
  private readonly xml = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
  });

  parse(content: Buffer, parserVersion: string): ParsedFile {
    const records: ParsedRecord[] = [];
    const parseErrors: ParseError[] = [];

    let doc: any;
    try {
      doc = this.xml.parse(content.toString('utf8'));
    } catch (e) {
      parseErrors.push({
        severity: 'CRITICAL',
        code: 'P030_MALFORMED_XML',
        message: `XML פגום: ${(e as Error).message}`,
      });
      return {
        format: this.format,
        parserVersion,
        records,
        parseErrors,
        trailer: { declaredRecordCount: null, actualRecordCount: 0, ok: false },
      };
    }

    const root = doc?.MevneAhid;
    if (!root) {
      parseErrors.push({
        severity: 'CRITICAL',
        code: 'P031_MISSING_ROOT',
        message: "שורש <MevneAhid> חסר",
      });
      return {
        format: this.format,
        parserVersion,
        records,
        parseErrors,
        trailer: { declaredRecordCount: null, actualRecordCount: 0, ok: false },
      };
    }

    const blocks = asArray(root.Block);
    let declaredRecordCount: number | null = null;
    let dataRecordCount = 0;
    let seq = 0;

    for (const blk of blocks) {
      const code = String(blk?.['@_code'] ?? '').trim();
      if (!isBlockCode(code)) {
        parseErrors.push({
          severity: 'ERROR',
          code: 'P010_UNKNOWN_BLOCK',
          message: `קוד בלוק לא מוכר '${code}'`,
        });
        continue;
      }
      const block = BLOCKS[code];
      const recs = asArray(blk.Record);

      for (let r = 0; r < recs.length; r++) {
        seq += 1;
        const recNode = recs[r] ?? {};
        const sourceOffset = `xpath:/MevneAhid/Block[@code='${code}'][${r + 1}]`;
        const fields: Record<string, string> = {};

        for (const field of block.fields) {
          const raw = recNode[field.name];
          const value = raw === undefined || raw === null ? '' : String(raw).trim();
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
    }

    const trailer = this.checkTrailer(declaredRecordCount, dataRecordCount, parseErrors);
    return { format: this.format, parserVersion, records, parseErrors, trailer };
  }

  private checkTrailer(declared: number | null, actual: number, parseErrors: ParseError[]): TrailerCheck {
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

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
