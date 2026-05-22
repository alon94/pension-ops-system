# Pre-Deploy Checklist — מעבר ל-test ולפרודקשן

עדכון אחרון: 2026-05-22

מסמך זה הוא מקור האמת היחיד לסטטוס deploy. ✅ = הושלם בקוד · 🔧 = דרוש פעולה
לפני test · 🚀 = דרוש פעולה לפני פרודקשן.

---

## 1) קוד וגרסה — מוכן ל-test ✅

| פריט | סטטוס | הוכחה |
|---|---|---|
| 11 פרקי האפיון (4–10, 11, 12, 13 + §5.6) מומשו | ✅ | `README.md` טבלת רכיבים |
| 139 בדיקות יחידה + אינטגרציה | ✅ | `npm test` → 15 suites, 139 passed |
| Lint נקי (API + web) | ✅ | `tsc --noEmit` ב-2 הפרויקטים |
| `PgRepository.promote` תומך בכל 12 הישויות (§5.5) | ✅ | Task #43, אומת ב-dev-server |
| Health probes (`/health/live`, `/health/ready`) | ✅ | Smoke test: 200 + schema sanity |
| ניהול משתמשים (`/admin/users` UI + API) | ✅ | MANAGER login → list + create + reset |
| Auth + RBAC + PII masking + audit log | ✅ | פרק 13 — `src/auth/*` + tests |
| Docker stack מוכן (`Dockerfile`, `web/Dockerfile`, `docker-compose.yml`) | ✅ | `docker compose config` תקין; ראו [`DEPLOY.md`](./DEPLOY.md) |
| Bootstrap אידמפוטנטי (סכמה + seed + demo users) | ✅ | אומת מול embedded PG פעמיים — שתי הריצות נקיות |
| Standalone Next.js build | ✅ | `web/.next/standalone/server.js` נוצר |

## 2) פעולות לפני העלאה לסביבת test 🔧

באחריות הצוות לפני `docker compose up`:

| # | פעולה | הוראה |
|---|---|---|
| 2.1 | סודות | `cp .env.test .env` ואז קבע `JWT_SECRET` באורך 32+ תווים (`openssl rand -base64 48`) |
| 2.2 | מפתחות LLM (אופציונלי ל-test) | ב-`.env` הזן `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY` להפעלת A1/A8/AGENT_CONTEXT אמיתיים. בלעדיהם רץ fallback דטרמיניסטי תקין |
| 2.3 | בניית images | `docker compose build --no-cache` — אורך ~5–10 דקות בריצה הראשונה |
| 2.4 | עלייה ראשונה | `docker compose up -d` עם `BOOTSTRAP_SEED=1 BOOTSTRAP_DEMO_USERS=1` (ברירת מחדל ב-`.env.test`) |
| 2.5 | בדיקה | `curl http://localhost:3000/health/ready` → `"status":"ready"` |
| 2.6 | בדיקת UI | `http://localhost:3001` → login עם `manager@demo.local / manager123` |
| 2.7 | בדיקת קליטה | העלאת `test/fixtures/sample.mevne-ahid.xml` דרך `/ingestion` או דרך volume `inbox/` |
| 2.8 | בדיקת A8 (אם יש מפתח Anthropic) | `/terminations/[id]` → העלאת PDF/JPG → אישור → יצירת FORM_161 |

> **הערכת זמן ל-test ready:** עם Docker מותקן ו-`.env` מוגדר — 15–20 דקות מהתחלת
> ה-clone ועד שכל המסכים נגישים.

## 3) תלויות חיצוניות — חייבות לפני פרודקשן 🚀

הקוד **לא** כולל אינטגרציה לכמה מערכות חיצוניות. כל אחת היא ~50–200 שורות
מעל ה-interfaces הקיימים:

| תלות | מצב נוכחי | מה צריך | קובץ |
|---|---|---|---|
| SFTP מסלקה אמיתית | `LocalDirSource` בלבד | לממש `SftpSource` שמיישם את ה-interface `FileSource` | `src/ingestion/local-dir.source.ts` (תבנית) |
| OCR אמיתי לטופס 161 | Vision של Anthropic + fallback דטרמיניסטי | להזין `ANTHROPIC_API_KEY`; אם בוחרים provider אחר — להחליף `Form161VisionExtractor` | `src/agents/a8-vision/` |
| Notifications (A9) | stub בלבד | לממש מול SendGrid/Twilio | `src/agents/a9.notification.ts` |
| CRM ל-A4 | רץ על AGENT_CONTEXT | לקרוא ל-CRM API לפני יצירת המלצה | `src/agents/a4.sales-prod.ts` |
| MFA | אין בקוד | להוסיף שכבת TOTP לפני `/auth/login` | פרק 13.4 באפיון |
| מנהל סודות | env vars בלבד | להזרים secrets מ-AWS Secrets Manager / Azure Key Vault | `docker-compose.yml` (להחליף `${JWT_SECRET}` ב-secret reference) |
| TLS | HTTP בלבד | reverse proxy (nginx/caddy/ALB) עם cert | מחוץ ל-repo — דרישת תשתית |
| Postgres מנוהל | container | להחליף ל-RDS/Azure Postgres ולהסיר את שירות `postgres` מ-compose | `docker-compose.yml` |
| Backups | אין | `pg_dump` יומי + retention 30+ ימים | אוטומציה ב-CI/scheduler חיצוני |
| Monitoring | logs בלבד | להוסיף Prometheus metrics + log shipper | `dist/main.ts` (אפשר להוסיף `@willsoto/nestjs-prometheus`) |

## 4) שינויים נדרשים ב-compose לפני פרודקשן 🚀

```diff
- ports:
-   - "${POSTGRES_PORT:-55432}:5432"   # למחוק! לא לחשוף DB ל-host
+ # postgres נגיש רק דרך ה-network הפנימי

- BOOTSTRAP_SEED: ${BOOTSTRAP_SEED:-0}
- BOOTSTRAP_DEMO_USERS: ${BOOTSTRAP_DEMO_USERS:-0}
+ BOOTSTRAP_SEED: 0
+ BOOTSTRAP_DEMO_USERS: 0

  # להוסיף resource limits
+ deploy:
+   resources:
+     limits:
+       memory: 2G
+       cpus: '1.0'
```

## 5) צ'קליסט מקוצר — "האם אפשר deploy ל-test"

חתום ✅ על כל פריט לפני שמריצים `docker compose up`:

- [ ] Docker 24+ + Docker Compose v2 מותקנים
- [ ] `.env` קיים עם `JWT_SECRET` באורך 32+ תווים
- [ ] פורטים 3000, 3001, 55432 פנויים
- [ ] (אופציונלי) `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` ב-`.env`
- [ ] `docker compose build` הסתיים ללא שגיאות
- [ ] `docker compose up -d` ואז `docker compose logs -f api` — מצפים ל-"BOOTSTRAP DONE"
- [ ] `curl http://<host>:3000/health/ready` → 200 עם `"checks":{...}`
- [ ] התחברות ל-UI כ-MANAGER הצליחה
- [ ] קליטת קובץ דוגמה מאוכלסת ב-`/ingestion`
- [ ] `/customer/<id>` מציג נתוני 360 כולל "תקציר לקראת פגישה"

## 6) צ'קליסט מקוצר — "האם אפשר deploy לפרודקשן"

בנוסף לכל פריטי §5:

- [ ] הוחלפו כל ה-defaults של סיסמאות (Postgres, JWT, וכל סוד אחר)
- [ ] `BOOTSTRAP_SEED=0 BOOTSTRAP_DEMO_USERS=0` ב-prod env
- [ ] Postgres מנוהל (RDS / Azure DB) — לא container
- [ ] reverse proxy עם TLS לפני `web` ו-`api`
- [ ] שכבת MFA לפני `/auth/login` (פרק 13.4)
- [ ] `pg_dump` יומי מוגדר ב-scheduler
- [ ] log shipping ל-CloudWatch / Application Insights
- [ ] חוזה אינטגרציה חתום מול ספק SFTP של המסלקה
- [ ] DPO + יועץ משפטי אישרו שמירת PII (פרק 10 — masking + retention)
- [ ] תרגיל DR: שחזור מ-backup הוכח ידנית פעם אחת לפחות

---

## תשובה ישירה לשאלה "מתי אפשר deploy ל-test?"

**עכשיו** — מבחינת הקוד והאוטומציה. כל מה שנדרש הוא:

1. שרת עם Docker
2. עריכת `.env` (JWT_SECRET חובה, מפתחות LLM אופציונליים)
3. `docker compose up --build -d`

זמן בפועל ל-test ready: **15–20 דקות**.

**מתי אפשר עלייה לאוויר?** כשעוברים על §3 + §4 + §6. הסעיף הקריטי שדורש החלטה
מוקדמת הוא **§3.1 (SFTP מסלקה)** ו-**§3.5 (MFA)** — שניהם דורשים תיאום עם ספקים
חיצוניים ו-2–3 ימי פיתוח כל אחד.
