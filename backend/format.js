// Deutsche Anzeige-Formatierung, gemeinsam genutzt von routes/browse.js
// (Dateiliste), routes/admin.js (Backup-Log) und routes/notes.js (Notiz-Netz).
const path = require("path");

// Zeitstempel -> "05.07.2026, 14:30"
function formatDate(ms) {
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Dauer (ms) -> "12,3 s" bzw. "2 min 5 s"
function formatDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

// Notizen heissen {uuid}-{Titel}.md — angezeigt wird nur der Titel; alle
// Links und Aktionen laufen weiter ueber den vollen Namen.
const NOTE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.*)\.md$/i;
function labelFromName(name) {
  // Immer nur der Dateiname: hier kommt teils der volle relative Pfad an
  // (Datei in einem Unterordner). Ohne basename stand in der Liste
  // "Steuer/Nebenkosten.xlsx" statt "Nebenkosten.xlsx".
  const base = path.basename(name);
  const m = base.match(NOTE_RE);
  // Unterstriche stammen aus secureFilename (Leerzeichen im Titel) —
  // fuer die Anzeige wieder zu Leerzeichen
  return m ? (m[1].replace(/_/g, " ") || "Notiz") : base;
}

module.exports = { formatDate, formatDuration, NOTE_RE, labelFromName };
