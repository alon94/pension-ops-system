# syntax=docker/dockerfile:1.7

# ============================================================================
# שלב 1 — bundle עם dev deps + build של NestJS + קומפילציה של bootstrap
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# התקנת תלויות תחילה (קאש שכבת Docker אופטימלי)
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# קוד מקור
COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test

# build של NestJS ל-dist/
RUN npm run build

# קומפילציה עצמאית של bootstrap-db.ts ל-JS — flags מפורשים שעוקפים את ה-tsconfig
# של הפרויקט (שעלול לכלול אופציות שגרסת TypeScript ב-runtime לא מכירה).
RUN npx --package=typescript -- tsc \
    --module commonjs \
    --target es2022 \
    --esModuleInterop \
    --skipLibCheck \
    --resolveJsonModule \
    --outDir /app/scripts-dist \
    scripts/bootstrap-db.ts

# ============================================================================
# שלב 2 — runtime image דק
# ============================================================================
FROM node:20-alpine AS runtime

# tini ל-PID 1 נכון (signal handling)
RUN apk add --no-cache tini bash

WORKDIR /app
ENV NODE_ENV=production

# רק תלויות runtime
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# dist (NestJS) + bootstrap מקומפל + סכמות + entrypoint
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts-dist/bootstrap-db.js ./scripts/bootstrap-db.js
COPY src/persistence/*.sql ./sql/
COPY scripts/seed.sql ./sql/seed.sql

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# מצביע ל-bootstrap איפה למצוא את ה-SQL
ENV BOOTSTRAP_SCHEMA_DIR=/app/sql
ENV BOOTSTRAP_SEED_PATH=/app/sql/seed.sql
ENV PORT=3000

EXPOSE 3000

# Healthcheck Docker (משלים את probes של orchestrator)
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://localhost:3000/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start:prod"]
