// Freigaben: Besitzer gibt eine seiner Dateien fuer einen anderen Nutzer frei.
// Geteilt wird per Referenz — es bleibt EINE Datei im Ordner des Besitzers.
const { db } = require("./db");

// Freigabe anlegen oder Recht einer bestehenden aendern
function share(owner, filename, target, perm) {
  db().prepare(
    `INSERT INTO shares (owner, filename, target, perm, created) VALUES (?,?,?,?,?)
     ON CONFLICT(owner, filename, target) DO UPDATE SET perm=excluded.perm`
  ).run(owner, filename, target, perm, Date.now());
}

function unshare(owner, filename, target) {
  return db().prepare(
    "DELETE FROM shares WHERE owner=? AND filename=? AND target=?"
  ).run(owner, filename, target).changes > 0;
}

// Datei wurde verschoben: Freigaben zeigen auf den neuen Pfad
function rename(owner, from, to) {
  db().prepare("UPDATE shares SET filename=? WHERE owner=? AND filename=?")
    .run(to, owner, from);
}

// alle Freigaben einer Datei loeschen (z.B. wenn der Besitzer sie loescht)
function unshareAll(owner, filename) {
  db().prepare("DELETE FROM shares WHERE owner=? AND filename=?").run(owner, filename);
}

// 'edit' | 'view' | null — womit darf `target` auf owner/filename zugreifen?
function permFor(owner, filename, target) {
  const row = db().prepare(
    "SELECT perm FROM shares WHERE owner=? AND filename=? AND target=?"
  ).get(owner, filename, target);
  return row ? row.perm : null;
}

// Wem hat der Besitzer diese Datei freigegeben?
function listForFile(owner, filename) {
  return db().prepare(
    `SELECT s.target, s.perm, u.display_name
     FROM shares s JOIN users u ON u.username = s.target
     WHERE s.owner=? AND s.filename=?
     ORDER BY u.display_name`
  ).all(owner, filename);
}

// Welche Dateien sind mir freigegeben worden?
function listForUser(target) {
  return db().prepare(
    `SELECT s.owner, s.filename, s.perm, u.display_name AS owner_name
     FROM shares s JOIN users u ON u.username = s.owner
     WHERE s.target=?`
  ).all(target);
}

module.exports = { share, unshare, rename, unshareAll, permFor, listForFile, listForUser };
