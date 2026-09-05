FROM node:20-slim
WORKDIR /app
# better-sqlite3 wird beim Install nativ kompiliert -> Build-Tools noetig.
# fontconfig + DejaVu-Fonts: sharp rendert damit den Text in den PDF-Badges
# (SVG->PNG); ohne Fonts kaemen nur Tofu-Kaestchen heraus.
# rsync: fuer "Backup ausfuehren" (Admin-Menue, routes/admin.js).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ fontconfig fonts-dejavu-core rsync \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY app.js config.js storage.js access.js avatars.js db.js doclang.js settings.js users.js loginguard.js zone.js totp.js twofactor.js sessionstore.js eventlog.js csrf.js shares.js notemeta.js notifications.js noteicon.js manage.js maintenance.js format.js library.js ./
COPY routes ./routes
COPY views ./views
COPY public ./public
COPY blank ./blank
CMD ["node", "app.js"]
