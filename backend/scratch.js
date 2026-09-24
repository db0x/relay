// Arbeitsablage: Dateien, die Relay nur VORUEBERGEHEND haelt.
//
// WOFUER: Voltage kann eine Datei oeffnen, die auf dem lokalen Rechner liegt
// und Relay gar nicht gehoert. Bearbeiten laesst sie sich trotzdem, weil
// OnlyOffice eine URL braucht — also muss der Inhalt einmal zum Server. Bisher
// landete er im normalen Ordner des Nutzers und blieb dort liegen: aus einer
// lokalen Datei wurden stillschweigend ZWEI, und die Kopie tauchte in der
// Dateiliste, in der Suche, im belegten Speicher und im Backup auf.
//
// Hier liegt sie stattdessen in einer eigenen Wurzel (SCRATCH_DIR), die
// AUSSERHALB von DOCUMENTS_DIR steht. Das ist der Kern des Ganzen: nichts muss
// sie einzeln ausnehmen. Die Dateiliste liest den Nutzerordner, die Suche
// ebenso, das Backup spiegelt DOCS/ und STATE_DIR/ (routes/admin.js) — keiner
// von ihnen sieht diesen Ordner ueberhaupt. Freigeben, verschieben oder
// umbenennen laesst sich hier nichts, es gibt keine Route dafuer.
//
// WICHTIG zur Abgrenzung: Dateien, die dem Nutzer in Relay GEHOEREN, kommen
// hier nie hinein. Voltage entscheidet das vor dem Hochladen (es vergleicht
// per md5, ob die Datei schon auf dem Server liegt); wer aus Relay heraus
// oeffnet, laeuft ohnehin ueber /edit und nicht hier vorbei. Die Trennung ist
// also strukturell und nicht bloss eine Abfrage: was hier liegt, ist per
// Definition eine Arbeitskopie, und was im Nutzerordner liegt, wird nie
// automatisch geloescht.
//
// AUFBAU auf der Platte — bewusst ohne Datenbanktabelle, damit es keine
// Wanderung braucht und ein Blick ins Dateisystem alles erzaehlt:
//   SCRATCH_DIR/<nutzer>/<kennung>/datei      der Inhalt
//   SCRATCH_DIR/<nutzer>/<kennung>/meta.json  { name, erstellt }
// Der ANZEIGENAME steht in meta.json statt im Dateinamen: secureFilename
// wuerde Umlaute und Leerzeichen zerstoeren ("Brief für Oma.docx"), und im
// Editor soll der Titel so stehen, wie die Datei beim Nutzer heisst.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { SCRATCH_DIR } = require("./config");
const { secureFilename } = require("./storage");

// Wie lange eine Arbeitskopie hoechstens liegen bleibt. Der Client raeumt
// selbst auf, sobald er fertig ist — dieser Wert ist das Netz darunter: ein
// abgestuerztes Voltage, ein abgebrochenes Netz oder ein Rechner, der im
// Ruhezustand verschwindet, duerfen keine Datei fuer immer hier lassen.
// Zwoelf Stunden sind lang genug fuer jede denkbare Sitzung an einem Dokument
// und kurz genug, dass nichts ueber Nacht stehen bleibt.
const TTL_MS = 12 * 60 * 60 * 1000;
// Wie oft nachgesehen wird. Stuendlich reicht: die Obergrenze ist eine
// Aufraeumfrist, kein Termin.
const KEHR_MS = 60 * 60 * 1000;

// Kennungen sind Zufall, keine Namen. Zwei gleichzeitig geoeffnete
// "brief.docx" aus verschiedenen Ordnern duerfen einander nicht ueberschreiben
// — ueber den Dateinamen adressiert waere genau das passiert.
const KENNUNG_RE = /^[0-9a-f]{32}$/;

function wurzel() {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  return SCRATCH_DIR;
}

// Ordner EINER Arbeitskopie, oder null wenn die Kennung nicht taugt.
// Die Pruefung gegen KENNUNG_RE ist die ganze Pfad-Sicherheit dieser Datei:
// eine Kennung aus 32 Hex-Zeichen kann kein "..", kein "/" und kein Null-Byte
// enthalten, also gibt es hier nichts auszubrechen.
function ordner(besitzer, kennung) {
  if (!KENNUNG_RE.test(String(kennung || ""))) return null;
  const n = secureFilename(besitzer);
  if (!n) return null;
  return path.join(wurzel(), n, kennung);
}

// Neue Arbeitskopie anlegen. `name` ist der Name beim Nutzer (nur zur Anzeige
// und fuer die Endung), `inhalt` ein Buffer.
function anlegen(besitzer, name, inhalt) {
  const kennung = crypto.randomBytes(16).toString("hex");
  const o = ordner(besitzer, kennung);
  if (!o) return null;
  fs.mkdirSync(o, { recursive: true });
  fs.writeFileSync(path.join(o, "datei"), inhalt);
  fs.writeFileSync(path.join(o, "meta.json"),
    JSON.stringify({ name: String(name || "dokument"), erstellt: Date.now() }));
  return kennung;
}

// Angaben zu einer Arbeitskopie, oder null. Liefert absoluten Pfad, den
// Anzeigenamen und die Endung — mehr braucht keiner der Aufrufer.
function lies(besitzer, kennung) {
  const o = ordner(besitzer, kennung);
  if (!o) return null;
  const datei = path.join(o, "datei");
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(o, "meta.json"), "utf8"));
    fs.statSync(datei);
  } catch (e) { return null; }
  const name = String(meta.name || "dokument");
  return {
    kennung, besitzer, datei, name,
    ext: (name.split(".").pop() || "").toLowerCase(),
    erstellt: meta.erstellt || 0,
  };
}

// Inhalt ersetzen (der Speicher-Callback des DocumentServers).
function schreiben(besitzer, kennung, inhalt) {
  const a = lies(besitzer, kennung);
  if (!a) return false;
  fs.writeFileSync(a.datei, inhalt);
  return true;
}

// Weg damit. Fehlt sie schon, gilt das als Erfolg — der Client darf das
// Loeschen gefahrlos wiederholen (etwa nach einem abgebrochenen Versuch).
function entfernen(besitzer, kennung) {
  const o = ordner(besitzer, kennung);
  if (!o) return false;
  try { fs.rmSync(o, { recursive: true, force: true }); } catch (e) { return false; }
  return true;
}

// Liegengebliebenes wegraeumen. Gemessen wird an meta.json (erstellt), nicht
// an der mtime der Datei: wer acht Stunden an einem Dokument sitzt, schreibt
// staendig neu, und nach der mtime waere die Kopie dann nie alt genug.
function kehren(jetzt = Date.now()) {
  let weg = 0;
  let nutzer = [];
  try { nutzer = fs.readdirSync(wurzel(), { withFileTypes: true }); } catch (e) { return 0; }
  for (const n of nutzer) {
    if (!n.isDirectory()) continue;
    const nDir = path.join(wurzel(), n.name);
    let kopien = [];
    try { kopien = fs.readdirSync(nDir, { withFileTypes: true }); } catch (e) { continue; }
    for (const k of kopien) {
      if (!k.isDirectory()) continue;
      const kDir = path.join(nDir, k.name);
      let erstellt = 0;
      try {
        erstellt = JSON.parse(fs.readFileSync(path.join(kDir, "meta.json"), "utf8")).erstellt || 0;
      } catch (e) {
        // Kein lesbares meta.json: ein abgebrochenes Anlegen. Das Alter des
        // Ordners entscheidet, damit so etwas nicht ewig liegen bleibt.
        try { erstellt = fs.statSync(kDir).mtimeMs; } catch (e2) { erstellt = 0; }
      }
      if (jetzt - erstellt < TTL_MS) continue;
      try { fs.rmSync(kDir, { recursive: true, force: true }); weg++; } catch (e) { /* naechstes Mal */ }
    }
    // leer gewordenen Nutzerordner mitnehmen (rmdir schlaegt fehl, wenn nicht leer)
    try { fs.rmdirSync(nDir); } catch (e) { /* nicht leer, bleibt */ }
  }
  return weg;
}

// Wächter starten. Einmal beim Hochfahren (nach einem Absturz liegt hier
// vielleicht etwas) und danach stuendlich. unref(): dieser Zeitgeber darf den
// Node-Prozess nicht am Beenden hindern.
function starteWaechter() {
  const lauf = () => {
    const weg = kehren();
    if (weg) console.log(`[scratch] ${weg} liegengebliebene Arbeitskopie(n) entfernt`);
  };
  lauf();
  const t = setInterval(lauf, KEHR_MS);
  if (t.unref) t.unref();
  return t;
}

module.exports = {
  anlegen, lies, schreiben, entfernen, kehren, starteWaechter, TTL_MS, KENNUNG_RE,
};
