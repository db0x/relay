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

// Datei wurde umbenannt/verschoben: Meta zeigt auf den neuen Pfad
function rename(owner, from, to) {
  db().prepare("UPDATE note_meta SET filename=? WHERE owner=? AND filename=?").run(to, owner, from);
}

function remove(owner, filename) {
  db().prepare("DELETE FROM note_meta WHERE owner=? AND filename=?").run(owner, filename);
}

module.exports = { get, set, rename, remove };
