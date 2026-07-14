// Profilbilder: ein PNG pro Nutzer, quadratisch verkleinert, unter
// <STATE_DIR>/avatars/<username>.png. Die Existenz der Datei ist die einzige
// Wahrheit (keine DB-Spalte). Ausgeliefert wird wahlweise per Login-Session
// (eigene UI) oder per signierter URL — der Editor-iframe laeuft je nach
// Setup auf fremder Origin und haette dort keine Session-Cookies.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { FILE_SECRET, BASE } = require("./config");
const { secureFilename } = require("./storage");

const DIR = path.join(process.env.STATE_DIR || "/data/state", "avatars");
fs.mkdirSync(DIR, { recursive: true });

function pathFor(user) {
  const u = secureFilename(user);
  return u ? path.join(DIR, `${u}.png`) : null;
}

function has(user) {
  const p = pathFor(user);
  return !!p && fs.existsSync(p);
}

function remove(user) {
  const p = pathFor(user);
  if (p && fs.existsSync(p)) fs.unlinkSync(p);
}

// "avatar" als Praefix mit \0-Trennern: kollidiert nie mit fileToken aus
// routes/editor.js (dessen Eingabe uid:fid:exp enthaelt keine Nullbytes)
function token(user, expires) {
  return crypto.createHmac("sha256", FILE_SECRET)
    .update(`avatar\0${user}\0${expires}`).digest("base64url");
}

// signierte URL relativ zur Wurzel; die absolute URL baut der Aufrufer
function signedUrl(user, expires) {
  return `${BASE}/avatar/${encodeURIComponent(user)}`
    + `?expires=${expires}&token=${token(user, expires)}`;
}

module.exports = { pathFor, has, remove, token, signedUrl };
