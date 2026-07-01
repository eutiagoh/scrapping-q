# Base image traz Chromium + libs necessárias já instaladas.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "start"]
