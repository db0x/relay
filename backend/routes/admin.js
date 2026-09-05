// Nutzerverwaltung (nur Admins): Nutzer anlegen, Admin-Rechte, sperren/entsperren, loeschen.
const fs = require("fs");
const path = require("path");
const util = require("util");
const execFile = util.promisify(require("child_process").execFile);
const express = require("express");

const users = require("../users");
const notifications = require("../notifications");
const settings = require("../settings");
const doclang = require("../doclang");
const maintenance = require("../maintenance");
const library = require("../library");
const { secureFilename, dirFor } = require("../storage");
const { darfVonHier } = require("../zone");
const { BASE, DOCS, STATE_DIR, BACKUP_DIR } = require("../config");
const { formatDate, formatDuration } = require("../format");
const { loginRequired } = require("./auth");
const protokoll = require("../eventlog");
const { beendeSitzungenVon } = require("../sessionstore");
const zwei = require("../twofactor");
const guard = require("../loginguard");

const router = express.Router();

// Admin-Status immer frisch aus der DB, nicht aus der Session — ein
// entzogenes Recht wirkt so sofort, nicht erst nach Neu-Login.
//
// WICHTIG: loginRequired laeuft VORWEG, nicht nur eine eigene Session-
// Pruefung. Frueher stand hier nur `if (!req.session.user)` — damit lief eine
// Sitzung, die erst das Passwort bestanden hatte und noch vor der zweiten
// Stufe stand, glatt in die Verwaltungsrouten hinein. Die Tore (gesperrt,
// Zone, Erstpasswort, zweite Stufe) gehoeren an EINE Stelle, sonst vergisst
// man eines.
const adminRequired = [loginRequired, function (req, res, next) {
  const row = users.get(req.session.user);
  if (!row || !row.is_admin) {
    req.flash("err", "Dafür braucht es Admin-Rechte.");
    return res.redirect(`${BASE}/`);
  }
  // Doppelter Boden zur Zonenpruefung in loginRequired: die Verwaltungsrouten
  // sind der Grund fuer die ganze Regel, die pruefen selbst.
  if (!darfVonHier(req, row)) return res.sendStatus(404);
  next();
}];

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

// Leserechte auf die geteilte Bibliothek setzen (ein Dialog je Nutzer in der
// Nutzerverwaltung). Das Formular schickt IMMER alle angehakten Ordner, die
// Rechte werden also komplett ersetzt — kein Nachhalten von Differenzen.
//
// Gegengeprueft wird gegen die tatsaechlich vorhandenen Ordner der obersten
// Ebene: ein untergeschobener Name (oder einer, den es nicht mehr gibt) landet
// gar nicht erst in der Datenbank. Anders als bei Freigaben sind hier auch
// Admins zugelassen — die Bibliothek gehoert dem Server, nicht einem Nutzer;
// sie an einem Verwaltungszugang vorbei zu sperren, brachte niemandem etwas.
router.post("/users/library", adminRequired, (req, res) => {
  const target = (req.body.target || "").trim();
  const row = users.get(target);
  if (!row) {
    req.flash("err", "Unbekannter Nutzer.");
  } else {
    let gewaehlt = req.body.folder || [];
    if (!Array.isArray(gewaehlt)) gewaehlt = [gewaehlt];
    // Gegen den TATSAECHLICHEN Ordnerbaum pruefen: ein untergeschobener Pfad
    // (oder einer, den es nicht mehr gibt) landet gar nicht erst in der
    // Datenbank. library.setGrants wirft danach noch weg, was schon von einem
    // Recht weiter oben abgedeckt ist, und zaehmt die Anzeigenamen.
    const vorhanden = library.folderTree().map((k) => k.rel);
    // Der Anzeigename eines Ordners steht in einem Feld "lbl:<pfad>" — ein
    // eigenes name-Attribut je Zeile. Ein gemeinsamer Name ginge nicht: nicht
    // angehakte Kaestchen schickt der Browser nicht mit, die Reihenfolge der
    // Namensfelder passte dann nicht mehr zu der der Ordner.
    const ordner = vorhanden
      .filter((f) => gewaehlt.includes(f))
      .map((f) => ({ folder: f, label: req.body[`lbl:${f}`] }));
    library.setGrants(target, ordner);
    protokoll.notiere("admin.bibliothek", req, req.session.user,
      `${target} -> ${ordner.length ? ordner.join(", ") : "kein Zugriff"}`);
    // Die gespeicherte Zahl kann kleiner sein als die angehakte (abgedeckte
    // Unterordner fallen weg) — darum nachlesen statt mitzaehlen.
    const gespeichert = library.grantedFolders(target).length;
    req.flash("ok", gespeichert
      ? `${row.display_name} sieht jetzt ${gespeichert} Bibliotheksordner.`
      : `${row.display_name} hat keinen Zugriff mehr auf die Bibliothek.`);
  }
  res.redirect(`${BASE}/`);
});

router.post("/users/create", adminRequired, async (req, res) => {
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
    await users.addUser(name, display, pw, isAdmin);
    protokoll.notiere("admin.nutzer.anlegen", req, req.session.user,
      `${name}${isAdmin ? " (Admin)" : ""}`);
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
    protokoll.notiere("admin.rechte", req, req.session.user, `${target} -> ${give ? "Admin" : "kein Admin"}`);
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
    // Sitzungen sofort beenden statt nur den naechsten Login zu blockieren.
    // loginRequired warf gesperrte Nutzer zwar schon bei der naechsten Anfrage
    // raus -- aber erst DANN. Jetzt ist die Sitzung sofort weg.
    if (lock) beendeSitzungenVon(target);
    protokoll.notiere("admin.sperre", req, req.session.user, `${target} -> ${lock ? "gesperrt" : "entsperrt"}`);
    req.flash("ok", lock
      ? `${row.display_name} ist gesperrt — Login, Sitzungen und API-Token sind blockiert.`
      : `${row.display_name} ist wieder entsperrt.`);
  }
  res.redirect(`${BASE}/`);
});

// Passwort eines Nutzers zuruecksetzen — NUR mit der zweiten Stufe des Admins.
//
// Warum die zweite Stufe hier auch dann, wenn ADMIN_2FA aus ist: das ist die
// eine Admin-Aktion, mit der man in fremde Dokumente kommt, ohne dass jemand
// es merkt. Ein Sperren faellt sofort auf, ein Loeschen erst recht — ein
// gesetztes Passwort nicht. Wer also an einer offenen Admin-Sitzung sitzt,
// soll damit trotzdem nicht in fremde Daten spazieren koennen.
// Ist keine zweite Stufe eingerichtet, geht die Aktion GAR NICHT.
//
// Weitere Regeln:
//   - nur fuer Nicht-Admins (bei einem Admin erst die Rechte entziehen) und
//     nie fuer sich selbst — dafuer gibt es "Mein Konto"
//   - das neue Passwort ist ein EINMAL-Passwort: must_change zwingt den Nutzer
//     beim naechsten Anmelden zu einem eigenen (users.setPassword)
//   - die Sitzungen des Nutzers enden sofort, sonst liefe eine offene Sitzung
//     mit dem alten Zugang weiter
router.post("/users/password", adminRequired, async (req, res) => {
  const me = req.session.user;
  const target = (req.body.target || "").trim();
  const pw1 = String(req.body.pw1 || ""), pw2 = String(req.body.pw2 || "");
  const row = users.get(target);
  const fertig = (art, text) => { req.flash(art, text); res.redirect(`${BASE}/`); };

  if (!row) return fertig("err", "Unbekannter Nutzer.");
  if (target === me) return fertig("err", "Das eigene Passwort änderst du in „Mein Konto“.");
  if (row.is_admin) return fertig("err", `${row.display_name} ist Admin — erst die Admin-Rechte entziehen.`);
  if (pw1.length < 8) return fertig("err", "Das Passwort braucht mindestens 8 Zeichen.");
  if (pw1 !== pw2) return fertig("err", "Die beiden Passwörter stimmen nicht überein.");

  const ich = users.get(me);
  if (!ich || !ich.totp_active) {
    protokoll.notiere("admin.pwreset.ohne2fa", req, me, target);
    return fertig("err", "Dafür braucht dein Zugang eine zweite Stufe — "
      + "richte sie in „Mein Konto“ ein.");
  }

  // Dieselbe Bremse wie beim Anmelden: sechs Ziffern waeren sonst durchprobiert.
  // Bewusst OHNE res.status(429): diese Antwort ist eine Weiterleitung, und
  // res.redirect setzt den Status ohnehin auf 302 (nachgemessen). Ein 429
  // davorzuschreiben taeuschte nur etwas vor, das nicht beim Browser ankommt —
  // die Anmeldeseite kann es, die rendert statt umzuleiten.
  const gebremst = guard.pruefe(me, req.ip);
  if (gebremst) {
    return fertig("err", `Zu viele Fehlversuche. Bitte in ${Math.ceil(gebremst.sekunden / 60)} Minuten erneut versuchen.`);
  }
  if (!zwei.pruefeEingabe(me, req.body.code)) {
    guard.fehlversuch(me, req.ip);
    protokoll.notiere("admin.pwreset.fail", req, me, target);
    return fertig("err", "Der Code stimmt nicht — das Passwort wurde NICHT geändert.");
  }
  guard.erfolg(me);

  await users.setPassword(target, pw1, true);
  beendeSitzungenVon(target);
  protokoll.notiere("admin.pwreset", req, me, target);
  fertig("ok", `Passwort von ${row.display_name} gesetzt. `
    + "Beim nächsten Anmelden muss ein eigenes gewählt werden; offene Sitzungen sind beendet.");
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
    beendeSitzungenVon(target);
    protokoll.notiere("admin.nutzer.loeschen", req, req.session.user, target);
    notifications.removeForUser(target);
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
  protokoll.notiere("backup.start", req, req.session.user);
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
    // Die BIBLIOTHEK gehoert ausdruecklich NICHT ins Backup: sie gehoert dem
    // Server, wird nur gelesen und ist auf einer ganz anderen Ebene gesichert
    // (NAS). Normalerweise liegt sie ausserhalb von DOCS und kommt hier gar
    // nicht vorbei -- steht SHARED_LIB aber auf einem Pfad INNERHALB von
    // DOCUMENTS_DIR, sitzt dieselbe Sammlung mitten im Nutzerbaum und rsync
    // wuerde sie mitnehmen. Dann wird sie hier ausgeschlossen (siehe
    // library.insideDocs) und der Admin liest im Log, dass es passiert ist.
    const bibDrin = library.insideDocs();
    const bibAus = bibDrin ? [`--exclude=/${bibDrin}/`] : [];
    const r1 = await execFile("rsync",
      [...rsyncArgs, ...bibAus, DOCS + "/", path.join(BACKUP_DIR, "documents") + "/"], opts);
    log += "== Dokumente ==\n";
    if (bibDrin) {
      log += `Hinweis: Die Bibliothek (SHARED_LIB) liegt unter „${bibDrin}" INNERHALB\n`
        + "der Nutzerdateien und wurde ausgelassen — sie wird getrennt gesichert.\n"
        + "Sauberer ist ein SHARED_LIB-Pfad ausserhalb von DOCUMENTS_DIR.\n\n";
    }
    log += r1.stdout;
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
