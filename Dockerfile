# syntax=docker/dockerfile:1
# Next.js standalone image (output: "standalone" in next.config.ts).
# .env is in the build context so NEXT_PUBLIC_* values are baked in at build time;
# server-side vars are read from the bind-mounted /app/.env at runtime (see compose.yaml).

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# standalone copies .env files in; drop them so secrets stay out of the image (runtime mount provides them)
RUN --mount=type=cache,target=/app/.next/cache npm run build && rm -f .next/standalone/.env*

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# the container runs as a non-root host user, so Next's cache must be writable
RUN mkdir -p .next/cache && chmod -R a+rwX .next
EXPOSE 3001
CMD ["node", "server.js"]
