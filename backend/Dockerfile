# Production image for the Atiya Herbs API.
# Build:  docker build -t atiyaherbs-backend ./backend
# Run:    docker run --env-file .env -p 4100:4100 atiyaherbs-backend
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so this layer is reused when only the code changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY prisma.config.js ./
COPY src ./src
# Creates the database client (no database needed for this step)
RUN npx prisma generate

# Never run as root
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT:-4100}/api/v1/health" || exit 1
CMD ["node", "src/server.js"]
