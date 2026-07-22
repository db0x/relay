// Strukturierte Zusatzattribute einer Notiz (ToDo/Faelligkeit, Personen, Ort).
// Bewusst getrennt von der .md — die soll reine Markdown bleiben. Muster wie
// shares.js: eine Zeile pro (owner, filename).
const { db } = require("./db");

// people: {known: [username,...], extra: [Freitextname,...]} — known bleibt
// eine Referenz auf den Nutzer (Anzeigename/Avatar werden live aufgeloest,
// nicht dupliziert), extra sind Personen ohne Account.
function get(owner, filename) {
  const row = db().prepare(
    "SELECT is_todo, due_date, people, ort FROM note_meta WHERE owner=? AND filename=?"
  ).get(owner, filename);
  if (!row) return { isTodo: false, dueDate: "", people: { known: [], extra: [] }, ort: "" };
  return {
    isTodo: !!row.is_todo,
    dueDate: row.due_date || "",
    people: row.people ? JSON.parse(row.people) : { known: [], extra: [] },
    ort: row.ort || "",
  };
}

// leeres Meta (kein ToDo, keine Personen, kein Ort) -> Zeile ganz loeschen
// statt eine leere Zeile zu halten
function set(owner, filename, { isTodo, dueDate, people, ort }) {
  const known = (people && people.known) || [];
  const extra = (people && people.extra) || [];
  if (!isTodo && !dueDate && !known.length && !extra.length && !ort) {
    remove(owner, filename);
    return;
  }
  db().prepare(
    `INSERT INTO note_meta (owner, filename, is_todo, due_date, people, ort) VALUES (?,?,?,?,?,?)
     ON CONFLICT(owner, filename) DO UPDATE SET
       is_todo=excluded.is_todo, due_date=excluded.due_date,
       people=excluded.people, ort=excluded.ort`
  ).run(owner, filename, isTodo ? 1 : 0, dueDate || null, JSON.stringify({ known, extra }), ort || null);
}

// Datei wurde umbenannt/verschoben: Meta UND Desktop-Positionen ziehen mit um
function rename(owner, from, to) {
  db().prepare("UPDATE note_meta SET filename=? WHERE owner=? AND filename=?").run(to, owner, from);
  db().prepare("UPDATE note_desktop SET filename=? WHERE owner=? AND filename=?").run(to, owner, from);
}

// Notiz geloescht: Meta UND alle Desktop-Positionen (jedes Nutzers) entfernen
function remove(owner, filename) {
  db().prepare("DELETE FROM note_meta WHERE owner=? AND filename=?").run(owner, filename);
  db().prepare("DELETE FROM note_desktop WHERE owner=? AND filename=?").run(owner, filename);
}

// Dateinamen aller ToDo-Notizen eines Besitzers (fuer die Desktop-Icons)
function listTodos(owner) {
  return db().prepare("SELECT filename FROM note_meta WHERE owner=? AND is_todo=1")
    .all(owner).map((r) => r.filename);
}

// --- Desktop-Positionen der Notiz-Icons (je Betrachter) -----------------
function desktopPositions(username) {
  return db().prepare("SELECT owner, filename, x, y FROM note_desktop WHERE username=?").all(username);
}
function setDesktopPos(username, owner, filename, x, y) {
  db().prepare(
    `INSERT INTO note_desktop (username, owner, filename, x, y) VALUES (?,?,?,?,?)
     ON CONFLICT(username, owner, filename) DO UPDATE SET x=excluded.x, y=excluded.y`
  ).run(username, owner, filename, x, y);
}

// --- Freie Position anderer UI-Elemente je Nutzer (key -> x,y) -----------
function getLayout(username, key) {
  const r = db().prepare("SELECT x, y FROM desktop_layout WHERE username=? AND key=?").get(username, key);
  return r ? { x: r.x, y: r.y } : null;
}
function setLayout(username, key, x, y) {
  db().prepare(
    `INSERT INTO desktop_layout (username, key, x, y) VALUES (?,?,?,?)
     ON CONFLICT(username, key) DO UPDATE SET x=excluded.x, y=excluded.y`
  ).run(username, key, x, y);
}

module.exports = {
  get, set, rename, remove, listTodos, desktopPositions, setDesktopPos, getLayout, setLayout,
};
