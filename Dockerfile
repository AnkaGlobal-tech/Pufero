FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Tum bagimliliklari kur (build icin vite vb. devDependencies gerekli).
# npm install kullaniyoruz: lock dosyasi platforma ozgu opsiyonel bagimliliklari
# (lightningcss/@emnapi gibi) macOS'ta uretildiginde Linux build'de npm ci ile
# senkron sorunu cikariyor.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund && npm cache clean --force

COPY . .

RUN npm run build

# Production runtime ayarlari (build sonrasi, dev deps build'de kullanildi).
ENV NODE_ENV=production
EXPOSE 3000

# docker-start = prisma generate + remix-serve (instrument.server.mjs ile)
CMD ["npm", "run", "docker-start"]
