// Pfad-Sicherheit und Dateisystem-Zugriff auf die Nutzer-Ordner.
// Die Nutzer-Isolation haengt komplett an secureFilename/securePath —
// jede Route, die einen Datei- oder Ordnerpfad annimmt, geht hier durch.
const fs = require("fs");
const path = require("path");

const { DOCS } = require("./config");

fs.mkdirSync(DOCS, { recursive: true });

// --- secure_filename: Pfad-Tricks entfernen (Verhalten wie werkzeug) ----
function secureFilename(name) {
  let s = (name || "").normalize("NFKD").replace(/[^\x00-\x7F]/g, ""); // nur ASCII
  s = s.replace(/[/\\]/g, " ");            // Pfadtrenner -> Leerzeichen
  s = s.trim().split(/\s+/).join("_");     // Whitespace -> genau ein Unterstrich
  s = s.replace(/[^A-Za-z0-9_.-]/g, "");   // nur erlaubte Zeichen
  s = s.replace(/^[._]+|[._]+$/g, "");     // fuehrende/abschliessende . und _ weg
  return s;
}

// Relativer Pfad mit Unterordnern ("steuern/2026.xlsx"): jedes Segment einzeln
// durch secureFilename. Ungueltig (leeres Segment, "..", Pfad-Tricks) -> null,
// damit `securePath(x) !== x` als Validierung ueberall funktioniert.
// "" ist gueltig und meint den Nutzer-Wurzelordner.
function securePath(p) {
  if (p == null || p === "") return "";
  const parts = String(p).split("/").map(secureFilename);
  return parts.every(Boolean) ? parts.join("/") : null;
}

// Pfad-Segmente einzeln URL-kodieren, Trenner "/" erhalten (fuer Links auf Dateien in Unterordnern)
function encPath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

// jeder Nutzer hat seinen eigenen Unterordner unter /data/documents
function dirFor(uid) {
  const d = path.join(DOCS, secureFilename(uid));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// fid darf ein relativer Pfad sein ("steuern/2026.xlsx"); ungueltige
// fids landen auf einem nie existierenden Pfad -> existsSync false -> 404
function pathFor(uid, fid) {
  const rel = securePath(fid);
  return path.join(dirFor(uid), rel === null ? "\0invalid" : rel);
}

// rekursiv alle Dateien unter root als relative Pfade (fuer die API-Liste)
function walkFiles(root, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

// rekursiv alle Unterordner als relative Pfade (fuers Verschieben-Dropdown)
function walkDirs(root, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push(r, ...walkDirs(root, r));
  }
  return out;
}

module.exports = {
  secureFilename, securePath, encPath, dirFor, pathFor, walkFiles, walkDirs,
};
