// REST-API (Token-Auth, fuer Sync/Voltage): Dateiliste, Up-/Download, Loeschen,
// Forcesave. Auth per API-Token: "Authorization: Bearer <token>" oder ?token=.
// Arbeitet immer nur im Ordner des Token-Besitzers.
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const users = require("../users");
const { securePath, dirFor, pathFor, walkFiles } = require("../storage");
const { DS_INTERNAL, JWT_SECRET, MAX_FILE_MB } = require("../config");
const { activeEditorKey } = require("./editor");

const router = express.Router();

// fid ist ein relativer Pfad und kommt aus der Wildcard (req.params[0]);
// Unterordner sind erlaubt ("steuern/2026.xlsx"), Pfad-Tricks nicht.
function apiAuth(req, res, next) {
  const auth = req.get("Authorization") || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : (req.query.token || "");
  const row = users.getByToken(tok);
  if (!row || row.locked) return res.status(401).json({ error: "unauthorized" });
  // fid gegen Pfad-Tricks absichern und mit dem Roh-Namen abgleichen
  const fid = req.params[0];
  if (fid !== undefined && (securePath(fid) !== fid || fid === ""))
    return res.status(400).json({ error: "invalid filename" });
  req.uid = row.username;
  req.fid = fid;
  next();
}

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
  const key = activeEditorKey.get(`${req.uid}/${req.fid}`);
  if (!key) return res.json({ saved: false, reason: "no-session" });
  const cmd = { c: "forcesave", key };
  const body = JSON.stringify({ ...cmd, token: jwt.sign(cmd, JWT_SECRET) });
  const u = new URL(`${DS_INTERNAL}/coauthoring/CommandService.ashx`);
  const dreq = http.request(
    { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    (dres) => {
      const chunks = [];
      dres.on("data", (c) => chunks.push(c));
      dres.on("end", () => {
        let error = -1;
        try { error = JSON.parse(Buffer.concat(chunks).toString()).error; } catch {}
        // 0 = forcesave gestartet; 4 = nichts zu speichern; alles andere ist ein DS-Fehler.
        if (error === 0) return res.json({ saved: true });
        if (error === 4) return res.json({ saved: false, reason: "no-changes" });
        return res.json({ saved: false, reason: "ds-error", error });
      });
    }
  );
  dreq.on("error", () => res.json({ saved: false, reason: "unreachable" }));
  dreq.write(body);
  dreq.end();
}

module.exports = { router };
