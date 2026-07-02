FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Install all dependencies (devDependencies required for vite build).
# npm install avoids lock-file platform mismatch (e.g. lightningcss on macOS vs Linux).
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund && npm cache clean --force

COPY . .

RUN npm run build

# Production runtime (dev deps used only at build time).
ENV NODE_ENV=production
EXPOSE 3000

# docker-start = prisma generate + remix-serve (via instrument.server.mjs)
CMD ["npm", "run", "docker-start"]
