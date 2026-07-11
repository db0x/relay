// Express-App: Grund-Setup und Middleware, die Fachlichkeit liegt in den Modulen.
//   config.js        — Umgebungsvariablen und Konstanten
//   storage.js       — Pfad-Sicherheit und Dateisystem (Nutzer-Isolation!)
//   access.js        — zentrale Autorisierung (accessFor)
//   routes/auth.js   — Login/Logout/Passwort/Token + loginRequired
//   routes/admin.js  — Nutzerverwaltung (nur Admins)
//   routes/api.js    — Token-Datei-API fuer Sync/Voltage inkl. Forcesave
//   routes/browse.js — Startseite, Datei-/Ordner-Aktionen, Freigaben
//   routes/editor.js — OnlyOffice: /edit, signierte /files-Links, /callback
const path = require("path");
const express = require("express");
const session = require("express-session");

const { SESSION_SECRET, APP_NAME } = require("./config");
const { encPath } = require("./storage");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// statische Assets (SVGs, Bilder, CSS) aus backend/public/ unter /static.
// no-cache + ETag: Browser/Voltage revalidieren immer (billiges 304), holen aber
// nach einem Deploy garantiert die neue Datei — kein Stale-Cache.
app.use("/static", express.static(path.join(__dirname, "public"), {
  etag: true,
  setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); },
}));

// Asset-Version (aendert sich bei jedem Container-Start) -> Cache-Busting per ?v=
app.locals.v = Date.now().toString(36);
// Anzeigename der Instanz (INSTANCE_NAME aus .env), Default "Relay"
app.locals.appName = APP_NAME;
// Pfad-Encoding fuer Links in den Templates (Dateien in Unterordnern)
app.locals.encPath = encPath;

// Formulare parsen (Login, Create, ...), aber rohe API-Uploads NICHT anfassen:
// dort liest express.raw den Body — egal welchen (evtl. falschen) Content-Type der Client setzt
const urlencoded = express.urlencoded({ extended: false });
app.use((req, res, next) => {
  if (req.method === "PUT" && req.path.startsWith("/api/files/")) return next();
  urlencoded(req, res, next);
});

// signiert das Session-Cookie; lange Sessions (90 Tage), damit Voltage-Profile eingeloggt bleiben
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 90 * 24 * 3600 * 1000, sameSite: "lax" },
}));

// minimale Flash-Nachrichten ueber die Session (ok/err), einmalig angezeigt
app.use((req, res, next) => {
  res.locals.flashes = req.session.flashes || [];
  req.session.flashes = [];
  req.flash = (cat, msg) => { (req.session.flashes ||= []).push([cat, msg]); };
  next();
});

// Router: /edit/:owner/* (editor) muss vor /edit/:fid (Voltage-Kompat, ebenfalls
// editor) liegen — die Reihenfolge innerhalb des Editor-Routers regelt das.
app.use(require("./routes/auth").router);
app.use(require("./routes/admin").router);
app.use(require("./routes/api").router);
app.use(require("./routes/browse").router);
app.use(require("./routes/editor").router);

app.listen(5000, "0.0.0.0", () => console.log("backend listening on :5000"));
