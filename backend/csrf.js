// Schutz gegen Anfragen, die eine fremde Seite im Namen des angemeldeten
// Nutzers auslöst (Cross-Site Request Forgery).
//
// Bisher trug das allein `SameSite=Lax` am Sitzungs-Cookie. Das deckt den
// Normalfall ab, ist aber die einzige Schicht — und sie haengt daran, dass
// der Browser sie kennt und dass niemand eine Nachbar-Herkunft kontrolliert
// (bei uns liegen mehrere Anwendungen auf DERSELBEN Domain, siehe nginx).
// Fuer einen Dienst mit Nutzerverwaltung und Backup-Knopf ist das zu duenn.
//
// Verfahren: ein Zufallswert je Sitzung, den jedes aendernde Formular
// mitschickt. Eine fremde Seite kann ihn nicht lesen (Same-Origin-Policy)
// und damit auch nicht mitsenden.
const crypto = require("crypto");

const { BASE } = require("./config");

const FELD = "_csrf";
const KOPFZEILE = "x-csrf-token";

// Anfragen ohne Nebenwirkung brauchen keinen Nachweis.
const HARMLOS = new Set(["GET", "HEAD", "OPTIONS"]);

// Zwei Pfade sind ausgenommen, beide mit gutem Grund:
//   /api/   — meldet sich per Token an, NICHT per Cookie. Eine fremde Seite
//             kann kein Token mitschicken, also gibt es hier nichts zu faelschen.
//   /callback/ — kommt vom DocumentServer (Maschine, kein Browser) und ist
//             per JWT signiert.
function ausgenommen(pfad) {
  return pfad.startsWith(`${BASE}/api/`) || pfad.startsWith(`${BASE}/callback/`);
}

function tokenFuer(req) {
  if (!req.session) return "";
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("base64url");
  return req.session.csrf;
}

// Der Nachweis darf aus drei Quellen kommen:
//   - Formularfeld (der Normalfall),
//   - Query-String — noetig bei multipart-Formularen (Datei-Upload): der
//     Rumpf wird erst von multer geparst, also NACH dieser Pruefung,
//   - Kopfzeile (fetch-Aufrufe im Frontend).
function mitgeschickt(req) {
  return (req.body && req.body[FELD])
    || (req.query && req.query[FELD])
    || req.get(KOPFZEILE)
    || "";
}

function gleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Stellt res.locals.csrf fuer die Vorlagen bereit und prueft aendernde Anfragen.
function csrfSchutz(req, res, next) {
  res.locals.csrf = tokenFuer(req);
  if (HARMLOS.has(req.method) || ausgenommen(req.path)) return next();

  const erwartet = req.session && req.session.csrf;
  const bekommen = mitgeschickt(req);
  if (erwartet && bekommen && gleich(erwartet, bekommen)) return next();

  // 403 ohne Umschweife. Wer legitim hier landet, hat eine sehr alte Seite
  // offen (z.B. nach einem Neustart mit neuer Sitzung) — dann hilft neu laden.
  res.status(403);
  if (req.get("X-Requested-With") === "fetch" || (req.get("accept") || "").includes("json")) {
    return res.json({ error: "csrf" });
  }
  res.type("text/plain; charset=utf-8").send(
    "Diese Anfrage konnte nicht zugeordnet werden. Bitte die Seite neu laden und erneut versuchen.");
}

module.exports = { csrfSchutz, FELD, KOPFZEILE };
