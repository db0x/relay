# Node 24 "Krypton" — die Active-LTS-Linie. Bewusst NICHT 26: das ist zwar
# erschienen, steht aber noch nicht unter Langzeitpflege. Bewusst auch keine
# Patch-Version: -slim folgt der Linie, Sicherheitsstaende kommen so mit einem
# Neubau statt mit einer Aenderung hier.
FROM node:24-slim
WORKDIR /app
# KEIN Compiler mehr. better-sqlite3 brachte frueher python3/make/g++ hier
# herein — gemessen am 16.11.2026 zu Unrecht:
#
#   * Es LIEFERT seine Binaerdateien mit (node_modules/better-sqlite3/
#     prebuilds/linux-x64.node) und laedt zur Laufzeit genau die. Nachgewiesen
#     ueber einen Haken in process.dlopen; lib/binding.js sagt es auch selbst:
#     die node-gyp-Pfade "only contain a binary if one was compiled on purpose".
#   * Der Bau lief trotzdem, weil npm bei einer vorhandenen binding.gyp ohne
#     eigenes install-Skript IMPLIZIT `node-gyp rebuild` anhaengt. Herausgekommen
#     sind dabei zwei .stamp-Dateien in build/Release/obj.target und sonst
#     nichts — die Toolchain stand also nur da, damit ein Schritt gelingt,
#     dessen Ergebnis niemand benutzt.
#
# Seit "allowScripts": {"better-sqlite3": false} in der package.json laesst npm
# den Schritt weg (der Mechanismus kam mit npm 11.19). Damit faellt der
# Compiler weg: `npm ci` braucht 3 statt ~60 Sekunden, das Image wird um rund
# 250 MB kleiner, und ein fremdes Skript weniger laeuft beim Bau.
#
# ACHTUNG beim naechsten Hauptversionssprung von better-sqlite3: liefert es
# fuer linux-x64 keine Binaerdatei mehr mit, faellt das NICHT beim Bau auf,
# sondern erst beim Start. Dann hier python3 make g++ zurueckholen und in der
# package.json auf `true` drehen.
#
# fontconfig + DejaVu-Fonts: sharp rendert damit den Text in den PDF-Badges
# (SVG->PNG); ohne Fonts kaemen nur Tofu-Kaestchen heraus. sharp bringt seine
# Binaerdateien als optionale Pakete mit und braucht ebenfalls keinen Compiler.
# rsync: fuer "Backup ausfuehren" (Admin-Menue, routes/admin.js).
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig fonts-dejavu-core rsync \
    && rm -rf /var/lib/apt/lists/*
# package-lock.json MUSS mit: ohne sie faellt `npm ci` auf die Nase, und
# genau das ist gewollt — der Bau soll scheitern statt stillschweigend etwas
# anderes zu installieren.
COPY package.json package-lock.json ./
# `npm ci` statt `npm install`: installiert AUSSCHLIESSLICH, was in der
# Lockfile steht, und bricht ab, wenn sie nicht zu package.json passt.
#
# WARUM das wichtig ist: der naechtliche Neubau auf dem Server baut mit
# --no-cache (maintenance/nightly-rebuild.sh), damit Node- und
# Betriebssystem-Patches aus dem Basis-Image landen. Mit `npm install` loeste
# er dabei JEDE Nacht auch alle "^"-Bereiche neu auf — ein gekapertes
# npm-Paket waere also wenige Stunden spaeter auf einem Dienst gewesen, der
# aus dem Internet erreichbar ist. Mit `npm ci` bleiben die Pakete auf dem
# geprueften Stand, waehrend Basis-Image-Patches weiter jede Nacht kommen.
# Paket-Updates laufen stattdessen ueber Dependabot (.github/dependabot.yml)
# als Pull Request — also gesehen, nicht zugefallen.
RUN npm ci --omit=dev
COPY app.js config.js storage.js access.js avatars.js db.js doclang.js settings.js users.js loginguard.js zone.js totp.js twofactor.js sessionstore.js eventlog.js csrf.js shares.js notemeta.js notifications.js chat.js noteicon.js mimeicons.js manage.js maintenance.js format.js library.js foldersort.js scratch.js ./
COPY routes ./routes
COPY views ./views
COPY public ./public
COPY blank ./blank
CMD ["node", "app.js"]
