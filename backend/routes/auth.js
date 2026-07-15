// Anmeldung: Login/Logout, eigenes Passwort, eigenes API-Token.
// Exportiert loginRequired fuer alle anderen Browser-Router.
const express = require("express");

const users = require("../users");
const { BASE } = require("../config");

const router = express.Router();

// Prueft den Nutzer bei jedem Request frisch gegen die DB: wer inzwischen
// gesperrt oder geloescht wurde, fliegt sofort raus — auch mit gueltigem Cookie.
// (req.path ist im gemounteten Router OHNE das BASE-Praefix, daher selbst praefixen.)
function loginRequired(req, res, next) {
  if (!req.session.user)
    return res.redirect(`${BASE}/login?next=` + encodeURIComponent(BASE + req.path));
  const row = users.get(req.session.user);
  if (!row || row.locked) return req.session.destroy(() => res.redirect(`${BASE}/login`));
  next();
}

router.get("/login", (req, res) => {
  res.render("login", { error: null, next: req.query.next || "" });
});

router.post("/login", (req, res) => {
  const row = users.verify((req.body.username || "").trim(), req.body.password || "");
  // Sperre erst NACH korrektem Passwort melden — Fremde erfahren so nicht,
  // welche Zugaenge existieren oder gesperrt sind
  if (row && row.locked) {
    return setTimeout(() =>
      res.render("login", { error: "Dieser Zugang ist gesperrt.", next: req.body.next || "" }),
      400);
  }
  if (row) {
    req.session.user = row.username;
    req.session.name = row.display_name;
    // Bootstrap-Admin erinnert sich selbst ans Passwort-Aendern
    if (row.is_admin && (req.body.password || "") === "admin")
      req.flash("err", "Es gilt noch das Standard-Passwort „admin“ — bitte gleich ändern (Menü → Mein Konto).");
    let nxt = req.body.next || "";
    // nur interne Pfade, sonst waere das ein Open Redirect
    if (!nxt.startsWith("/") || nxt.startsWith("//")) nxt = `${BASE}/`;
    return res.redirect(nxt);
  }
  setTimeout(() => // bremst Passwort-Raten
    res.render("login", { error: "Name oder Passwort falsch.", next: req.body.next || "" }),
    400);
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect(`${BASE}/login`));
});

router.post("/password", loginRequired, (req, res) => {
  const { old, new1, new2 } = req.body;
  // pwError merkt sich einmalig das fehlerhafte Feld ("old" | "new"):
  // die Startseite markiert es rot und oeffnet den Konto-Dialog wieder
  const fail = (field, msg) => {
    req.session.pwError = field;
    req.flash("err", msg);
    res.redirect(`${BASE}/`);
  };
  if (!users.verify(req.session.user, old || "")) {
    return setTimeout(() => fail("old", "Das aktuelle Passwort ist falsch."), 400); // bremst Passwort-Raten
  }
  if (new1 !== new2) return fail("new", "Die neuen Passwörter stimmen nicht überein.");
  if ((new1 || "").length < 8) return fail("new", "Das neue Passwort braucht mindestens 8 Zeichen.");
  users.setPassword(req.session.user, new1);
  req.flash("ok", "Passwort geändert.");
  res.redirect(`${BASE}/`);
});

router.post("/display-name", loginRequired, (req, res) => {
  const name = (req.body.display || "").trim().slice(0, 60);
  if (!name) {
    req.flash("err", "Der Anzeigename darf nicht leer sein.");
  } else {
    users.setDisplayName(req.session.user, name);
    req.session.name = name; // Session sofort nachziehen, nicht erst beim naechsten Login
    req.flash("ok", "Anzeigename geändert.");
  }
  res.redirect(`${BASE}/`);
});

router.post("/token/reset", loginRequired, (req, res) => {
  users.resetToken(req.session.user);
  req.flash("ok", "Neues API-Token erzeugt. Das alte gilt nicht mehr.");
  res.redirect(`${BASE}/`);
});

module.exports = { router, loginRequired };
