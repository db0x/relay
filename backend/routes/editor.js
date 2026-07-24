// OnlyOffice-Anbindung: Editor-Seite (/edit), signierte Datei-Links (/files)
// und der Speicher-Callback des DocumentServers (/callback).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

const users = require("../users");
const avatars = require("../avatars");
const { accessFor } = require("../access");
const { secureFilename, encPath, securePath, dirFor, pathFor, walkFiles } = require("../storage");
const { PUBLIC_DS, HOST_INTERNAL, DS_INTERNAL, JWT_SECRET, FILE_SECRET, DOCTYPE, BASE, EDITOR_THEME, dsFetchUrl } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

// Key des aktuell offenen Editors pro (uid/fid). Beim /edit gesetzt, vom /forcesave
// (routes/api.js) gebraucht: das forcesave-Kommando an den DocumentServer verlangt
// exakt den document.key der laufenden Session (haengt an der mtime beim Oeffnen und
// laesst sich spaeter nicht rekonstruieren). In-Memory reicht fuers Familien-Setup;
// nach einem Backend-Neustart faellt der Desktop-Client automatisch auf sein
// Polling zurueck (forcesave meldet dann "no-session").
const activeEditorKey = new Map();

// Besitzer ist Teil der Signatur: ein Link fuer Nutzer A oeffnet nie Dateien von B
function fileToken(uid, fid, expires) {
  return crypto.createHmac("sha256", FILE_SECRET)
    .update(`${uid}:${fid}:${expires}`).digest("base64url");
}

router.get("/edit/:owner/*", loginRequired, (req, res) => {
  const uid = req.params.owner, fid = req.params[0];
  const acc = accessFor(req.session.user, uid, fid);
  if (!acc) return res.sendStatus(404);
  const ext = fid.split(".").pop().toLowerCase();
  // PDFs sind reine Ansicht (Viewer): kein Bearbeiten, kein Speichern-Callback —
  // unabhaengig davon, ob Besitzer oder Freigabe mit Bearbeiten-Recht
  const canEdit = (acc === "owner" || acc === "edit") && ext !== "pdf";
  const p = pathFor(uid, fid);
  const mtime = Math.floor(fs.statSync(p).mtimeMs / 1000);
  // signierter Download-Link, damit nur vom Backend ausgegebene URLs ziehen
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  // BASE auch hier: die Routen sind unter BASE gemountet, auch fuer den
  // internen Direktzugriff des DocumentServers (der laeuft NICHT ueber nginx)
  const src = `${HOST_INTERNAL}${BASE}/files/${encodeURIComponent(uid)}/${encPath(fid)}`
    + `?expires=${exp}&token=${fileToken(uid, fid, exp)}`;
  // fid als kurzer Hash: der Key erlaubt kein "/", und Pfad + Nutzer + mtime
  // koennten die 128-Zeichen-Grenze des DocumentServers sprengen
  const fidHash = crypto.createHash("sha256").update(fid).digest("hex").slice(0, 16);
  // Retry nach einem Ladehaenger (edit.js haengt "?relay-retry" an): FRISCHER,
  // einmaliger Key -> umgeht den evtl. kaputten DS-Cache/Session-Zustand des
  // normalen mtime-Keys. Erst nach dem ~5s-Speicherfenster (Watchdog wartet
  // laenger) -> die Datei hat dann den aktuellen Stand, kein Datenverlust.
  const retrySuffix = req.query["relay-retry"] ? "-r" + crypto.randomBytes(4).toString("hex") : "";
  // Avatare: absolute, signierte URLs — der Editor-iframe laeuft je nach Setup
  // auf fremder Origin (Port-Setup) und der Browser schickt dorthin keine
  // Session-Cookies. Host aus dem Request: darueber hat der Browser uns erreicht.
  const pub = `${req.protocol}://${req.get("host")}`;
  const avatarUrl = (u) => (avatars.has(u) ? pub + avatars.signedUrl(u, exp) : undefined);
  const config = {
    document: {
      fileType: ext,
      // key stabil pro Inhalts-Version: gleichzeitige Editoren teilen die Session
      // (Co-Editing), aendert sich nach Save. Nutzer im Key: gleiche Dateinamen
      // verschiedener Nutzer duerfen sich im DS-Cache nicht vermischen.
      key: `${secureFilename(uid)}-${fidHash}-${mtime}${retrySuffix}`,
      title: path.basename(fid),
      url: src,
      // Nur-Lesen-Freigaben: der DocumentServer erzwingt das, weil die ganze
      // Config JWT-signiert ist und clientseitig nicht manipuliert werden kann
      permissions: { edit: canEdit, download: true, print: true, comment: canEdit },
    },
    documentType: DOCTYPE[ext] || "word",
    editorConfig: {
      mode: canEdit ? "edit" : "view",
      lang: "de-DE",
      region: "de-DE",
      callbackUrl: `${HOST_INTERNAL}${BASE}/callback/${encodeURIComponent(uid)}/${encPath(fid)}`,
      // id = EINGELOGGTER Nutzer (nicht der Datei-Besitzer!) — sonst waeren
      // beim Co-Editing einer Freigabe beide Teilnehmer dieselbe Person
      user: { id: req.session.user, name: req.session.name, image: avatarUrl(req.session.user) },
      // uiTheme/tabStyle sind nur Startwerte (eine im Browser gespeicherte
      // Wahl gewinnt) — edit.js ueberschreibt den Speicher deshalb bei jedem Start
      customization: {
        forcesave: true, autosave: true,
        uiTheme: EDITOR_THEME,
        features: { tabStyle: "fill" },
      },
    },
  };
  config.token = jwt.sign(config, JWT_SECRET, { algorithm: "HS256", noTimestamp: true });
  // Session-Key merken, damit /forcesave ihn spaeter dem DocumentServer geben kann.
  activeEditorKey.set(`${uid}/${fid}`, config.document.key);
  // alle Nutzer mit Avatar-URL: edit.js beantwortet damit onRequestUsers
  // (Avatare der ANDEREN beim Co-Editing, in Kommentaren, Versionshistorie)
  const usersInfo = users.listUsers().map((u) => ({
    id: u.username, name: u.display_name, image: avatarUrl(u.username),
  }));
  // "<" escapen: die JSONs landen roh in <script>-Tags der Editor-Seite —
  // ein "</script>" in einem Anzeigenamen darf dort nicht ausbrechen
  const embed = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
  res.render("edit", {
    ds_api: `${PUBLIC_DS}/web-apps/apps/api/documents/api.js`,
    config: embed(config),
    usersJson: embed(usersInfo),
    // fuer edit.js: Editor-Einstellungen liegen im localStorage der DS-Origin —
    // nur wenn sie mit unserer identisch ist (nginx-Setup), kann er sie setzen
    dsOrigin: new URL(PUBLIC_DS).origin,
    theme: EDITOR_THEME,
  });
});

// Kompatibilitaet fuer Voltage: die aeltere URL-Form ohne Besitzer
// (/edit/<datei>) meint die eigene Datei. Voltage kennt keinen Nutzer und
// keine Session — es schickt sein API-Token (?token= oder Bearer); daraus
// wird hier der Nutzer bestimmt UND die Login-Session aufgebaut, denn die
// Editor-Seite nach dem Redirect laeuft ueber das Session-Cookie.
// Liegt die Datei inzwischen in einem Unterordner, wird sie ueber den
// Dateinamen gesucht — bei genau einem Treffer wird dorthin umgeleitet.
// Muss NACH /edit/:owner/* stehen; greift nur bei einem einzigen Segment.
router.get("/edit/:fid", (req, res, next) => {
  // Token-Bootstrap; loginRequired dahinter prueft auch die Sperre
  if (!req.session.user) {
    const auth = req.get("Authorization") || "";
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : (req.query.token || "");
    const row = users.getByToken(tok);
    if (row && !row.locked) {
      req.session.user = row.username;
      req.session.name = row.display_name;
    }
  }
  next();
}, loginRequired, (req, res) => {
  const me = req.session.user;
  const fid = req.params.fid;
  if (secureFilename(fid) !== fid) return res.sendStatus(404);
  const hits = walkFiles(dirFor(me)).filter((p) => path.basename(p) === fid);
  const target = hits.includes(fid) ? fid : (hits.length === 1 ? hits[0] : null);
  if (!target) return res.sendStatus(404);
  res.redirect(`${BASE}/edit/${encodeURIComponent(me)}/${encPath(target)}`);
});

// --- DocumentServer-Schnittstelle (kein Login-Cookie, daher signiert) ----
router.get("/files/:uid/*", (req, res) => {
  const uid = req.params.uid, fid = req.params[0];
  const exp = parseInt(req.query.expires, 10) || 0;
  const tok = req.query.token || "";
  const good = fileToken(uid, fid, exp);
  const ok = exp >= Math.floor(Date.now() / 1000) &&
    tok.length === good.length &&
    crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(good));
  if (!ok) return res.sendStatus(403);
  res.sendFile(pathFor(uid, fid));
});

// Callback verlangt JWT (Body oder Authorization-Header) -> muss roh gelesen werden
router.post("/callback/:uid/*", express.json(), (req, res) => {
  const uid = req.params.uid, fid = req.params[0];
  let data = null;
  const auth = req.get("Authorization") || "";
  try {
    if (auth.startsWith("Bearer ")) {
      const dec = jwt.verify(auth.slice(7), JWT_SECRET);
      data = dec.payload || dec;
    } else if (req.body && req.body.token) {
      data = jwt.verify(req.body.token, JWT_SECRET);
    }
  } catch (e) {
    return res.sendStatus(403);
  }
  if (data === null) return res.sendStatus(403);

  if (securePath(fid) !== fid || fid === "") return res.sendStatus(403);

  const status = data.status;
  // 2 = alle raus, speichern;  6 = ForceSave/Autosave waehrend Bearbeitung
  if (status === 2 || status === 6) {
    const fetchUrl = dsFetchUrl(data.url); // Host->DS_INTERNAL, "/ds"-Praefix weg
    http.get(fetchUrl, (r) => {
      // KRITISCH: nur bei 200 speichern. Sonst (z.B. 404 "Cannot GET ...")
      // die Datei NICHT ueberschreiben — sonst landet die Fehlerseite als
      // Inhalt (Datenverlust). error:1 -> der DS behaelt die Session/versucht
      // erneut, der Inhalt geht nicht verloren.
      if (r.statusCode !== 200) {
        r.resume(); // Body verwerfen
        console.error("callback: DS-Download HTTP", r.statusCode, "-", fetchUrl);
        return res.json({ error: 1 });
      }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => {
        try {
          const p = pathFor(uid, fid);
          // Unterordner koennte waehrend der Session geloescht worden sein
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, Buffer.concat(chunks));
          res.json({ error: 0 });
        } catch (e) {
          console.error("callback save failed:", e.message);
          res.json({ error: 1 });
        }
      });
    }).on("error", (e) => { console.error("callback fetch error:", e.message); res.json({ error: 1 }); });
    return;
  }
  res.json({ error: 0 });
});

module.exports = { router, activeEditorKey };
