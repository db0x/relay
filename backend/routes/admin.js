// Nutzerverwaltung (nur Admins): Nutzer anlegen, Admin-Rechte, sperren/entsperren.
const express = require("express");

const users = require("../users");
const settings = require("../settings");
const doclang = require("../doclang");
const { secureFilename } = require("../storage");
const { BASE } = require("../config");

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

module.exports = { router };
