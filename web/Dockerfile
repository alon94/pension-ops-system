# syntax=docker/dockerfile:1.7

# ============================================================================
# שלב 1 — build של Next.js (standalone output)
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json next.config.mjs postcss.config.mjs tailwind.config.ts ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY middleware.ts ./middleware.ts
COPY next-env.d.ts ./next-env.d.ts

# API_BASE נדפס לתוך הקוד רק אם משתמשים בו בזמן build; ב-runtime הוא נטען מ-env
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ============================================================================
# שלב 2 — runtime image דק עם standalone output
# ============================================================================
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini wget

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# standalone output: server.js + node_modules מינימלי
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# אם יש תיקיית public, תווסף ב-build הראשון שמייצר אותה

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://localhost:3001/login || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
