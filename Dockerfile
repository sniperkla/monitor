FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=2048"
# ENV ENCRYPTION_KEY=placeholder_build_key

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3030
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Run unprivileged. Every stage here derives from the official node image, which
# creates a `node` user (uid/gid 1000). Without a USER directive the app runs as
# root, so any write primitive — or any future RCE — lands with full control of
# the container filesystem.
#
# The copies below are --chown'd rather than followed by `RUN chown -R`, which
# would duplicate node_modules into an extra layer. Any NEW COPY added to this
# stage must carry --chown=node:node as well.
#
# /app must stay writable by the app user: skills are written to
# skills/users/<userId>/ on install and Next.js writes to .next/cache. Nothing
# outside /app is written (src/lib/logger.js is console-only), so nothing else
# needs to be owned. Port 3030 is unprivileged, so no capabilities are needed.

# Copy pruned production node_modules from builder (0s download)
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/scripts ./scripts
COPY --chown=node:node --from=builder /app/server.js ./server.js
COPY --chown=node:node --from=builder /app/next.config.mjs ./next.config.mjs
COPY --chown=node:node --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --chown=node:node --from=builder /app/jsconfig.json ./jsconfig.json
COPY --chown=node:node --from=builder /app/eslint.config.mjs ./eslint.config.mjs
COPY --chown=node:node --from=builder /app/skills ./skills
COPY --chown=node:node --from=builder /app/skills-lock.json ./skills-lock.json

USER node

EXPOSE 3030

CMD ["npm", "run", "start"]
