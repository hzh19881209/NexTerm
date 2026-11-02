FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public
RUN node scripts/copy-vendor.js

RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
