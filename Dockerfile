# dtd2 is a zero-dependency Node HTTP server (no package-lock, no deps) — just run it.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=5178
# arch-config.json is persisted on a mounted volume (see compose.yaml).
ENV CONFIG_PATH=/app/data/arch-config.json
EXPOSE 5178
CMD ["node", "server.js"]
