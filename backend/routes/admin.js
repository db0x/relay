// Nutzerverwaltung (nur Admins): Nutzer anlegen, Admin-Rechte, sperren/entsperren, loeschen.
const fs = require("fs");
const path = require("path");
const util = require("util");
const execFile = util.promisify(require("child_process").execFile);
const express = require("express");

const users = require("../users");
const settings = require("../settings");
const doclang = require("../doclang");
const maintenance = require("../maintenance");
const { secureFilename, dirFor } = require("../storage");
const { BASE, DOCS, STATE_DIR, BACKUP_DIR } = require("../config");
const { formatDate, formatDuration } = require("../format");

const router = express.Router();

// Admin-Status immer frisch aus der DB, nicht aus der Session — ein
// entzogenes Recht wirkt so sofort, nicht erst nach Neu-Login.
function adminRequired(req, res, next) {
  if (!req.session.user) return res.redirect(`${BASE}/login?next=` + encodeURIComponent(BASE + req.path));
  const row = users.get(req.session.user);
  if (!row || !row.is_admin) {
    req.flash("err", "Dafür braucht es Admin-Rechte.");
    return res.redirect(`${BASE}/`);
  }
  next();
}

// Einstellungen: welche Sprachen der "Neue Datei"-Dialog anbietet.
// Das Formular schickt die SICHTBAREN Codes; gespeichert werden die
// versteckten — so sind spaeter dazukommende Sprachen automatisch sichtbar.
router.post("/settings/langs", adminRequired, (req, res) => {
  let visible = req.body.visible || [];
  if (!Array.isArray(visible)) visible = [visible];
  const hidden = doclang.LANGS
    .map((l) => l.code)
    // der Default (Deutsch) ist nicht abwaehlbar — es braucht immer eine Wahl
    .filter((c) => c !== doclang.DEFAULT && !visible.includes(c));
  settings.set("hidden_langs", hidden);
  req.flash("ok", hidden.length
    ? `Sprachauswahl gespeichert — ${hidden.length} Sprache(n) ausgeblendet.`
    : "Sprachauswahl gespeichert — alle Sprachen sichtbar.");
  res.redirect(`${BASE}/`);
});

router.post("/users/create", adminRequired, (req, res) => {
  const name = (req.body.username || "").trim();
  const display = (req.body.display || "").trim() || name;
  const pw = req.body.password || "";
  const isAdmin = req.body.admin === "1";
  // Nutzername wird Ordnername unter documents/ -> gleiche Regeln wie Dateinamen
  if (!name || secureFilename(name) !== name) {
    req.flash("err", "Ungültiger Nutzername — erlaubt sind Buchstaben, Zahlen, Punkt, _ und -.");
  } else if (users.get(name)) {
    req.flash("err", `Nutzer „${name}“ existiert schon.`);
  } else if (pw.length < 8) {
    req.flash("err", "Das Startpasswort braucht mindestens 8 Zeichen.");
  } else {
    users.addUser(name, display, pw, isAdmin);
    req.flash("ok", `Nutzer „${display}“ angelegt${isAdmin ? " (Admin)" : ""}.`);
  }
  res.redirect(`${BASE}/`);
});

router.post("/users/admin", adminRequired, (req, res) => {
  const target = (req.body.target || "").trim();
  const give = req.body.value === "1";
  const row = users.get(target);
  if (!row) {
    req.flash("err", "Unbekannter Nutzer.");
  } else if (!give && target === req.session.user) {
    // Schutz vor dem Aussperren: der letzte Weg zurueck waere sonst nur die CLI
    req.flash("err", "Die eigenen Admin-Rechte kann man sich nicht selbst entziehen.");
  } else if (give && row.locked) {
    req.flash("err", `${row.display_name} ist gesperrt — erst entsperren, dann Admin machen.`);
  } else {
    users.setAdmin(target, give);
    req.flash("ok", give
      ? `${row.display_name} ist jetzt Admin.`
      : `${row.display_name} ist kein Admin mehr.`);
  }
  res.redirect(`${BASE}/`);
});

router.post("/users/lock", adminRequired, (req, res) => {
  const target = (req.body.target || "").trim();
  const lock = req.body.value === "1";
  const row = users.get(target);
  if (!row) {
    req.flash("err", "Unbekannter Nutzer.");
  } else if (lock && target === req.session.user) {
    req.flash("err", "Du kannst dich nicht selbst sperren.");
  } else if (lock && row.is_admin) {
    req.flash("err", `${row.display_name} ist Admin — erst die Admin-Rechte entziehen, dann sperren.`);
  } else {
    users.setLocked(target, lock);
    req.flash("ok", lock
      ? `${row.display_name} ist gesperrt — Login, Sitzungen und API-Token sind blockiert.`
      : `${row.display_name} ist wieder entsperrt.`);
  }
  res.redirect(`${BASE}/`);
});

// Nutzer MITSAMT allen Daten loeschen: DB-Zeile, Freigaben (beide Richtungen),
// Avatar (alles via users.del) und den kompletten Dokumentordner.
// Schutzregeln analog zu sperren: nicht sich selbst, keine Admins (erst
// Rechte entziehen) — verhindert das versehentliche Wegputzen eines Admins.
router.post("/users/delete", adminRequired, (req, res) => {
  const target = (req.body.target || "").trim();
  const row = users.get(target);
  if (!row) {
    req.flash("err", "Unbekannter Nutzer.");
  } else if (target === req.session.user) {
    req.flash("err", "Du kannst dich nicht selbst löschen.");
  } else if (row.is_admin) {
    req.flash("err", `${row.display_name} ist Admin — erst die Admin-Rechte entziehen, dann löschen.`);
  } else {
    users.del(target);
    fs.rmSync(dirFor(target), { recursive: true, force: true });
    req.flash("ok", `${row.display_name} wurde mitsamt allen Dateien gelöscht.`);
  }
  res.redirect(`${BASE}/`);
});

// Rsync-Log wird komplett in SQLite (settings.js) abgelegt und im Dialog
// angezeigt -- pro Lauf gedeckelt, damit ein Familienarchiv mit vielen
// Dateien die DB nicht sprengt. Bei Kuerzung bleibt das ENDE erhalten (dort
// steht die --stats-Zusammenfassung, die wichtigste Info bei vielen Dateien).
const MAX_LOG = 20000;
function capLog(text) {
  return text.length > MAX_LOG
    ? `… (gekürzt, letzte ${MAX_LOG} Zeichen) …\n` + text.slice(-MAX_LOG)
    : text;
}

// Backup: Dokumente und Nutzerdatenbank per rsync ins BACKUP-Volume spiegeln
// (--delete: das Backup entspricht danach exakt dem aktuellen Stand). Waehrend
// des Laufs greift die globale Wartungssperre (maintenance.js/app.js) --
// niemand darf lesen oder schreiben, sonst waere die Kopie inkonsistent.
// rsync laeuft asynchron (execFile, nicht -Sync), blockiert also nicht schon
// selbst den Event-Loop; die Sperre ist eine bewusste Zusatzmassnahme.
// -v/--stats liefern das Log, das der Admin danach im Dialog sieht (settings
// "last_backup": Zeitpunkt, Dauer, Erfolg, Log) -- zeitliche Einordnung plus
// Nachvollziehbarkeit, was genau kopiert/geloescht wurde.
//
// Der Backup-Dialog (index.js) ruft diese Route per fetch mit
// X-Requested-With:fetch auf, damit er waehrend des Laufs offen bleiben und
// danach das Ergebnis inline zeigen kann -- eine normale Formular-Anfrage
// (kein JS bzw. Fallback) bekommt weiterhin Flash+Redirect wie jede andere
// Admin-Aktion.
router.post("/backup/run", adminRequired, async (req, res) => {
  const ajax = req.get("X-Requested-With") === "fetch";
  const respond = (payload) => {
    if (ajax) return res.json(payload);
    req.flash(payload.ok ? "ok" : "err", payload.flashMsg);
    res.redirect(`${BASE}/`);
  };

  if (maintenance.isActive()) {
    const msg = "Backup läuft bereits.";
    return respond({ ok: false, atStr: "", durationStr: "", log: msg, flashMsg: msg });
  }
  maintenance.start();
  const startedAt = Date.now();
  let log = "";
  let ok = true;
  let errMsg = "";
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const opts = { maxBuffer: 8 * 1024 * 1024 };
    // --no-owner/--no-group: -a versucht sonst chown auf Owner/Group der
    // Quelle -- scheitert auf NFS-Zielen mit root_squash (das BACKUP-
    // Verzeichnis kann eine NAS-Freigabe sein), weil der gesquashte Nutzer
    // kein CAP_CHOWN hat. Fuer ein Backup sind die Metadaten irrelevant
    // (im Container gehoert ohnehin alles root); Inhalt/Rechte/Zeiten
    // bleiben ueber -a erhalten.
    const rsyncArgs = ["-a", "--no-owner", "--no-group", "--delete", "-v", "--stats"];
    const r1 = await execFile("rsync",
      [...rsyncArgs, DOCS + "/", path.join(BACKUP_DIR, "documents") + "/"], opts);
    log += "== Dokumente ==\n" + r1.stdout;
    const r2 = await execFile("rsync",
      [...rsyncArgs, STATE_DIR + "/", path.join(BACKUP_DIR, "state") + "/"], opts);
    log += "\n== Datenbank ==\n" + r2.stdout;
  } catch (e) {
    ok = false;
    errMsg = e.message || String(e);
    log += "\n== Fehler ==\n" + (e.stderr || errMsg);
  } finally {
    maintenance.stop();
  }
  const durationMs = Date.now() - startedAt;
  log = capLog(log);
  settings.set("last_backup", { at: startedAt, durationMs, ok, log });
  respond({
    ok, atStr: formatDate(startedAt), durationStr: formatDuration(durationMs), log,
    flashMsg: ok ? "Backup abgeschlossen." : "Backup fehlgeschlagen: " + errMsg,
  });
});

module.exports = { router };
