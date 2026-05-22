/** טיפוסים למסך קליטה (פרק 12 § extension + §5.x). */

export interface IngestionRunListItem {
  ingestionRunId: string;
  sourceFileName?: string;
  fileHash: string;
  source?: string;
  parserVersion?: string;
  status: string;          // received|parsing|validating|promoting|completed|failed|rolled_back
  error?: string;
  receivedAt: string;
  completedAt?: string;
  /** ספירות מסכמות לתצוגה מהירה */
  rawCount: number;
  errorCount: number;
  criticalCount: number;
  rejectsCount: number;
}

export interface IngestionRunDetail extends IngestionRunListItem {
  errors: { code: string; severity: string; message: string; blockCode?: string; recordSeq?: number; field?: string }[];
  promotedByEntity: { entity: string; count: number }[];  // sum from raw_staging by target_entity
}
