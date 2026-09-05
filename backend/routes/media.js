// Videos ausliefern — aus dem eigenen Ablageordner (bzw. einer Freigabe) und
// aus der geteilten Bibliothek. Abgespielt wird mit dem eingebauten <video>
// des Browsers; das braucht nichts weiter als eine Quelle, die Bereichsabrufe
// (Range) beherrscht, sonst kann man im Film nicht springen.
//
// Genau das erledigt res.sendFile: Express beantwortet Range-Anfragen von sich
// aus mit 206 und setzt Accept-Ranges. Es braucht also weder eine
// Streaming-Bibliothek noch eigene Byte-Rechnerei.
//
// SICHERHEIT — dieselben drei Regeln wie bei den Bildern (routes/images.js):
//   1. nur Endungen aus der Whitelist VIDEO_TYPES/IMAGE_TYPES (config.js),
//   2. Content-Type NUR aus dieser Whitelist, nie aus der Datei,
//   3. X-Content-Type-Options: nosniff.
// Dazu die Zugriffsregel: accessFor fuer eigene/freigegebene Dateien,
// library.mayRead fuer die Bibliothek. Sonst 404 — das verraet nicht einmal,
// dass es die Datei gibt.
const path = require("path");
const express = require("express");

const library = require("../library");
const { accessFor } = require("../access");
const { pathFor } = require("../storage");
const { VIDEO_TYPES, IMAGE_TYPES } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

function extOf(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

// Endung -> MIME, oder null wenn es kein zugelassenes Video ist
function videoType(name) {
  return VIDEO_TYPES[extOf(name)] || null;
}

// Bibliotheksdateien duerfen auch Bilder sein (Cover, Fotoalben) — beide
// Whitelists zusammen, sonst nichts.
function mediaType(name) {
  const e = extOf(name);
  return VIDEO_TYPES[e] || IMAGE_TYPES[e] || null;
}

// Im Browser eingebettet ausliefern. Bereichsabrufe erledigt sendFile selbst.
function sendMedia(res, abs, mime) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", "inline");
  res.set("Cache-Control", "private, max-age=300");
  res.type(mime);
  res.sendFile(abs, { acceptRanges: true }, (err) => {
    // Abgebrochene Abrufe sind bei Video der Normalfall (Spulen, Dialog zu) —
    // dann sind die Kopfzeilen laengst raus und es gibt nichts mehr zu tun.
    if (err && !res.headersSent) res.sendStatus(404);
  });
}

// --- eigene und freigegebene Videos -----------------------------------
router.get("/video/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  const mime = videoType(fid);
  if (!mime) return res.sendStatus(404);
  sendMedia(res, pathFor(owner, fid), mime);
});

// --- Bibliothek -------------------------------------------------------
// Gemeinsame Vorpruefung: Leserecht auf den obersten Ordner UND ein Pfad, der
// die Bibliothek nicht verlaesst. Rueckgabe der absolute Pfad oder null
// (dann hat die Funktion schon geantwortet).
function libResolve(req, res) {
  const rel = req.params[0];
  if (!library.mayRead(req.session.user, rel)) { res.sendStatus(404); return null; }
  const abs = library.absOf(rel);
  if (!abs || library.isDir(abs)) { res.sendStatus(404); return null; }
  return abs;
}

router.get("/lib/media/*", loginRequired, (req, res) => {
  const abs = libResolve(req, res);
  if (!abs) return;
  const mime = mediaType(req.params[0]);
  if (!mime) return res.sendStatus(404);
  sendMedia(res, abs, mime);
});

// Herunterladen ist fuer JEDE Datei der Bibliothek erlaubt (auch fuer
// Formate, die kein Browser abspielt) — lesend heisst lesend, nicht "nur
// gucken". res.download beherrscht ebenfalls Bereichsabrufe.
router.get("/lib/download/*", loginRequired, (req, res) => {
  const abs = libResolve(req, res);
  if (!abs) return;
  res.download(abs, path.basename(req.params[0]));
});

module.exports = { router, videoType };
