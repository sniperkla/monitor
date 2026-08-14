FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV ENCRYPTION_KEY=placeholder_build_key

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3030
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Copy pruned production node_modules from builder (0s download)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/jsconfig.json ./jsconfig.json
COPY --from=builder /app/eslint.config.mjs ./eslint.config.mjs
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/skills-lock.json ./skills-lock.json

EXPOSE 3030

CMD ["npm", "run", "start"]
