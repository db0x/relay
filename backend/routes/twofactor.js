// Seiten der zweiten Stufe: Code eingeben, einrichten, Wiederherstellungscodes,
// Vertrauens-Geraete. Die Tore selbst (wer wohin darf) stehen in auth.js.
const QRCode = require("qrcode-svg");
const express = require("express");

const users = require("../users");
const zwei = require("../twofactor");
const totp = require("../totp");
const guard = require("../loginguard");
const protokoll = require("../eventlog");
const { BASE, APP_NAME } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

// Cookie-Einstellungen fuer das Vertrauens-Geraet. secure:"auto" gibt es bei
// res.cookie nicht — hinter dem Proxy sagt req.secure die Wahrheit (TRUST_PROXY).
function keksOptionen(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: !!req.secure,
    maxAge: zwei.TAGE_VERTRAUEN * 86400000,
    path: BASE || "/",
  };
}

// --- Code eingeben (nach dem Passwort) ----------------------------------
router.get("/zwei-faktor", loginRequired, (req, res) => {
  if (!req.session.pending2fa) return res.redirect(`${BASE}/`);
  res.render("zwei-faktor", { error: null, user: req.session.name || req.session.user });
});

router.post("/zwei-faktor", loginRequired, (req, res) => {
  if (!req.session.pending2fa) return res.redirect(`${BASE}/`);
  const me = req.session.user;
  const fehler = (msg) =>
    res.render("zwei-faktor", { error: msg, user: req.session.name || me });

  // Sechs Ziffern sind eine Million Moeglichkeiten — ohne Bremse waere das
  // in Minuten durchprobiert. Dieselbe wie beim Passwort (loginguard.js).
  const gebremst = guard.pruefe(me, req.ip);
  if (gebremst) {
    res.status(429);
    return fehler(`Zu viele Fehlversuche. Bitte in ${Math.ceil(gebremst.sekunden / 60)} Minuten erneut versuchen.`);
  }

  // Zahl oder Wiederherstellungscode — die Unterscheidung trifft zwei.js,
  // damit das Zuruecksetzen durch einen Admin dieselbe Regel benutzt.
  const passt = zwei.pruefeEingabe(me, req.body.code);

  if (!passt) {
    guard.fehlversuch(me, req.ip);
    protokoll.notiere("zweifaktor.fail", req, me);
    return setTimeout(() => fehler("Der Code stimmt nicht."), 400);
  }
  guard.erfolg(me);
  protokoll.notiere("zweifaktor.ok", req, me,
    req.body.vertrauen === "1" ? "Gerät gemerkt" : "");

  const ziel = req.session.zielNachZwei || `${BASE}/`;
  delete req.session.pending2fa;
  delete req.session.zielNachZwei;

  if (req.body.vertrauen === "1") {
    res.cookie(zwei.KEKS, zwei.merkeGeraet(me), keksOptionen(req));
  }
  const rest = zwei.offeneCodes(me);
  if (rest <= 2) {
    req.flash("err", `Nur noch ${rest} Wiederherstellungscode(s) übrig — bitte im Konto neue erzeugen.`);
  }
  res.redirect(ziel);
});

// --- Einrichten ----------------------------------------------------------
// WICHTIG: Wer die zweite Stufe schon eingerichtet hat, kommt hier nur mit
// VOLLSTAENDIGER Sitzung hin. Sonst koennte, wer nur das Passwort kennt, sich
// auf der Codeseite ein NEUES Geheimnis einrichten und die Stufe damit
// aushebeln — die Seite ist waehrend pending2fa ja erreichbar.
function einrichtungErlaubt(req, res, next) {
  const row = users.get(req.session.user);
  if (!row) return res.redirect(`${BASE}/login`);
  if (row.totp_active && req.session.pending2fa) return res.redirect(`${BASE}/zwei-faktor`);
  req.nutzerZeile = row;
  next();
}

router.get("/zwei-faktor/einrichten", loginRequired, einrichtungErlaubt, (req, res) => {
  const me = req.session.user;
  // Ein bereits begonnenes, aber noch nicht bestaetigtes Geheimnis behalten —
  // sonst zeigt ein Neuladen der Seite einen anderen QR-Code als die App hat.
  let geheimnis = req.nutzerZeile.totp_active ? null : zwei.geheimnisVon(me);
  if (!geheimnis) geheimnis = zwei.beginneEinrichtung(me);

  const url = totp.otpauthUrl(geheimnis, me, APP_NAME);
  res.render("zwei-faktor-einrichten", {
    error: null,
    geheimnis: totp.lesbar(geheimnis),
    qr: new QRCode({ content: url, padding: 1, width: 232, height: 232, ecl: "M", join: true }).svg(),
    neu: !!req.nutzerZeile.totp_active,
  });
});

router.post("/zwei-faktor/einrichten", loginRequired, einrichtungErlaubt, (req, res) => {
  const me = req.session.user;
  const codes = zwei.schliesseEinrichtungAb(me, req.body.code);
  if (!codes) {
    const geheimnis = zwei.geheimnisVon(me) || zwei.beginneEinrichtung(me);
    const url = totp.otpauthUrl(geheimnis, me, APP_NAME);
    return res.render("zwei-faktor-einrichten", {
      error: "Der Code stimmt nicht — läuft die Uhr des Geräts richtig?",
      geheimnis: totp.lesbar(geheimnis),
      qr: new QRCode({ content: url, padding: 1, width: 232, height: 232, ecl: "M", join: true }).svg(),
      neu: false,
    });
  }
  protokoll.notiere("zweifaktor.eingerichtet", req, me);
  // Einrichten zaehlt als bestandene zweite Stufe
  delete req.session.pending2fa;
  res.render("zwei-faktor-codes", { codes, weiter: req.session.zielNachZwei || `${BASE}/` });
});

// --- Verwaltung im Konto-Dialog -----------------------------------------
// Alle drei brauchen eine VOLLSTAENDIGE Sitzung: loginRequired laesst
// pending2fa hier nicht durch (der Pfad steht nicht in ERLAUBT_BEI_ZWEI).
router.post("/zwei-faktor/codes", loginRequired, (req, res) => {
  const codes = zwei.neueWiederherstellungscodes(req.session.user);
  res.render("zwei-faktor-codes", { codes, weiter: `${BASE}/` });
});

router.post("/zwei-faktor/geraete", loginRequired, (req, res) => {
  const n = zwei.vergissAlleGeraete(req.session.user);
  res.clearCookie(zwei.KEKS, { path: BASE || "/" });
  req.flash("ok", n
    ? `${n} vertraute(s) Gerät(e) vergessen — beim nächsten Anmelden wird überall wieder ein Code verlangt.`
    : "Es waren keine vertrauten Geräte gespeichert.");
  res.redirect(`${BASE}/`);
});

router.post("/zwei-faktor/neu", loginRequired, (req, res) => {
  zwei.schalteAb(req.session.user);
  res.clearCookie(zwei.KEKS, { path: BASE || "/" });
  res.redirect(`${BASE}/zwei-faktor/einrichten`);
});

module.exports = { router };
