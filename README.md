# מערכת תפעול פנסיוני — ליבת קליטה ממסלקה פנסיונית

מימוש **ליבת הקליטה** (Ingestion Core) של מערכת התפעול הפנסיוני, לפי
`אפיון_מערכת_תפעול_פנסיוני.md`. זהו היסוד שכל שאר השכבות (אייג'נטים, ריג'קטים,
טופס 161, בקרת גבייה, UI) נבנות מעליו.

**Stack:** NestJS + TypeScript + PostgreSQL 15+ · בדיקות Jest.

## מה כלול בליבה

| רכיב | קבצים | סעיף באפיון |
|---|---|---|
| מודל נתונים (21 ישויות + הרחבות §4.4) | `src/persistence/schema.sql` | פרק 4 |
| פורמט מבנה אחיד — בלוקים 010–999 | `src/mevne-ahid/blocks.ts` | §2.4 |
| Parser XML | `src/mevne-ahid/xml.parser.ts` | §5.3 |
| Parser Fixed-Width (מערכות מורשת) | `src/mevne-ahid/fixed-width.parser.ts` | §5.3, §2.5 |
| זיהוי פורמט + גרסת תקן (תאימות אחורה) | `src/mevne-ahid/parser.factory.ts` | §5.3 |
| ספרת ביקורת ת.ז./ח.פ. | `src/common/israeli-id.ts` | §4.3, §5.4 |
| תיקוף record / cross-block / temporal | `src/validation/*` | §5.4 |
| צינור 5 שלבים + rollback | `src/ingestion/ingestion.service.ts` | §5.1–§5.7 |
| טריגרים לאייג'נטים (A4/A6/A7/A11) | `src/ingestion/post-process.service.ts` | §5.6 |
| **ניהול ריג'קטים** — REJECT entity, קטלוג R001–R015, lifecycle, SLA פנימי+חיצוני, גזירה אוטומטית מ-validation issues, פערים בין מקורות (R008/R009/R010/R015), דגלי סיכון | `src/rejects/*` + `src/persistence/schema.rejects.sql` | פרק 7 |
| **סיום עבודה וטופס 161** — TERMINATION_EVENT + FORM_161, זיהוי A6 (potential/confirmed), אילוצי אריתמטיקה+חתימות+סף יועץ, lifecycle, חסימת WITHDRAWAL פיצויים ללא טופס מאומת, suppression §8.5(7), סימון vatika §8.5(9) | `src/termination/*` + `src/persistence/schema.termination.sql` | פרק 8 |
| **בקרת גבייה** — COLLECTION_DISCREPANCY, בקרה דו-שלבית (expected→employer→clearing), טיפוסי פערים MISSING/WRONG_FUND/WRONG_AMOUNT/WRONG_SPLIT/LATE/OVER_CAP/EMPLOYER_INSOLVENT, סובלנות עיגול ₪5, סעיף 14, תקרת חוק חוצת-מעסיקים, lifecycle, דוח חודשי | `src/collection/*` + `src/persistence/schema.collection.sql` | פרק 9 |
| **ייפוי כוח ופרטיות** — AUTHORIZATION מורחב + AUTHORIZATION_TEMPLATE, scope check (full/read_only/specific_products/specific_manufacturers), supersede אוטומטי, חסימת DECEASED/MINOR, פקיעה אוטומטית, ביטול, audit log, HMAC tokenization, masking, anonymization, Right-to-Access | `src/authorization/*` + `src/persistence/schema.authorization.sql` | פרק 10 |
| **שכבת אייג'נטים A1–A11** — Agent interface אחיד + autonomy levels (§11.5), Orchestrator עם priority queue + retry + audit, A1 (Meeting Quality — דוח אמיתי), A2/A3 (rejects wrappers), A4 (sales-prod), A5/A7 (collection), A6 (termination), A8/A9/A10 (stubs להרחבה), A11 (audit) | `src/agents/*` | פרק 11 |
| **שכבת UI** — Next.js 14 (App Router) + Tailwind + RTL + פונט Heebo. 8 מסכים פעילים: דשבורד יומי, ריג'קטים (רשימה + פרטים), בקרת גבייה חודשית, סיומי עבודה + טופס 161, ניהול ייפויי כוח (active/expiring/expired/revoked), דשבורד מנהל (KPIs + Top employers/manufacturers), Audit & Compliance (חיפוש ב-AUDIT_LOG + גרסאות מבנה אחיד), תיק לקוח 360 | `web/`, `src/api/` | פרק 12 (§12.2 #1-#8) |
| **AGENT_CONTEXT + LLM** — ישות agent_context (summary jsonb + embedding 1536-dim + risk/opportunity flags), Anthropic SDK עם claude-opus-4-7 + adaptive thinking + prompt caching, EmbeddingProvider (Voyage real / hash מקומי dev fallback), LlmProvider (Claude real / Hebrew deterministic dev fallback), A1 משודרג ל-LLM, רענון אוטומטי ב-post-process, פאנל "תקציר לקראת פגישה" ב-Customer 360 | `src/agent-context/*`, `web/components/AiBriefing.tsx` | §5.6, פרק 11 |
| **Auth + RBAC + פרק 13** — JWT login (bcrypt + @nestjs/jwt), 4 תפקידים (OPERATOR/MANAGER/AUDITOR/REGULATOR), JwtAuthGuard גלובלי עם @Public, RolesGuard עם @Roles, **PiiMaskInterceptor** שמסך ת.ז. ל-OPERATOR, AuditInterceptor שכותב כל mutation ל-audit_log, login page + cookie-based session, role-based nav hiding, Next.js middleware שמפנה ל-/login | `src/auth/*`, `web/lib/auth.ts`, `web/middleware.ts`, `web/app/login/`, `web/components/AppHeader.tsx` | פרק 13 §13.1 |
| **אוטומציית קליטה** — `FileSource` interface + `LocalDirSource` + `FileWatcherService` שסורק תיקייה כל 5s ומזרים קבצים דרך הצינור, debounce על קבצים שעדיין בכתיבה, archive ל-`.dev-inbox-done/<runId>__<filename>`. UI: מסך `/ingestion` עם טבלת ריצות + העלאה ידנית + עמוד פירוט עם errors + promotedByEntity | `src/ingestion/file-watcher.service.ts`, `local-dir.source.ts`, `web/app/ingestion/*` | §5.2 |
| **A8 Vision OCR לטופס 161** — `Form161VisionExtractor` עם Anthropic Vision (PDF/JPG/PNG) → JSON מובנה + confidence + notes + prompt caching, fallback mock דטרמיניסטי שמייצר ערכים על-בסיס שם קובץ. `A8DocumentUnderstandingAgent` משדרג ל-PARTIAL, מריץ את חוקי §8.4 על השדות החולצים ומחזיר `validationIssues`. UI: דף `/terminations/[id]` חדש עם פאנל העלאה → תצוגת preview עריכה → אישור → יצירת FORM_161 ב-DRAFT | `src/agents/a8-vision/`, `src/agents/a8.document-understanding.ts`, `web/components/Form161OcrUpload.tsx`, `web/app/terminations/[id]/` | §11.2 A8, §8.4 |

צינור הקליטה: **Receive → Parse → Validate → Promote → Post-Process**, כטרנזקציה
לוגית. `CRITICAL` עוצר את כל הריצה; `ERROR` מדלג על רשומה בודדת; `WARN`/`INFO`
נקלטים עם התראה (§5.4).

## ארכיטקטורת הנתונים — Repository Port

הפייפליין תלוי ב-`Repository` (פורט) בלבד:

- `PgRepository` — מימוש PostgreSQL מול `schema.sql` (פרודקשן).
- `InMemoryRepository` — מימוש בזיכרון, משקף נאמנה את סדר הקידום §5.5 ואת
  אילוצי §4.3. הוא ה**מימוש הנבדק** ומאפשר בדיקת ליבה מלאה ללא Postgres חי.

## הרצה — פיתוח מקומי

```bash
npm install
npm test                 # 139 בדיקות יחידה + אינטגרציה (InMemoryRepository)
npm run e2e:real         # אימות end-to-end מול Postgres אמיתי (embedded-postgres) — schemas + seed + HTTP POST + verification
npm run dev:server       # מרים PG משובץ + NestJS + נתוני דמו, נשאר חי לפיתוח UI
npm run lint             # tsc --noEmit

# מסך UI (טרמינל נפרד):
cd web && npm install && npm run dev   # http://localhost:3001
```

## הפעלה ב-docker-compose (סביבת test)

מעטפת Docker מלאה ל-stack `postgres + api + web`. מתאים לסביבת test/UAT לפני
עלייה לאוויר. ראו [`DEPLOY.md`](./DEPLOY.md) למדריך מפורט.

```bash
cp .env.test .env       # ויש לקבוע JWT_SECRET (32+ תווים)
docker compose up --build -d
# UI: http://localhost:3001 · API: http://localhost:3000 · health: /health/ready
```

API:
- `POST /ingestion/files` · `POST /ingestion/runs/:id/rollback` (פרק 5)
- `POST /rejects/:id/transition` · `POST /rejects/escalate-overdue` · `GET /rejects/customer/:id/risk-flags` (פרק 7)
- `POST /terminations/scan` · `POST /terminations/:id/transition` · `POST /terminations/:id/forms-161` · `POST /forms-161/:id/transition` (פרק 8)
- `POST /collection/reconcile` · `POST /collection/discrepancies/:id/transition` · `GET /collection/reports/:month` (פרק 9)
- `POST /authorizations` · `POST /authorizations/:id/revoke` · `POST /authorizations/expire-due` · `POST /authorizations/customer/:id/check` · `GET /authorizations/customer/:id/export` (פרק 10)

קבצי דוגמה: `test/fixtures/sample.mevne-ahid.xml` ו-`fw-builder.ts` (Fixed-Width).

## הרחבות עתידיות מעל בסיס זה

AGENT_CONTEXT עם embeddings (pgvector) ו-LLM tool-calling לאייג'נטים A1–A11
(כיום מימוש תפעולי, ללא LLM); UI ודשבורדים (פרק 12); אינטגרציות חיצוניות
(SFTP מסלקה, OCR ב-A8, מערכת notification חיצונית ב-A9, מקור CRM ל-A4). ה-`PgRepository.promote` ממומש לבלוקים 020–050/070; קידום
060/080/090 נבדק במלואו ב-`InMemoryRepository` ומועתק לאותה תבנית.

## הערות תיקוף

מספרי הבלוקים והשדות **אינדיקטיביים** ומבוססים על מסמכי מבנה אחיד פומביים
(§2.4, פרק 16). יש לתקף את פריסת השדות ב-`blocks.ts` ואת קטלוג קודי השגיאה
ב-`validation/types.ts` מול הספציפיקציה הרשמית העדכנית לפני שימוש בפרודקשן.
