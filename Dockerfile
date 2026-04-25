# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/

# Stage 2: Runner  
FROM node:20-alpine AS runner
RUN addgroup -S pgapp && adduser -S pgapp -G pgapp
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY package*.json ./
RUN chown -R pgapp:pgapp /app
USER pgapp
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:4001/health || exit 1
CMD ["node", "src/index.js"]
