FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.33.0
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod --ignore-scripts

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/ValkyriaWDG/bot" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.title="Valkyria Discord operations service"
ENV NODE_ENV=production HEALTH_HOST=0.0.0.0 HEALTH_PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.HEALTH_PORT+'/health/live',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist/main.js"]
