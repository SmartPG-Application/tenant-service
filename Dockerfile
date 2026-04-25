FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/

FROM node:20-alpine AS runner
WORKDIR /app

RUN apk update && \
    apk upgrade && \
    npm install -g npm@latest && \
    npm cache clean --force && \
    rm -rf /var/cache/apk/*

RUN addgroup -S pgapp && adduser -S pgapp -G pgapp

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY package*.json ./
RUN chown -R pgapp:pgapp /app

USER pgapp

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:4001/health || exit 1

CMD ["node", "src/index.js"]
