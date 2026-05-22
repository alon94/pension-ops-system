#!/usr/bin/env bash
# entrypoint.sh — מריץ bootstrap לסכמה (אידמפוטנטי) ואז את ה-CMD שהועבר.
#
# שלבים:
#   1. בודק DATABASE_URL
#   2. מריץ bootstrap-db (sql + seed אופציונלי + demo users אופציונלי) דרך ts-node
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
  # ts-node מקבל את הקוד המקור — לא תלוי בהצלחת tsc על scripts/
  npx ts-node --transpile-only /app/scripts/bootstrap-db.ts
  echo "[entrypoint] bootstrap done"
fi

echo "[entrypoint] exec: $*"
exec "$@"
