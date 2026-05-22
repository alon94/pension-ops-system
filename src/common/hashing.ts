import { createHash } from 'node:crypto';

/** SHA-256 hex של תוכן קובץ — file_hash ב-INGESTION_RUN (§5.2). */
export function sha256(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}
