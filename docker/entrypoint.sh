#!/usr/bin/env bash
# entrypoint.sh — מריץ bootstrap לסכמה (אידמפוטנטי) ואז את ה-CMD שהועבר.
#
# שלבים:
#   1. בודק DATABASE_URL
#   2. מריץ bootstrap-db (sql + seed אופציונלי + demo users אופציונלי)
#      מקובץ JS מקומפל-מראש — אין תלות ב-ts-node ב-runtime.
#      (CMD ENTRYPOINT_SKIP_BOOTSTRAP=1 לדלג, למשל אם רוצים להריץ מיגרציה ידנית)
#   3. exec לפקודת הראש (start:prod כברירת מחדל)

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[entrypoint] FATAL: DATABASE_URL לא מוגדר"
  exit 1
fi

if [[ "${ENTRYPOINT_SKIP_BOOTSTRAP:-0}" == "1" ]]; then
  echo "[entrypoint] ENTRYPOINT_SKIP_BOOTSTRAP=1 — מדלג על bootstrap"
else
  echo "[entrypoint] running db bootstrap..."
  node /app/scripts/bootstrap-db.js
  echo "[entrypoint] bootstrap done"
fi

echo "[entrypoint] exec: $*"
exec "$@"
