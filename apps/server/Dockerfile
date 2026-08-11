# ─── build stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Leverage Docker layer cache: install deps before copying source.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/recipe-schema/package.json packages/recipe-schema/
COPY packages/test-utils/package.json packages/test-utils/
RUN npm ci

# Copy source files for compilation.
COPY apps/server apps/server/
COPY packages/shared packages/shared/
COPY packages/recipe-schema packages/recipe-schema/

# Build in dependency order.
RUN npm run build --workspace @cooking-game/shared && \
    npm run build --workspace @cooking-game/recipe-schema && \
    npm run build --workspace @cooking-game/server

# ─── runtime stage ───────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=2567
# Override DATABASE_URL at runtime to point to a persistent volume mount.
ENV DATABASE_URL=file:/data/kitchen.db

# Install only production dependencies.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/recipe-schema/package.json packages/recipe-schema/
COPY packages/test-utils/package.json packages/test-utils/
RUN npm ci --omit=dev

# Copy the Prisma CLI from the build stage — needed for migrate deploy at startup.
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Copy compiled server and packages.
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/src/generated ./apps/server/src/generated
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/recipe-schema/dist ./packages/recipe-schema/dist

# Copy Prisma migration files and config (required by migrate deploy).
COPY apps/server/prisma ./apps/server/prisma
COPY apps/server/prisma.config.ts ./apps/server/

# Persistent volume for the SQLite database file.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 2567

# Run migrations then start the server.
# Using sh -c keeps the process tree clean and lets migrate fail-fast.
CMD ["sh", "-c", \
  "node_modules/.bin/prisma migrate deploy --config apps/server/prisma.config.ts && \
   node apps/server/dist/index.js"]
