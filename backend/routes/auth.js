// Anmeldung: Login/Logout, eigenes Passwort, eigenes API-Token.
// Exportiert loginRequired fuer alle anderen Browser-Router.
const express = require("express");

const users = require("../users");

const router = express.Router();

// Prueft den Nutzer bei jedem Request frisch gegen die DB: wer inzwischen
// gesperrt oder geloescht wurde, fliegt sofort raus — auch mit gueltigem Cookie.
function loginRequired(req, res, next) {
  if (!req.session.user) return res.redirect("/login?next=" + encodeURIComponent(req.path));
  const row = users.get(req.session.user);
  if (!row || row.locked) return req.session.destroy(() => res.redirect("/login"));
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
      req.flash("err", "Es gilt noch das Standard-Passwort „admin“ — bitte gleich ändern (Menü → Passwort ändern).");
    let nxt = req.body.next || "";
    // nur interne Pfade, sonst waere das ein Open Redirect
    if (!nxt.startsWith("/") || nxt.startsWith("//")) nxt = "/";
    return res.redirect(nxt);
  }
  setTimeout(() => // bremst Passwort-Raten
    res.render("login", { error: "Name oder Passwort falsch.", next: req.body.next || "" }),
    400);
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

router.post("/password", loginRequired, (req, res) => {
  const { old, new1, new2 } = req.body;
  if (!users.verify(req.session.user, old || "")) {
    return setTimeout(() => { // bremst Passwort-Raten
      req.flash("err", "Altes Passwort falsch.");
      res.redirect("/");
    }, 400);
  }
  if (new1 !== new2) req.flash("err", "Die neuen Passwörter stimmen nicht überein.");
  else if ((new1 || "").length < 6) req.flash("err", "Das neue Passwort braucht mindestens 6 Zeichen.");
  else { users.setPassword(req.session.user, new1); req.flash("ok", "Passwort geändert."); }
  res.redirect("/");
});

router.post("/token/reset", loginRequired, (req, res) => {
  users.resetToken(req.session.user);
  req.flash("ok", "Neues API-Token erzeugt. Das alte gilt nicht mehr.");
  res.redirect("/");
});

module.exports = { router, loginRequired };
