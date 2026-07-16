// App-weite Einstellungen (Admin-Dialog) als Key/Value in SQLite.
// Werte sind JSON-kodiert; get liefert bei fehlendem Key den Fallback.
const { db } = require("./db");

function get(key, fallback) {
  const row = db().prepare("SELECT value FROM settings WHERE key=?").get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return fallback; }
}

function set(key, value) {
  db().prepare(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, JSON.stringify(value));
}

module.exports = { get, set };
