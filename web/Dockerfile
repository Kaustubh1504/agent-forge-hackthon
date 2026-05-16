FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# Use `npm install` (not ci) so platform-specific optional deps
# (e.g. @tailwindcss/oxide-linux-x64-gnu) get resolved for THIS OS,
# not whatever OS generated the lockfile.
RUN rm -f package-lock.json && npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
