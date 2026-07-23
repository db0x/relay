// Strukturierte Zusatzattribute einer Notiz (ToDo/Faelligkeit, Personen, Ort).
// Bewusst getrennt von der .md — die soll reine Markdown bleiben. Muster wie
// shares.js: eine Zeile pro (owner, filename).
const { db } = require("./db");

// people: {known: [username,...], extra: [Freitextname,...]} — known bleibt
// eine Referenz auf den Nutzer (Anzeigename/Avatar werden live aufgeloest,
// nicht dupliziert), extra sind Personen ohne Account.
// color: '#rrggbb' fuer das Notiz-Icon; "" = Standard (das zweifarbige Pink
// aus note.svg, siehe --note-color in index.css).
function get(owner, filename) {
  const row = db().prepare(
    "SELECT is_todo, due_date, people, ort, color FROM note_meta WHERE owner=? AND filename=?"
  ).get(owner, filename);
  if (!row) return { isTodo: false, dueDate: "", people: { known: [], extra: [] }, ort: "", color: "" };
  return {
    isTodo: !!row.is_todo,
    dueDate: row.due_date || "",
    people: row.people ? JSON.parse(row.people) : { known: [], extra: [] },
    ort: row.ort || "",
    color: row.color || "",
  };
}

// leeres Meta (kein ToDo, keine Personen, kein Ort) -> Zeile ganz loeschen
// statt eine leere Zeile zu halten
function set(owner, filename, { isTodo, dueDate, people, ort, color }) {
  const known = (people && people.known) || [];
  const extra = (people && people.extra) || [];
  if (!isTodo && !dueDate && !known.length && !extra.length && !ort && !color) {
    remove(owner, filename);
    return;
  }
  db().prepare(
    `INSERT INTO note_meta (owner, filename, is_todo, due_date, people, ort, color) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(owner, filename) DO UPDATE SET
       is_todo=excluded.is_todo, due_date=excluded.due_date,
       people=excluded.people, ort=excluded.ort, color=excluded.color`
  ).run(owner, filename, isTodo ? 1 : 0, dueDate || null,
    JSON.stringify({ known, extra }), ort || null, color || null);
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

// --- Helligkeit einer Notiz-Farbe --------------------------------------
// Die umgeknickte Ecke des Notiz-Icons muss sich von der Flaeche abheben. Bei
// einer HELLEN Farbe geht das nur nach dunkel, bei einer DUNKLEN nur nach hell
// — diese Richtung kann CSS allein nicht entscheiden (relative Farben mit
// sign() koennen es, sind aber nicht ueberall verfuegbar; daran ist ein erster
// Versuch gescheitert: dunkle Ecken blieben unsichtbar). Sie wird darum hier
// bestimmt und als Klasse `note-dark` ans Icon geschrieben; das Mischen macht
// dann color-mix im CSS.
// ACHTUNG: Zwilling im Frontend — isDarkNoteColor() in public/js/index.js.
// Mass ist die WAHRGENOMMENE Helligkeit (OKLCH-L), nicht der RGB-Mittelwert:
// ein sattes Blau ist deutlich dunkler als ein Gelb gleicher RGB-Summe.
function lightness(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = chan(1), g = chan(3), b = chan(5);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}
function isDark(color) {
  return /^#[0-9a-f]{6}$/i.test(color || "") && lightness(color) < 0.62;
}

// Alle ToDo-Notizen eines Besitzers (fuer die Desktop-Icons), je mit Farbe
function listTodos(owner) {
  return db().prepare("SELECT filename, color FROM note_meta WHERE owner=? AND is_todo=1")
    .all(owner).map((r) => ({ filename: r.filename, color: r.color || "" }));
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
  get, set, rename, remove, listTodos, isDark,
  desktopPositions, setDesktopPos, getLayout, setLayout,
};
