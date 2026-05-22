# מדריך Deploy לסביבת test

מדריך מהיר להעלאת המערכת ב-docker-compose. מיועד לסביבת **test** לפני עלייה
לאוויר. עבור פרודקשן ראו `# הערות לפרודקשן` בסוף.

## דרישות מקדימות

- Docker 24+ ו-Docker Compose v2
- 4GB RAM פנויים, ~5GB דיסק (לתמונה+volume)
- פורטים פנויים: 3000 (API), 3001 (web), 55432 (PG host-side)

## הפעלה

```bash
# 1. העתיקו את תבנית ה-env והחליפו את ה-secrets
cp .env.test .env

# 2. הזינו ב-.env לפחות:
#    JWT_SECRET    — אקראי, 32+ תווים     →  openssl rand -base64 48
#    ANTHROPIC_API_KEY  (אופציונלי — בלעדיו A1/A8 רצים על fallback)
#    VOYAGE_API_KEY     (אופציונלי — בלעדיו embeddings על hash מקומי)

# 3. בנו ועלו את כל ה-stack
docker compose up --build -d

# 4. עקבו ב-logs עד שה-API מסיים bootstrap
docker compose logs -f api
# מצפים לראות:
#   [bootstrap] applied schema.sql ... schema.auth.sql
#   [bootstrap] === BOOTSTRAP DONE ===
#   Nest application successfully started

# 5. וידוא בריאות
curl http://localhost:3000/health/live   # → {"status":"live", ...}
curl http://localhost:3000/health/ready  # → {"status":"ready", "checks": {...}}

# 6. כניסה ל-UI: http://localhost:3001
#    משתמשי דמו (כש-BOOTSTRAP_DEMO_USERS=1):
#      operator@demo.local / operator123    (רפרנט)
#      manager@demo.local  / manager123     (מנהל — כולל גישה לניהול משתמשים)
#      auditor@demo.local  / auditor123     (בקר)
#      regulator@demo.local/ regulator123   (רגולציה)
```

## טעינת קובץ מבנה אחיד אמיתי

יש שתי דרכים:

1. **דרך ה-UI**: `/ingestion` → "העלאה ידנית" → בחירת קובץ XML/Fixed-Width.
2. **דרך file watcher**: העתיקו את הקובץ ל-volume `inbox`:

```bash
# מאתרים את ה-path של ה-volume:
docker volume inspect pension-ops-system_inbox -f '{{ .Mountpoint }}'
# או דרך container:
docker compose cp ./sample.mevne-ahid.xml api:/inbox/
# הקובץ ייקלט אוטומטית תוך 5 שניות → ייעבר ל-/inbox-done/<runId>__<filename>
```

## כיבוי + ניקוי

```bash
docker compose down                 # עוצר ומשאיר volumes (נתונים שורדים)
docker compose down -v              # מוחק גם את ה-volumes (איפוס מלא)
```

## פתרון תקלות

| תסמין | סיבה אפשרית | פתרון |
|---|---|---|
| `api` נכשל ב-bootstrap עם "DATABASE_URL לא מוגדר" | חסר `.env` או חסר `JWT_SECRET` | `cp .env.test .env` + קביעת `JWT_SECRET` |
| `/health/ready` מחזיר 503 | DB עוד לא קלט סכמות | חכו 30 שניות; אם נמשך — בדקו `docker compose logs api` |
| UI מחזיר 502 ל-`/api/*` | API לא בריא | `docker compose logs api` |
| OCR (A8) לא עובד | `ANTHROPIC_API_KEY` ריק | המערכת רצה על fallback דטרמיניסטי (זה תקין ל-test) |
| `port already allocated` | פורט 3000/3001/55432 תפוס | שנו `API_PORT`/`WEB_PORT`/`POSTGRES_PORT` ב-`.env` |

## הערות לפרודקשן

הקובץ הזה מתאר **test** בלבד. לפני עלייה לאוויר חובה:

1. **`JWT_SECRET`** — מתוך מנהל סודות (AWS Secrets Manager / Azure Key Vault)
2. **`POSTGRES_PASSWORD`** — להחליף; **לא לחשוף את 5432 ל-host** (להוריד את המיפוי `${POSTGRES_PORT}:5432`)
3. **`BOOTSTRAP_DEMO_USERS=0`** — לא לפתח משתמשי דמו!
4. **`BOOTSTRAP_SEED=0`** — לא לטעון seed.sql של נתוני דוגמה
5. **TLS** — לעטוף את `web` ב-reverse proxy (nginx/caddy) עם cert תקין
6. **Postgres מנוהל** — ב-prod עדיף RDS / Azure Database for PostgreSQL במקום container; להעביר `DATABASE_URL` ולהסיר את שירות ה-`postgres` מ-compose
7. **Volumes** — לעבור ל-S3 ל-VAULT_DIR ול-SFTP ל-inbox במקום bind mounts
8. **Logging + Monitoring** — לחבר `docker logs` ל-CloudWatch/Application Insights, להוסיף Prometheus metrics
9. **Backups** — `pg_dump` יומי של מסד הנתונים, retention 30+ ימים
10. **MFA** — להוסיף שכבת MFA לפני login (לא בקוד כרגע; ראו פרק 13.4 באפיון)

---

## תלויות חיצוניות שטרם הוטמעו

הקוד הנוכחי **לא** כולל אינטגרציה ל:

- **SFTP מסלקה** — בקוד יש `FileSource` interface ו-`LocalDirSource`; הוספת `SftpSource` היא ~50 שורות
- **SendGrid/Twilio** ל-A9 (notifications) — A9 כרגע stub
- **CRM** ל-A4 — A4 רץ על AGENT_CONTEXT בלבד
- **OCR אמיתי בקבצים סרוקים** — A8 כן מאפשר ANTHROPIC_API_KEY → Vision; ללא מפתח רץ fallback דטרמיניסטי

לכל אחד יש interface נקי — להחלפת הימפלמנטציה ב-DI לפני העלייה.
