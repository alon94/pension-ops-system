/** Badges סמנטיים עם נקודה צבעונית — מתאים למיון מהיר בעיניים. */

const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: 'קריטי',
  HIGH: 'גבוה',
  MEDIUM: 'בינוני',
  LOW: 'נמוך',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'פתוח',
  IN_PROGRESS: 'בטיפול',
  WAITING_MANUFACTURER: 'ממתין ליצרן',
  WAITING_CUSTOMER: 'ממתין ללקוח',
  ESCALATED: 'הוסלם',
  RESOLVED: 'נפתר',
  DISMISSED: 'נדחה',
};

export function SeverityBadge({ value }: { value: string }) {
  return (
    <span className={`badge badge-dot sev-${value}`}>
      {SEVERITY_LABEL[value] ?? value}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`badge badge-dot status-${value}`}>
      {STATUS_LABEL[value] ?? value.replace(/_/g, ' ')}
    </span>
  );
}
