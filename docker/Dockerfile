FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DONT_WASTE_DATA_DIR=/data
ENV DONT_WASTE_DASHBOARD_HOST=0.0.0.0
COPY --from=build /app /app
EXPOSE 3000
ENTRYPOINT ["node", "apps/cli/dist/main.js"]
CMD ["dashboard", "--port", "3000", "--no-open"]
