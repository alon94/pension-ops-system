import { Injectable } from '@nestjs/common';
import { FixedWidthParser } from './fixed-width.parser';
import { MevneAhidParser } from './parser.interface';
import { FileFormat } from './types';
import { XmlParser } from './xml.parser';

/**
 * זיהוי פורמט וגרסה (§5.3 שלב 2):
 *  - זיהוי לפי sniffing של תחילת התוכן (XML מתחיל ב-'<').
 *  - גרסת מבנה אחיד נשלפת מ-standardVersion (XML attr / שדה Header 010).
 *  - תאימות אחורה: ה-Parser תומך במספר גרסאות; parser_version מתועד ב-INGESTION_RUN.
 */
@Injectable()
export class ParserFactory {
  private readonly xml = new XmlParser();
  private readonly fw = new FixedWidthParser();

  detectFormat(content: Buffer): FileFormat {
    const head = content.slice(0, 256).toString('utf8').trimStart();
    return head.startsWith('<') ? 'XML' : 'FIXED_WIDTH';
  }

  /** מנסה לחלץ את גרסת התקן מהקובץ; נופל לברירת מחדל אם לא נמצאה. */
  detectVersion(content: Buffer, format: FileFormat, fallback: string): string {
    const text = content.toString('utf8');
    if (format === 'XML') {
      const m = /standardVersion\s*=\s*"([^"]+)"/.exec(text) || /<standardVersion>([^<]+)<\/standardVersion>/.exec(text);
      return m ? m[1].trim() : fallback;
    }
    // Fixed-Width: שדה standardVersion בבלוק 010 (offset 41, width 12)
    const headerLine = text.split(/\r?\n/).find((l) => l.startsWith('010'));
    if (headerLine && headerLine.length >= 53) {
      const v = headerLine.slice(41, 53).trim();
      if (v) return v;
    }
    return fallback;
  }

  getParser(format: FileFormat): MevneAhidParser {
    return format === 'XML' ? this.xml : this.fw;
  }
}
