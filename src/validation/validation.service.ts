import { Injectable } from '@nestjs/common';
import { ParsedFile } from '../mevne-ahid/types';
import { CrossBlockContext, validateCrossBlock } from './cross-block.validators';
import { validateRecord } from './record.validators';
import { validateTemporal } from './temporal.validators';
import { Severity, ValidationIssue, ValidationResult } from './types';

const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, WARN: 1, ERROR: 2, CRITICAL: 3 };

/**
 * שלב 3 — תיקוף (§5.4). מאחד תיקוף record-level, cross-block ו-temporal,
 * וגוזר את תוצאת הריצה:
 *  - כל CRITICAL => הריצה כולה נכשלת (hasCritical).
 *  - ERROR => recordSeq נכשל ולא יקודם; הקליטה ממשיכה לשאר.
 */
@Injectable()
export class ValidationService {
  validate(parsed: ParsedFile, ctx: CrossBlockContext = {}, now = new Date()): ValidationResult {
    const issues: ValidationIssue[] = [];

    // שגיאות פענוח (§5.3) משוקללות לתוך אותה תוצאה — CRITICAL מהן עוצר גם כן
    for (const pe of parsed.parseErrors) {
      issues.push({
        code: pe.code,
        severity: pe.severity,
        message: pe.message,
        blockCode: pe.blockCode,
        recordSeq: pe.recordSeq,
        field: pe.field,
      });
    }

    for (const rec of parsed.records) {
      issues.push(...validateRecord(rec, now));
    }
    issues.push(...validateCrossBlock(parsed.records, ctx));
    issues.push(...validateTemporal(parsed.records));

    const failedRecordSeqs = new Set<number>();
    let hasCritical = !parsed.trailer.ok; // §5.3 — trailer לא תקין הוא CRITICAL

    for (const it of issues) {
      if (it.severity === 'CRITICAL') hasCritical = true;
      if (it.severity === 'ERROR' && it.recordSeq !== undefined) failedRecordSeqs.add(it.recordSeq);
    }

    issues.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    return { issues, failedRecordSeqs, hasCritical };
  }
}
