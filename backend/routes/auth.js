// Anmeldung: Login/Logout, eigenes Passwort, eigenes API-Token.
// Exportiert loginRequired fuer alle anderen Browser-Router.
const express = require("express");

const users = require("../users");
const guard = require("../loginguard");
const { darfVonHier } = require("../zone");
const { BASE } = require("../config");

// Meldung fuer Admins, die von ausserhalb des Heimnetzes anklopfen. Bewusst
// klar formuliert und erst NACH korrektem Passwort — dasselbe Muster wie bei
// gesperrten Zugaengen: Fremde erfahren nichts, der Betroffene versteht sofort,
// woran es liegt.
const ZONE_MELDUNG = "Admin-Zugänge sind nur aus dem Heimnetz erreichbar.";

const router = express.Router();

// Seite, auf der ein Zugang mit must_change landet — und die einzigen Pfade,
// die er ausser ihr noch erreichen darf.
const PW_SETZEN = "/passwort-setzen";
const ERLAUBT_BEI_ZWANG = new Set([PW_SETZEN, "/logout", "/login"]);

// Prueft den Nutzer bei jedem Request frisch gegen die DB: wer inzwischen
// gesperrt oder geloescht wurde, fliegt sofort raus — auch mit gueltigem Cookie.
// (req.path ist im gemounteten Router OHNE das BASE-Praefix, daher selbst praefixen.)
function loginRequired(req, res, next) {
  if (!req.session.user)
    return res.redirect(`${BASE}/login?next=` + encodeURIComponent(BASE + req.path));
  const row = users.get(req.session.user);
  if (!row || row.locked) return req.session.destroy(() => res.redirect(`${BASE}/login`));
  // Admin unterwegs: die Sitzung endet an der Haustuer. Ohne diese Pruefung
  // wuerde eine zuhause begonnene Sitzung im Zug einfach weiterlaufen.
  if (!darfVonHier(req, row))
    return req.session.destroy(() => res.redirect(`${BASE}/login?zone=1`));
  // Erstpasswort noch nicht gesetzt: nichts anderes ist erreichbar
  if (row.must_change && !ERLAUBT_BEI_ZWANG.has(req.path))
    return res.redirect(BASE + PW_SETZEN);
  next();
}

// Ziel nach dem Login: nur INNERHALB dieser Anwendung. Statt auf Zeichenketten
// zu pruefen (dabei rutschte "/\fremde.example" durch — Browser machen daraus
// "//fremde.example" und verlassen damit unsere Herkunft) wird die Adresse
// geparst und nur Pfad + Query weiterverwendet.
function internesZiel(roh) {
  try {
    const u = new URL(String(roh || ""), "http://relay.invalid");
    const ziel = u.pathname + u.search;
    return ziel.startsWith("/") ? ziel : `${BASE}/`;
  } catch (e) {
    return `${BASE}/`;
  }
}

router.get("/login", (req, res) => {
  // ?zone=1 setzt loginRequired, wenn es eine Admin-Sitzung ausserhalb des
  // Heimnetzes beendet hat — sonst staende man ohne Erklaerung vor dem Login
  res.render("login", {
    error: req.query.zone ? ZONE_MELDUNG : null,
    next: req.query.next || "",
  });
});

router.post("/login", async (req, res) => {
  const name = (req.body.username || "").trim();
  const zeigeFehler = (msg) =>
    res.render("login", { error: msg, next: req.body.next || "" });

  // Zu viele Fehlversuche? Dann gar nicht erst hashen — genau das ist der
  // teure Teil und damit auch der Hebel fuer einen Denial-of-Service.
  const gebremst = guard.pruefe(name, req.ip);
  if (gebremst) {
    res.status(429);
    return zeigeFehler(`Zu viele Fehlversuche. Bitte in ${Math.ceil(gebremst.sekunden / 60)} Minuten erneut versuchen.`);
  }

  const row = await users.verify(name, req.body.password || "");
  // Sperre erst NACH korrektem Passwort melden — Fremde erfahren so nicht,
  // welche Zugaenge existieren oder gesperrt sind
  if (row && row.locked) {
    guard.fehlversuch(name, req.ip);
    return zeigeFehler("Dieser Zugang ist gesperrt.");
  }
  // Passwort stimmt, aber es ist ein Admin von ausserhalb: kein Fehlversuch
  // (geraten hat hier niemand), aber auch keine Sitzung.
  if (row && !darfVonHier(req, row)) {
    res.status(403);
    return zeigeFehler(ZONE_MELDUNG);
  }
  if (row) {
    guard.erfolg(name);
    // Sitzungs-ID nach dem Anmelden neu vergeben (gegen Session Fixation):
    // ein vorher untergeschobenes Cookie ist damit wertlos.
    return req.session.regenerate((err) => {
      if (err) return zeigeFehler("Anmeldung fehlgeschlagen, bitte erneut versuchen.");
      req.session.user = row.username;
      req.session.name = row.display_name;
      if (row.must_change) return res.redirect(BASE + PW_SETZEN);
      res.redirect(internesZiel(req.body.next));
    });
  }
  guard.fehlversuch(name, req.ip);
  setTimeout(() => zeigeFehler("Name oder Passwort falsch."), 400); // bremst zusaetzlich
});

// --- Erstpasswort setzen (must_change) ----------------------------------
router.get(PW_SETZEN, loginRequired, (req, res) => {
  res.render("password-change", { error: null, user: req.session.name || req.session.user });
});

router.post(PW_SETZEN, loginRequired, async (req, res) => {
  const { new1, new2 } = req.body;
  const fehler = (msg) =>
    res.render("password-change", { error: msg, user: req.session.name || req.session.user });
  if (new1 !== new2) return fehler("Die Passwörter stimmen nicht überein.");
  if ((new1 || "").length < 12) return fehler("Das Passwort braucht mindestens 12 Zeichen.");
  await users.setPassword(req.session.user, new1); // loescht must_change mit
  req.flash("ok", "Passwort gesetzt. Willkommen!");
  res.redirect(`${BASE}/`);
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect(`${BASE}/login`));
});

router.post("/password", loginRequired, async (req, res) => {
  const { old, new1, new2 } = req.body;
  // pwError merkt sich einmalig das fehlerhafte Feld ("old" | "new"):
  // die Startseite markiert es rot und oeffnet den Konto-Dialog wieder
  const fail = (field, msg) => {
    req.session.pwError = field;
    req.flash("err", msg);
    res.redirect(`${BASE}/`);
  };
  // dieselbe Bremse wie beim Login: hier laesst sich ein Passwort genauso raten
  const gebremst = guard.pruefe(req.session.user, req.ip);
  if (gebremst) return fail("old", "Zu viele Fehlversuche. Bitte später erneut versuchen.");
  if (!(await users.verify(req.session.user, old || ""))) {
    guard.fehlversuch(req.session.user, req.ip);
    return setTimeout(() => fail("old", "Das aktuelle Passwort ist falsch."), 400); // bremst Passwort-Raten
  }
  guard.erfolg(req.session.user);
  if (new1 !== new2) return fail("new", "Die neuen Passwörter stimmen nicht überein.");
  if ((new1 || "").length < 8) return fail("new", "Das neue Passwort braucht mindestens 8 Zeichen.");
  await users.setPassword(req.session.user, new1);
  req.flash("ok", "Passwort geändert.");
  res.redirect(`${BASE}/`);
});

// Profil: Anzeigename + optionale E-Mail-Adresse, EIN Formular, EIN Speichern.
// E-Mail: leer = entfernen, sonst muss das Format stimmen. Bewusst
// pragmatisches Muster (kein Whitespace, ein @, Punkt in der Domain) —
// dasselbe Regex prueft clientseitig (pattern + live) in index.ejs/index.js.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
router.post("/profile", loginRequired, (req, res) => {
  const name = (req.body.display || "").trim().slice(0, 60);
  const email = (req.body.email || "").trim().slice(0, 120);
  if (!name) {
    req.flash("err", "Der Anzeigename darf nicht leer sein.");
    return res.redirect(`${BASE}/`);
  }
  if (email && !EMAIL_RE.test(email)) {
    req.session.emailError = true; // Startseite markiert das Feld (wie pwError)
    req.flash("err", "Das ist keine gültige E-Mail-Adresse — nichts gespeichert.");
    return res.redirect(`${BASE}/`);
  }
  users.setDisplayName(req.session.user, name);
  req.session.name = name; // Session sofort nachziehen, nicht erst beim naechsten Login
  users.setEmail(req.session.user, email || null);
  // Schalter: unangehakte Checkboxen schicken gar nichts mit — fehlt das Feld,
  // ist er aus. Er steht im selben Formular, also EIN Speichern fuer alles.
  users.setDeskNotes(req.session.user, req.body.deskNotes === "1");
  req.flash("ok", "Profil gespeichert.");
  res.redirect(`${BASE}/`);
});

router.post("/token/reset", loginRequired, (req, res) => {
  users.resetToken(req.session.user);
  req.flash("ok", "Neues API-Token erzeugt. Das alte gilt nicht mehr.");
  res.redirect(`${BASE}/`);
});

module.exports = { router, loginRequired };
