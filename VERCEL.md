# Deploy ה-UI ב-Vercel (Hybrid mode)

מדריך מהיר לחיבור Next.js (`web/`) ל-Vercel. ה-API + Postgres רצים ב-Railway
(ראו [RAILWAY.md](./RAILWAY.md)).

## דרישות מקדימות

- ✅ Railway פרויקט עם **API service** ו-**Postgres** למעלה (לפני Vercel!)
- ✅ ה-API מחזיר `200` על `https://<api-domain>.up.railway.app/health/ready`

> Vercel דורש שה-API יהיה זמין ויציב לפני שהוא בונה את ה-UI. אחרת ה-build יצליח
> אבל הדפדפן יקבל 502 על `/api/*`.

## למה Vercel ל-UI?

- **חינם** בתכנית Hobby — מתאים ל-Next.js עד 100GB bandwidth/חודש
- **CDN גלובלי** — UI מגיע מהירות מ-edge ה-Vercel הקרובים למשתמש
- **Deploy אוטומטי** מכל push ל-GitHub
- **Preview deployments** — כל branch מקבל URL לבדיקה לפני merge

## צעדים

### 1. הרשמה ל-Vercel

1. https://vercel.com → **Sign up with GitHub**
2. הענק/י permission ל-Vercel לראות את הריפו `alon94/pension-ops-system`.

### 2. יצירת הפרויקט

1. **Add New** → **Project**
2. **Import** את `alon94/pension-ops-system`
3. **חשוב — Root Directory**: לחיצה על **Edit** ובחירת `web/` (זה לא root!)
4. **Framework Preset**: Next.js (זוהה אוטומטית) — נשאר כפי שזוהה
5. **Build & Output Settings**: השאר/י את ברירות המחדל (Vercel מנהל את זה)

### 3. Environment Variables (לפני Deploy)

בעמוד ה-import עצמו, גלילה ל-**Environment Variables**, הוספת:

```
Name: API_BASE
Value: https://<api-domain>.up.railway.app     ← ה-URL של ה-API מ-Railway
Apply to: Production, Preview, Development
```

> ⚠️ בלי `/` בסוף ה-URL. דוגמה: `https://pension-api-production.up.railway.app`

### 4. Deploy

1. **Deploy** — Vercel יבנה ויעלה (~3 דקות לבנייה ראשונה).
2. כשמסיים: כתובת ה-UI הציבורית — משהו כמו:
   ```
   https://pension-ops-system-<random>.vercel.app
   ```
3. או בדומיין הקצר: `https://pension-ops-system.vercel.app` (אם פנוי).

### 5. בדיקה

1. פתח/י את ה-URL בדפדפן → דף login.
2. כניסה עם `manager@demo.local` / `manager123`.
3. אם 502 על `/api/*`:
   - ודא/י שה-API ב-Railway חי: `curl https://<api-domain>.up.railway.app/health/ready`
   - ודא/י שה-`API_BASE` ב-Vercel נכון (Settings → Environment Variables)
   - לאחר שינוי env var ב-Vercel: **Redeploy** (Deployments → ⋯ → Redeploy)

### 6. CORS — אם רואה blocked

ה-API מוגדר עם `enableCors({ origin: true })` שאמור לעבוד. אם בכל זאת יש בעיה,
ערוך את `src/main.ts`:

```typescript
app.enableCors({
  origin: ['https://your-app.vercel.app', /\.vercel\.app$/],
  credentials: true,
});
```

ואז: `git push` → Railway יעדכן את ה-API אוטומטית.

## דומיין custom (אופציונלי)

1. Vercel → Project → **Settings** → **Domains** → **Add**
2. הכנס/י את הדומיין שלך (למשל `pension.example.co.il`)
3. Vercel יסביר אילו DNS records להוסיף ב-domain registrar
4. אישור TLS אוטומטי תוך דקות

## עלות

| תכנית | מחיר | מתאים ל... |
|---|---|---|
| Hobby (default) | **חינם** | UAT, demos, projects אישיים |
| Pro | $20/חודש | preview deployments + analytics + שיתופי צוות |
| Enterprise | בקשת cot | SLA, SOC 2, וכו' |

100GB/חודש bandwidth חינם — די לכמה אלפי משתמשים בחודש בתכנית Hobby.

## הזרמה אוטומטית

מהרגע שחיברנו, כל `git push origin main`:
- **Vercel** מעדכן את ה-UI תוך ~30 שניות
- **Railway** מעדכן את ה-API תוך ~2 דקות
- שניהם בו-זמנית, ללא downtime
