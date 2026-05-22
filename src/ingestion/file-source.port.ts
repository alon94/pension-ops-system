/**
 * FileSource — מקור קבצים פולינג-בלבד (§5.2: SFTP/דואר/API).
 * המימוש הנוכחי הוא LocalDirSource (dev). מימוש SFTP מחליף ללא שינוי בלוגיקה.
 */

export interface IncomingFile {
  /** מזהה ייחודי לקובץ במקור — בדרך כלל הנתיב המלא */
  sourceRef: string;
  /** שם קובץ קריא לאדם */
  fileName: string;
  /** תוכן בינארי גולמי */
  content: Buffer;
}

export interface FileSource {
  readonly id: string;            // לדוגמה 'local-inbox' / 'ofnir-sftp'
  /** רושם קבצים חדשים שזמינים להזרמה. אל יחזור על קבצים שכבר טופלו. */
  list(): Promise<IncomingFile[]>;
  /** נקרא לאחר הצלחת קליטה — להזיז ל-archive או למחוק. */
  archive(sourceRef: string, outcome: 'completed' | 'failed' | 'duplicate', runId?: string): Promise<void>;
}
