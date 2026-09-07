// Gemerkte Sortierung der Dateiliste — je NUTZER und je ORDNER.
//
// Wer in einem Ordner nach Namen sortiert, meint meistens genau diesen Ordner:
// die Filmsammlung will man nach Namen, den Posteingang nach Datum. Darum haengt
// die Wahl am Ordner und nicht am Nutzer als Ganzes — und sie ueberlebt die
// Sitzung, sonst muesste man sie bei jedem Besuch neu treffen.
//
// Schluessel ist derselbe Ordnerbezeichner wie in der URL (?p=): "" ist die
// oberste Ebene, "steuern/2026" ein Unterordner, "lib:filme/fsk6" ein Ordner der
// Bibliothek. Muster wie notemeta.getLayout/setLayout.
const { db } = require("./db");

const SORTS = ["name", "size", "date"];
const SORT_DEFAULT = "date";
const DIR_DEFAULT = "desc";   // neueste zuerst

// Die Vorgabe wird NICHT gespeichert (wie bei notemeta.set): eine Zeile, die
// nur den Standardwert enthaelt, ist keine Information — und wer bewusst zur
// Vorgabe zurueckkehrt, soll den Ordner wieder wie unberuehrt vorfinden.
function isDefault(sort, richtung) {
  return sort === SORT_DEFAULT && richtung === DIR_DEFAULT;
}

// null = nichts gemerkt -> der Aufrufer nimmt seine Vorgabe
function get(username, folder) {
  const r = db().prepare(
    "SELECT sort, dir FROM folder_sort WHERE username=? AND folder=?"
  ).get(username, String(folder || ""));
  if (!r || !SORTS.includes(r.sort)) return null;
  return { sort: r.sort, dir: r.dir === "asc" ? "asc" : "desc" };
}

function set(username, folder, sort, richtung) {
  const f = String(folder || "");
  const s = SORTS.includes(sort) ? sort : SORT_DEFAULT;
  const d = richtung === "asc" ? "asc" : "desc";
  if (isDefault(s, d)) return remove(username, f);
  db().prepare(
    `INSERT INTO folder_sort (username, folder, sort, dir) VALUES (?,?,?,?)
     ON CONFLICT(username, folder) DO UPDATE SET sort=excluded.sort, dir=excluded.dir`
  ).run(username, f, s, d);
}

// Ordner weg -> gemerkte Sortierung weg (routes/browse.js: POST /rmdir).
// Sonst erbte ein spaeter gleich benannter Ordner die Wahl seines Vorgaengers.
function remove(username, folder) {
  db().prepare("DELETE FROM folder_sort WHERE username=? AND folder=?")
    .run(username, String(folder || ""));
}

module.exports = { get, set, remove, SORTS, SORT_DEFAULT, DIR_DEFAULT };
