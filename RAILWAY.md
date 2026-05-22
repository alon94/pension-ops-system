# Deploy to Railway

מדריך מהיר ל-deploy ראשון של ה-stack ב-Railway. אורך משוער: ~30 דקות.

## למה Railway?

- Docker-aware (משתמש ב-`Dockerfile` ו-`web/Dockerfile` ישירות)
- Postgres מנוהל מובנה ($5/חודש כשעוברים את ה-trial)
- HTTPS אוטומטי על דומיין `*.up.railway.app`
- Service-to-service networking דרך private DNS
- $5 trial credit על ההרשמה הראשונה (מספיק ל-5–7 ימי UAT)

## רכיבי ה-deployment

יש 3 services נפרדים ב-Railway:

| Service | מקור | Port | תפקיד |
|---|---|---|---|
| `postgres` | Add-on של Railway | 5432 | מסד הנתונים |
| `api` | `Dockerfile` ב-root | 3000 | NestJS — קליטה, ריג'קטים, agents |
| `web` | `web/Dockerfile` | 3001 | Next.js — UI |

ה-`docker-compose.yml` שיש בריפו מיועד לסביבה מקומית — Railway לא משתמש בו.

## צעדים

### 1. הרשמה ל-Railway

1. https://railway.app → Sign up with GitHub
2. הענק/י permission ל-Railway לראות את הריפו `alon94/pension-ops-system`
3. עם ההרשמה את/ה מקבל/ת $5 credit (לבדיקה ראשונית).

### 2. יצירת פרויקט

1. **New Project** → **Deploy from GitHub repo** → בחר/י `alon94/pension-ops-system`
2. Railway יזהה את ה-`Dockerfile` ב-root וייצור **service ראשון** (זה ה-API).

### 3. הוספת Postgres

1. בתוך הפרויקט: לחיצה על `+ Create` → **Database** → **PostgreSQL**
2. Railway ייצור service `Postgres` עם משתני סביבה אוטומטיים (`DATABASE_URL`, `PGHOST`, וכו').
3. אין צורך להגדיר schema ידנית — `entrypoint.sh` ב-API ירוץ `bootstrap-db.ts` בעלייה ראשונה.

### 4. הגדרות ה-API service

לחיצה על service ה-API → **Variables** → הוספת:

```
DATABASE_URL          = ${{Postgres.DATABASE_URL}}   ← Reference, לא ערך
PORT                  = 3000
NODE_ENV              = production
JWT_SECRET            = <אקראי 32+ תווים>             ← openssl rand -base64 48
JWT_EXPIRY            = 12h
DEFAULT_PARSER_VERSION= 2024.1
VAULT_DIR             = /tmp/vault
BOOTSTRAP_SEED        = 1                             ← פעם ראשונה בלבד; אחר כך אפס
BOOTSTRAP_DEMO_USERS  = 1                             ← פעם ראשונה בלבד; אחר כך אפס
BOOTSTRAP_WAIT_SEC    = 90
# LLM (אופציונלי — בלעדיהם A1/A8 רצים על fallback דטרמיניסטי)
ANTHROPIC_API_KEY     = <sk-ant-... אם יש>
VOYAGE_API_KEY        = <sk-voy-... אם יש>
```

**חשוב לגבי `${{Postgres.DATABASE_URL}}`**: ב-UI של Railway, הקלידו `${{` והוא ישלים אוטומטית עם autocomplete. זה reference שמתעדכן אם ה-Postgres URL משתנה.

תחת **Settings** → **Networking** → לחיצה על **Generate Domain** → תיווצר כתובת ציבורית כמו `pension-api-production.up.railway.app`.

### 5. יצירת ה-Web service

1. בפרויקט: `+ Create` → **GitHub Repo** → אותו ריפו, אבל הפעם:
2. **Settings** → **Source** → **Root Directory**: `web`
3. Railway יזהה את `web/Dockerfile` וייבנה את Next.js בנפרד.

**Variables** ל-web:

```
NODE_ENV  = production
PORT      = 3001
HOSTNAME  = 0.0.0.0
API_BASE  = https://<API public domain>     ← ה-domain מצעד 4
```

תחת **Settings** → **Networking** → **Generate Domain** → תיווצר כתובת כמו `pension-web-production.up.railway.app`.

### 6. בדיקה

1. חכה ~2–5 דקות לבנייה ראשונה (Railway ידחוף לוגים בזמן אמת).
2. ב-API service: **Logs** — מצפים לראות:
   ```
   [bootstrap] applied schema.sql ... schema.auth.sql
   [bootstrap] === BOOTSTRAP DONE ===
   Nest application successfully started
   ```
3. בדיקת health: `curl https://<api domain>/health/ready` → `{"status":"ready"}`
4. גישה ל-UI: `https://<web domain>` → דף login.
5. כניסה עם `manager@demo.local` / `manager123`.

### 7. אחרי הריצה הראשונה

חזור/י ל-API → Variables → **שנה את שני אלה**:
```
BOOTSTRAP_SEED       = 0
BOOTSTRAP_DEMO_USERS = 0
```
(אחרת בכל restart המערכת תעדיף לטעון מחדש את ה-seed — לא רצוי בסביבת test יציבה.)

## פתרון תקלות

| תופעה | סיבה | פתרון |
|---|---|---|
| API stuck ב-"Waiting for PG" | Postgres עדיין מתחיל | חכה דקה — Railway PG לוקח ~30 שניות בעלייה ראשונה |
| `/health/ready` 503 | סכמה לא הוחלה | בדוק לוגי API — אולי `BOOTSTRAP_SEED` חסר |
| Web מחזיר 502 על `/api/*` | `API_BASE` שגוי | ודא שה-URL ב-`API_BASE` הוא ה-public domain של ה-API |
| Login fails 401 | משתמשי דמו לא נוצרו | `BOOTSTRAP_DEMO_USERS=1` בריצה ראשונה |
| "ANTHROPIC_API_KEY חסר" warnings | LLM לא מוגדר | תקין — fallback דטרמיניסטי. הוסף מפתח כדי להפעיל A1/A8 אמיתיים |

## עלות משוערת

| רכיב | $/חודש (אחרי trial) |
|---|---|
| Postgres (1GB) | ~$5 |
| API service | ~$5 (תלוי בזיכרון) |
| Web service | ~$5 |
| **סה"כ UAT** | **~$15/חודש** |

ניתן להוריד ל-`sleep` mode בלא-שימוש (Settings → Sleep) → ~$0 כשלא נכנסים.

## אחרי UAT — להעביר לפרודקשן

1. שנמ/י `JWT_SECRET` למשהו חדש (sleep אחד = leak פוטנציאלי)
2. `BOOTSTRAP_DEMO_USERS=0` קבוע
3. צור משתמשים אמיתיים דרך `/admin/users`
4. דומיין custom: Settings → Networking → Add custom domain
5. שלב **MFA** (פרק 13.4) — לא ניתן ב-Railway חסר קוד; דורש פיתוח נוסף
