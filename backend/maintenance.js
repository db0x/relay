// In-Memory-Sperre fuer die Dauer eines Backups (routes/admin.js /backup/run):
// waehrend rsync documents/ und state/users.db kopiert, darf niemand mit
// Relay arbeiten -- sonst waere die Kopie ein inkonsistenter Zwischenstand.
// Ein Prozess -> ein Flag reicht, kein Redis/DB-Lock noetig.
let active = false;

function isActive() { return active; }
function start() { active = true; }
function stop() { active = false; }

module.exports = { isActive, start, stop };
