// Deutsche Anzeige-Formatierung, gemeinsam genutzt von routes/browse.js
// (Dateiliste) und routes/admin.js (Backup-Log).

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

module.exports = { formatDate, formatDuration };
