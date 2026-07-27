// Bilder aus dem eigenen Ablageordner anzeigen: Vorschaubild fuer die
// Dateiliste und Vollbild fuer den Vorschau-Dialog.
//
// SICHERHEIT — diese Routen liefern NUTZERHOCHGELADENE Dateien im Browser
// eingebettet aus (nicht als Download). Drei Vorkehrungen dagegen, dass
// jemand darueber fremden Code unter unserer Herkunft ausfuehrt:
//   1. Nur Endungen aus der Whitelist IMAGE_TYPES (config.js) — kein SVG,
//      das ist XML und kann Skripte enthalten.
//   2. Content-Type kommt aus dieser Whitelist, NIE aus der Datei oder dem
//      Dateinamen des Nutzers.
//   3. X-Content-Type-Options: nosniff — eine als .png getarnte HTML-Datei
//      wird dadurch nicht doch als Seite interpretiert.
// Die Zugriffsregel ist dieselbe wie ueberall: accessFor (Besitzer oder
// Freigabe), sonst 404 — das verraet nicht einmal, dass die Datei existiert.
const fs = require("fs");
const express = require("express");
const sharp = require("sharp");

const { accessFor } = require("../access");
const { pathFor } = require("../storage");
const { IMAGE_TYPES } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

// Endung -> MIME, oder null wenn es kein zugelassenes Bild ist
function imageType(fid) {
  const ext = (fid.split(".").pop() || "").toLowerCase();
  return IMAGE_TYPES[ext] || null;
}

// Gemeinsame Vorpruefung: Zugriff erlaubt UND zugelassenes Bildformat.
// Rueckgabe {abs, mime} oder null (dann hat die Funktion schon geantwortet).
function resolve(req, res) {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) { res.sendStatus(404); return null; }
  const mime = imageType(fid);
  if (!mime) { res.sendStatus(404); return null; }
  return { abs: pathFor(owner, fid), mime };
}

// Vorschaubilder sind klein und werden pro Zeile der Dateiliste geholt —
// darum im Speicher halten statt sie jedes Mal neu zu rechnen. Schluessel
// enthaelt mtime+Groesse, ein veraendertes Bild erzeugt also automatisch
// einen neuen Eintrag. Deckel gegen unbegrenztes Wachsen.
const THUMB_MAX = 200;
const thumbs = new Map();

router.get("/thumb/:owner/*", loginRequired, async (req, res) => {
  const hit = resolve(req, res);
  if (!hit) return;
  let st;
  try { st = fs.statSync(hit.abs); } catch (e) { return res.sendStatus(404); }
  const key = `${req.params.owner}/${req.params[0]}/${st.mtimeMs}/${st.size}`;
  let buf = thumbs.get(key);
  if (!buf) {
    try {
      // 56px = die doppelte Anzeigegroesse (28px), damit es auf Bildschirmen
      // mit hoher Punktdichte scharf bleibt
      buf = await sharp(hit.abs).rotate().resize(56, 56, { fit: "cover" }).png().toBuffer();
    } catch (e) {
      // kaputtes oder unlesbares Bild: die Liste faellt auf ihr Icon zurueck
      return res.sendStatus(404);
    }
    if (thumbs.size >= THUMB_MAX) thumbs.delete(thumbs.keys().next().value);
    thumbs.set(key, buf);
  }
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, max-age=300");
  res.type("image/png").send(buf);
});

// Vollbild fuer den Vorschau-Dialog — im Original ausgeliefert (kein erneutes
// Rechnen), aber mit festem Content-Type aus der Whitelist.
router.get("/image/:owner/*", loginRequired, (req, res) => {
  const hit = resolve(req, res);
  if (!hit) return;
  if (!fs.existsSync(hit.abs)) return res.sendStatus(404);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", "inline");
  res.set("Cache-Control", "private, max-age=300");
  res.type(hit.mime).sendFile(hit.abs);
});

module.exports = { router, imageType };
