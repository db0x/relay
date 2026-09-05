// Express-App: Grund-Setup und Middleware, die Fachlichkeit liegt in den Modulen.
//   config.js        — Umgebungsvariablen und Konstanten
//   storage.js       — Pfad-Sicherheit und Dateisystem (Nutzer-Isolation!)
//   access.js        — zentrale Autorisierung (accessFor)
//   routes/auth.js   — Login/Logout/Passwort/Token + loginRequired
//   routes/admin.js  — Nutzerverwaltung (nur Admins)
//   routes/api.js    — Token-Datei-API fuer Sync/Voltage inkl. Forcesave
//   routes/browse.js — Startseite, Datei-/Ordner-Aktionen, Freigaben
//   routes/media.js  — Videos (eigene/freigegebene) und die geteilte Bibliothek
//   routes/editor.js — OnlyOffice: /edit, signierte /files-Links, /callback
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");

const { SESSION_SECRET, APP_NAME, BASE, VERSION, TRUST_PROXY, PUBLIC_DS } = require("./config");
const { encPath } = require("./storage");
const maintenance = require("./maintenance");
const users = require("./users");
const { SqliteStore } = require("./sessionstore");
const { csrfSchutz } = require("./csrf");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Hinter nginx: X-Forwarded-Proto/-For gelten (sonst haelt Express jede
// Verbindung fuer unverschluesselt und saehe als Absender nur den Proxy).
// Ohne Proxy bleibt es aus — siehe Kommentar in config.js.
if (TRUST_PROXY) app.set("trust proxy", TRUST_PROXY);

// Wartungssperre waehrend eines Backups (routes/admin.js /backup/run setzt sie):
// blockiert WIRKLICH ALLES -- auch /static und die API -- damit rsync einen
// konsistenten Stand kopiert. Ganz vorn, noch vor Session/Body-Parsing.
app.use((req, res, next) => {
  if (!maintenance.isActive()) return next();
  if (req.path.startsWith(`${BASE}/api/`)) {
    return res.status(503).json({ error: "backup running" });
  }
  res.status(503).render("maintenance", { appName: APP_NAME });
});

// --- Sicherheits-Kopfzeilen ---------------------------------------------
// Pro Antwort eine Einmal-Kennung (nonce) fuer die drei Inline-<script>-Bloecke
// (login.ejs und die zwei JSON-Datenbloecke in edit.ejs). Damit kann die
// Richtlinie unten auf 'unsafe-inline' verzichten — eingeschleustes Skript
// kennt die Kennung nicht und laeuft nicht.
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// Der DocumentServer liefert api.js und den Editor-iframe — seine Herkunft
// muss in der Richtlinie stehen. Bei Setups ohne gesetzten SERVER_HOST kann
// die URL unbrauchbar sein; dann bleibt es bei 'self'.
let dsOrigin = "";
try { dsOrigin = new URL(PUBLIC_DS).origin; } catch (e) { /* egal */ }
const dsQuelle = dsOrigin ? [dsOrigin] : [];

app.use(helmet({
  // deckungsgleich mit frameAncestors unten; die alte Kopfzeile ist fuer
  // Browser gedacht, die noch kein CSP frame-ancestors auswerten
  xFrameOptions: { action: "deny" },
  // HSTS gehoert dorthin, wo TLS endet — in den nginx. Von hier gesendet
  // wuerde es auch fuer reine LAN-Installationen ohne TLS gelten.
  strictTransportSecurity: false,
  // Nicht senden: der Editor-iframe laeuft je nach Setup auf einer anderen
  // Herkunft und laedt von uns Avatare; "same-origin" wuerde das abwuergen.
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // Skripte nur von uns bzw. vom DocumentServer, inline nur mit Kennung
      scriptSrc: ["'self'", ...dsQuelle, (req, res) => `'nonce-${res.locals.nonce}'`],
      // Stile bleiben bei 'unsafe-inline': die Vorlagen und mehrere Bibliotheken
      // (CodeMirror, Coloris, OverlayScrollbars) setzen style-Attribute. Fuer
      // die hier abgewehrte Klasse von Angriffen ist das nicht der Hebel.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", ...dsQuelle],
      fontSrc: ["'self'", "data:", ...dsQuelle],
      connectSrc: ["'self'", ...dsQuelle],
      // der Editor haengt als iframe darin
      frameSrc: ["'self'", ...dsQuelle],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      // Relay selbst darf nirgends eingebettet werden (Clickjacking).
      // ACHTUNG: bettet ein Wrapper (Voltage) Relay in einen iframe, muss das
      // hier auf die Herkunft des Wrappers erweitert werden.
      frameAncestors: ["'none'"],
    },
  },
}));
app.disable("x-powered-by");

// statische Assets (SVGs, Bilder, CSS) aus backend/public/ unter /static.
// no-cache + ETag: Browser/Voltage revalidieren immer (billiges 304), holen aber
// nach einem Deploy garantiert die neue Datei — kein Stale-Cache.
app.use(`${BASE}/static`, express.static(path.join(__dirname, "public"), {
  etag: true,
  setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); },
}));

// Asset-Version (aendert sich bei jedem Container-Start) -> Cache-Busting per ?v=
app.locals.v = Date.now().toString(36);
// Anzeigename der Instanz (INSTANCE_NAME aus .env), Default "Relay"
app.locals.appName = APP_NAME;
// Version aus package.json — sichtbar auf Login-Seite und im Menue (Fehlersuche)
app.locals.version = VERSION;
// Pfad-Encoding fuer Links in den Templates (Dateien in Unterordnern)
app.locals.encPath = encPath;
// Pfad-Praefix hinter dem Reverse Proxy (BASE_PATH, z.B. "/relay"); "" = Wurzel.
// Templates praefixen damit ALLE Links und Formular-Actions.
app.locals.base = BASE;

// Formulare parsen (Login, Create, ...), aber rohe API-Uploads NICHT anfassen:
// dort liest express.raw den Body — egal welchen (evtl. falschen) Content-Type der Client setzt
const urlencoded = express.urlencoded({ extended: false });
app.use((req, res, next) => {
  if (req.method === "PUT" && req.path.startsWith(`${BASE}/api/files/`)) return next();
  urlencoded(req, res, next);
});

// signiert das Session-Cookie; lange Sessions (90 Tage), damit Voltage-Profile eingeloggt bleiben.
// secure:"auto" — das Cookie bekommt die Secure-Marke genau dann, wenn die
// Verbindung verschluesselt ist. Hinter nginx haengt das an TRUST_PROXY (sonst
// sieht Express nur die unverschluesselte Strecke Proxy->Backend und liesse
// die Marke weg); im LAN ohne TLS bleibt alles wie gehabt.
app.use(session({
  // Sitzungen liegen in SQLite (sessionstore.js) — sie ueberleben damit einen
  // Neustart und lassen sich gezielt beenden.
  store: new SqliteStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 90 * 24 * 3600 * 1000,
    sameSite: "lax",
    httpOnly: true,
    secure: "auto",
  },
}));

// minimale Flash-Nachrichten ueber die Session (ok/err), einmalig angezeigt
app.use((req, res, next) => {
  res.locals.flashes = req.session.flashes || [];
  req.session.flashes = [];
  req.flash = (cat, msg) => { (req.session.flashes ||= []).push([cat, msg]); };
  next();
});

// Nachweis gegen faelschende Fremdseiten. NACH der Session (braucht sie) und
// VOR allen Routern; /api/ und /callback/ sind ausgenommen (siehe csrf.js).
app.use(csrfSchutz);

// Router: /edit/:owner/* (editor) muss vor /edit/:fid (Voltage-Kompat, ebenfalls
// editor) liegen — die Reihenfolge innerhalb des Editor-Routers regelt das.
// Alles unter BASE gemountet (Reverse Proxy mit Unterpfad); "" = Wurzel.
const mount = BASE || "/";
app.use(mount, require("./routes/auth").router);
app.use(mount, require("./routes/twofactor").router);
app.use(mount, require("./routes/avatar").router);
app.use(mount, require("./routes/admin").router);
app.use(mount, require("./routes/api").router);
app.use(mount, require("./routes/browse").router);
app.use(mount, require("./routes/images").router);
app.use(mount, require("./routes/media").router);
app.use(mount, require("./routes/notes").router);
app.use(mount, require("./routes/editor").router);

// Komfort: wer die Wurzel trifft, obwohl Relay unter BASE laeuft, wird hingefuehrt
if (BASE) app.get("/", (req, res) => res.redirect(`${BASE}/`));

// Letzte Instanz fuer alles, was durchrutscht. WICHTIG: Express' eingebauter
// Handler schickt im Entwicklungsmodus die komplette Stapelspur an den Client
// (inklusive Pfaden aus dem Container). Hier wird sie protokolliert und dem
// Aufrufer nur eine neutrale Meldung gezeigt.
// Die vier Parameter sind Pflicht — daran erkennt Express einen Fehler-Handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`Fehler bei ${req.method} ${req.originalUrl}:`, err.stack || err);
  if (res.headersSent) return;
  const status = err.status || err.statusCode || 500;
  if (req.path.startsWith(`${BASE}/api/`) || req.get("X-Requested-With") === "fetch") {
    return res.status(status).json({ error: "request failed" });
  }
  res.status(status).type("text/plain; charset=utf-8")
    .send(status === 400 ? "Ungültige Anfrage." : "Es ist ein Fehler aufgetreten.");
});

// Erst lauschen, wenn der Bootstrap-Admin steht (bcrypt laeuft asynchron) —
// sonst koennte die erste Anfrage auf eine leere Nutzertabelle treffen.
users.ready.then(() => {
  app.listen(5000, "0.0.0.0", () => console.log(`backend listening on :5000 (base "${BASE || "/"}")`));
});
