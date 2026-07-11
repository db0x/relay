FROM node:20-slim
WORKDIR /app
# better-sqlite3 wird beim Install nativ kompiliert -> Build-Tools noetig
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY app.js config.js storage.js access.js db.js users.js shares.js manage.js ./
COPY routes ./routes
COPY views ./views
COPY public ./public
COPY blank ./blank
CMD ["node", "app.js"]
