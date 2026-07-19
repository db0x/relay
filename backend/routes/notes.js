// Notizen: Markdown-Dateien mit eigenem Editor (grosser modaler Dialog statt
// OnlyOffice). Ablage immer als {uuid}-{Titel}.md — die UUID macht den Namen
// eindeutig, der Titel (erste Zeile der Notiz) macht ihn lesbar; die Liste
// zeigt nur den Titel (labelFor in routes/browse.js).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const shares = require("../shares");
const { accessFor } = require("../access");
const { secureFilename, securePath, pathFor } = require("../storage");
const { BASE } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();
const NOTES_DIR = "Notizen";

// Titel = erste Zeile ohne fuehrende "#"; unbrauchbar/leer -> "Notiz"
function titleOf(md) {
  const first = (md.split(/\r?\n/, 1)[0] || "").replace(/^#+\s*/, "").trim();
  return secureFilename(first.slice(0, 60)) || "Notiz";
}

// neue Notiz: landet immer im Ordner "Notizen" (wird bei Bedarf angelegt)
router.post("/notes/create", loginRequired, (req, res) => {
  const md = String(req.body.md || "");
  const name = `${crypto.randomUUID()}-${titleOf(md)}.md`;
  const p = pathFor(req.session.user, `${NOTES_DIR}/${name}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, md);
  req.flash("ok", "Notiz gespeichert.");
  res.redirect(`${BASE}/?p=${encodeURIComponent(NOTES_DIR)}`);
});

// Rohinhalt fuer den Editor — Besitzer und Freigaben (auch nur-lesen)
router.get("/notes/raw/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  res.type("text/plain; charset=utf-8").send(fs.readFileSync(pathFor(owner, fid), "utf8"));
});

// Speichern einer bestehenden Notiz: Besitzer oder Bearbeiten-Freigabe.
// Aendert der BESITZER die Titelzeile, wird die Datei umbenannt (UUID bleibt)
// und die Freigaben ziehen mit um.
router.post("/notes/save/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  const acc = accessFor(req.session.user, owner, fid);
  if (acc !== "owner" && acc !== "edit") return res.sendStatus(403);
  const md = String(req.body.md || "");
  fs.writeFileSync(pathFor(owner, fid), md);
  if (acc === "owner") {
    const m = path.basename(fid).match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-.*\.md$/i);
    if (m) {
      const newBase = `${m[1]}-${titleOf(md)}.md`;
      if (newBase !== path.basename(fid)) {
        const dirPart = fid.includes("/") ? fid.slice(0, fid.lastIndexOf("/") + 1) : "";
        fs.renameSync(pathFor(owner, fid), pathFor(owner, dirPart + newBase));
        shares.rename(owner, fid, dirPart + newBase);
      }
    }
  }
  const dir = securePath(req.body.dir || "") || "";
  req.flash("ok", "Notiz gespeichert.");
  res.redirect(dir ? `${BASE}/?p=${encodeURIComponent(dir)}` : `${BASE}/`);
});

module.exports = { router };
