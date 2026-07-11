// Zentrale Autorisierung fuer Browser-Routen: was darf `me` mit owner/fid tun?
//   "owner" | "edit" | "view" | null (kein Zugriff)
// Wird von /edit, /download, /delete, /share und /move benutzt — die einzigen
// Stellen, an denen die Nutzer-Isolation kontrolliert geoeffnet wird.
const fs = require("fs");

const users = require("./users");
const shares = require("./shares");
const { securePath, pathFor } = require("./storage");

function accessFor(me, owner, fid) {
  if (!users.get(owner)) return null;              // Besitzer muss existieren (kein Pfad-Trick)
  if (securePath(fid) !== fid || fid === "") return null; // Pfad unveraendert/sicher
  const p = pathFor(owner, fid);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null; // nur echte Dateien, keine Ordner
  if (me === owner) return "owner";
  return shares.permFor(owner, fid, me);           // 'edit' | 'view' | null
}

module.exports = { accessFor };
