// REST-API (fuer Voltage und Skripte im Browser-Kontext): Dateiliste,
// Up-/Download, Loeschen, Forcesave. Auth ueber die LOGIN-SITZUNG — dieselbe
// Anmeldung wie fuer den Rest der Oberflaeche, kein eigenes Geheimnis mehr.
// Arbeitet immer nur im Ordner des Angemeldeten.
//
// Frueher lief das ueber ein API-Token pro Nutzer. Das ist entfallen: ein
// Token war ein unbefristeter Vollzugang (ueber /edit/<datei> liess sich
// daraus sogar eine Sitzung bauen), es musste bei jedem Client im Klartext
// liegen, und widerrufen liess es sich nur fuer ALLE Clients gleichzeitig.
// Die Sitzung kann all das besser: sie laeuft ab, sie steht einzeln in der
// Datenbank (sessionstore.js) und laesst sich pro Geraet beenden.
//
// Folge fuer csrf.js: /api/ ist NICHT mehr von der CSRF-Pruefung ausgenommen.
// Die Ausnahme stand dort, WEIL die API sich per Token anmeldete und eine
// fremde Seite keines mitschicken kann. Mit Cookie-Anmeldung gilt das nicht
// mehr, also braucht jeder aendernde Aufruf den Nachweis (Kopfzeile
// X-CSRF-Token); GET/HEAD bleiben ohnehin frei. Voltage holt sich den Wert
// einmalig ueber GET /api/session.
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const users = require("../users");
const { securePath, dirFor, pathFor, walkFiles } = require("../storage");
const { darfVonHier } = require("../zone");
const { MAX_FILE_MB } = require("../config");
const { forcesave } = require("./editor");

const router = express.Router();

// fid ist ein relativer Pfad und kommt aus der Wildcard (req.params[0]);
// Unterordner sind erlaubt ("steuern/2026.xlsx"), Pfad-Tricks nicht.
function apiAuth(req, res, next) {
  // pending2fa: die Sitzung traegt zwar schon den Namen, darf aber bis zur
  // zweiten Stufe nichts — dasselbe Tor wie in loginRequired. Ohne die Zeile
  // waere die Datei-API der Weg daran vorbei.
  const row = req.session && req.session.user && !req.session.pending2fa
    ? users.get(req.session.user)
    : null;
  // must_change: der Zugang hat noch sein Einmal-Passwort — bis das gewechselt
  // ist, gilt er auch fuer die API als nicht eingerichtet.
  // darfVonHier: ein Admin unterwegs wird auch hier abgewiesen, sonst waere die
  // API die offene Hintertuer neben der LAN-Regel. Fuer alle anderen aendert
  // sich nichts.
  // is_admin: Verwaltungszugaenge nutzen die Datei-API nicht — sie haben die
  // Oberflaeche. Die Regel stammt aus der Token-Zeit und bleibt bewusst
  // bestehen: ein Admin-Konto soll keine Sync-Schnittstelle haben.
  if (!row || row.locked || row.must_change || row.is_admin || !darfVonHier(req, row))
    return res.status(401).json({ error: "unauthorized" });
  // fid gegen Pfad-Tricks absichern und mit dem Roh-Namen abgleichen
  const fid = req.params[0];
  if (fid !== undefined && (securePath(fid) !== fid || fid === ""))
    return res.status(400).json({ error: "invalid filename" });
  req.uid = row.username;
  req.fid = fid;
  next();
}

// Woran ist Voltage angemeldet, und welchen CSRF-Nachweis braucht es fuer
// seine schreibenden Aufrufe? Beides in einer Antwort, damit der Desktop-Client
// nicht erst eine HTML-Seite laden und das <meta name="csrf-token"> daraus
// fischen muss (beim Start haengt er auf einer eigenen Ladeseite).
//
// Das ist unbedenklich: die Route ist GET, also selbst nicht faelschbar, und
// eine fremde Seite kann die ANTWORT nicht lesen — es gibt keine
// CORS-Freigabe, und das Sitzungs-Cookie ist SameSite=Lax, ginge also bei
// einem Cross-Site-Aufruf gar nicht erst mit.
//
// 401 heisst hier schlicht "nicht angemeldet"; der Client schickt den Nutzer
// dann auf /login statt eine Konfiguration zu beklagen.
router.get("/api/session", apiAuth, (req, res) => {
  res.json({ user: req.uid, csrf: req.session.csrf || null });
});

router.get("/api/files", apiAuth, (req, res) => {
  // Kompatibilitaet: ohne ?recursive=1 nur die flachen Wurzel-Dateien wie frueher —
  // bestehende Sync-Clients (Voltage) bekommen keine Pfade untergeschoben
  const list = req.query.recursive === "1"
    ? walkFiles(dirFor(req.uid))
    : fs.readdirSync(dirFor(req.uid), { withFileTypes: true })
        .filter((e) => e.isFile()).map((e) => e.name);
  res.json({ files: list.sort() });
});

// Forcesave (unten definiert) muss VOR den Wildcard-Uploads registriert werden,
// sonst wuerde ".../forcesave" als Dateiname interpretiert.
router.post("/api/files/*/forcesave", apiAuth, handleForcesave);

// Inhalt kommt als roher Request-Body (rclone/curl -T) oder als multipart-Feld "file"
const apiUpload = multer({ storage: multer.memoryStorage() });
// type:()=>true -> Body immer roh einlesen, auch ohne Content-Type (curl -T, rclone)
router.put("/api/files/*", apiAuth, express.raw({ type: () => true, limit: `${MAX_FILE_MB}mb` }),
  handleApiUpload);
router.post("/api/files/*", apiAuth, apiUpload.single("file"), handleApiUpload);

function handleApiUpload(req, res) {
  let data = Buffer.isBuffer(req.body) ? req.body : null;
  if ((!data || data.length === 0) && req.file) data = req.file.buffer;
  if (!data || data.length === 0) return res.status(400).json({ error: "empty body" });
  const p = pathFor(req.uid, req.fid);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory())
    return res.status(409).json({ error: "is a directory" });
  const existed = fs.existsSync(p);
  fs.mkdirSync(path.dirname(p), { recursive: true }); // Unterordner bei Bedarf anlegen
  fs.writeFileSync(p, data);
  res.status(existed ? 200 : 201).json({ ok: true, name: req.fid, bytes: data.length });
}

router.get("/api/files/*", apiAuth, (req, res) => {
  const p = pathFor(req.uid, req.fid);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile())
    return res.status(404).json({ error: "not found" });
  res.download(p, path.basename(req.fid));
});

router.delete("/api/files/*", apiAuth, (req, res) => {
  const p = pathFor(req.uid, req.fid);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile())
    return res.status(404).json({ error: "not found" });
  fs.unlinkSync(p);
  res.json({ ok: true, deleted: req.fid });
});

// Forcesave: bittet den DocumentServer, die offene Editor-Session SOFORT zu speichern, statt auf
// seine ~10s-Karenz nach dem Verbindungsabbau zu warten. Der Desktop-Client (Voltage-Plugin) ruft
// das beim Schliessen auf und erfaehrt am Ergebnis, ob ueberhaupt etwas zu syncen ist:
//   { saved:true }                 -> es gab Aenderungen; ein status-6-Callback schreibt die Datei
//                                     gleich (der Client pollt dann nur noch ~1s statt 15s).
//   { saved:false, no-changes }    -> nichts geaendert -> Client kann sofort schliessen.
//   { saved:false, no-session }    -> kein Key bekannt (z.B. nach Backend-Neustart) -> Client faellt
//                                     auf sein normales Polling zurueck.
function handleForcesave(req, res) {
  // Die eigentliche Arbeit steckt in routes/editor.js — dort liegt der
  // Session-Key (activeEditorKey), und der Editor-Dialog braucht dieselbe
  // Funktion ueber seine eigene, sitzungsgebundene Route.
  forcesave(req.uid, req.fid).then((r) => res.json(r));
}

module.exports = { router };
