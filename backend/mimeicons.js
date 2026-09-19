// Datei-Icons aus dem mitgelieferten Symbolsatz (public/img/mimetypes/).
//
// Bis hierher kannte Relay eine Handvoll Typen (Office, PDF, Bild, Video,
// Notiz) und zeigte fuer alles andere ein Fragezeichen — ein .zip sah aus wie
// ein .iso wie ein .mp3. Der Satz unter public/img/mimetypes/ deckt mehrere
// hundert Typen ab; dieses Modul schlaegt die Bruecke.
//
// Der Weg ist Endung -> MIME-Typ -> Dateiname des Icons:
//
//   "urlaub.tar" -> "application/x-tar" -> "application-x-tar.svg"
//
// Der zweite Pfeil ist geschenkt: der Symbolsatz folgt der Namensregel von
// freedesktop.org, dort wird im MIME-Typ nur der Schraegstrich zum Bindestrich.
// Der erste kommt von `mime-types` — das Paket ist ueber Express ohnehin schon
// installiert (send/serve-static bauen darauf), es kommt also KEINE neue
// Abhaengigkeit dazu.
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const DIR = path.join(__dirname, "public", "img", "mimetypes");
// Pfad relativ zu /static/img/ — genau das, was die Vorlagen und die
// fetch-Aufrufe im Browser hinter "/static/img/" setzen und um ".svg"
// ergaenzen. Dadurch bleibt jede Aufrufstelle unveraendert.
const PREFIX = "mimetypes/";

// Einmal beim Start einlesen: welche Icons gibt es WIRKLICH?
//
// Der Satz stammt aus einem Symbol-Thema, von dem nur der mimetypes-Ordner
// uebernommen wurde. Etliche Eintraege darin sind Verweise auf Nachbarordner
// (../apps, ../places), die es hier nicht gibt — die zeigen ins Leere.
// `existsSync` folgt dem Verweis und sortiert sie damit von selbst aus. Ohne
// diese Pruefung lieferte die Oberflaeche Adressen, die mit 404 antworten,
// und man saehe ein kaputtes Bild statt eines Icons.
const vorhanden = new Set();
try {
  for (const datei of fs.readdirSync(DIR)) {
    if (!datei.endsWith(".svg")) continue;
    if (fs.existsSync(path.join(DIR, datei))) vorhanden.add(datei.slice(0, -4));
  }
} catch (e) {
  // Ordner fehlt (z.B. schlanker Build) -> alles faellt auf die eigenen
  // Icons zurueck, die Anwendung laeuft unveraendert weiter.
}

// Endungen, die `mime-types` nicht kennt, fuer die der Symbolsatz aber ein
// passendes Icon hat. Bewusst kurz gehalten: hier gehoert nur hinein, was
// wirklich vorkommt — die grosse Masse deckt mime-types ab.
const EXTRA = {
  py: "text-x-python", log: "text-x-log", ini: "text-x-ini",
  conf: "text-x-config", cfg: "text-x-config",
  yml: "application-x-yaml", yaml: "application-x-yaml",
  ts: "text-x-typescript", tsx: "text-x-typescript",
  js: "application-x-javascript", mjs: "application-x-javascript",
  jsx: "application-x-javascript",
  sql: "text-x-sql", sh: "text-x-script", bash: "text-x-script",
  sqlite: "application-x-sqlite3", db: "application-x-sqlite3",
  heic: "image-heif", heif: "image-heif",
  cbr: "application-x-cbr", cbz: "application-x-cbz",
};

// Familien-Rueckfall: Ersatz, wenn es zum genauen Typ kein Icon GIBT.
//
// Das ist kein Schoenheitsfehler des Satzes, sondern eine Luecke mit Ansage:
// die Archiv-Symbole des Themas sind allesamt Verweise auf ../apps/ark.svg —
// einen Nachbarordner, der hier nie ankam. Genau deshalb blieben ausgerechnet
// die haeufigsten Typen (.zip, .tar, .rar, .7z, .iso, .deb) ohne Icon. Die
// Tabelle schickt die ganze Familie auf ein Symbol, das WIRKLICH da ist.
//
// Geprueft wird gegen den MIME-Typ, nicht die Endung: eine Regel deckt so
// dutzende Endungen ab und bleibt richtig, wenn eine neue dazukommt.
const FAMILIE = [
  // Archive, Abbilder und Pakete
  [/^application\/(zip|gzip|vnd\.rar|x-(tar|7z-compressed|rar|bzip\d?|xz|lzma|lzip|lz4|compress|gtar|cpio|archive|stuffit|ace|arj|lha|iso9660-image|apple-diskimage|cd-image)|x-debian-package|x-rpm|x-redhat-package-manager|vnd\.debian\.binary-package)/,
    "application-x-gzip"],
  // Ausfuehrbares und Installationsdateien
  [/^application\/(x-ms|x-executable|x-sharedlib|vnd\.microsoft\.portable-executable)/,
    "application-x-msdos-program"],
  // Skripte
  [/^application\/(x-sh|x-shellscript|x-perl|x-ruby|x-php|x-python)/, "text-x-script"],
];

function hat(name) { return vorhanden.has(name); }

// MIME-Typ -> Icon-Name. Erst der genaue Typ, dann die Obergruppe
// ("text-x-generic", "audio-x-generic", ...) — die gibt es fuer die grossen
// Familien und ist immer noch aussagekraeftiger als ein Fragezeichen.
function fuerMime(typ) {
  if (!typ) return null;
  const rein = String(typ).split(";")[0].trim();
  // Namensregel von freedesktop.org: im MIME-Typ wird nur der Schraegstrich
  // zum Bindestrich. "application/x-tar" -> "application-x-tar"
  const flach = rein.replace(/\//g, "-");
  if (hat(flach)) return flach;
  for (const [muster, ersatz] of FAMILIE) {
    if (muster.test(rein) && hat(ersatz)) return ersatz;
  }
  // Obergruppe: text-x-generic, audio-x-generic, image-x-generic, video-x-generic.
  // Fuer "application" gibt es bewusst KEINEN solchen Rueckfall — dort waere
  // die Aussage "irgendeine Datei", und das sagt das Fragezeichen ehrlicher.
  const gruppe = rein.split("/")[0];
  if (hat(`${gruppe}-x-generic`)) return `${gruppe}-x-generic`;
  return null;
}

// Icon-Name zu einem Dateinamen, ODER null wenn der Satz nichts hergibt.
// Rueckgabe ist der Name OHNE ".svg" und mit "mimetypes/"-Praefix, damit die
// vorhandenen Aufrufstellen (`… + ".svg"`) unveraendert funktionieren.
function iconFor(filename) {
  if (!vorhanden.size) return null;
  const ext = (String(filename).split(".").pop() || "").toLowerCase();
  if (!ext) return null;
  if (EXTRA[ext] && hat(EXTRA[ext])) return PREFIX + EXTRA[ext];
  const name = fuerMime(mime.lookup(`x.${ext}`));
  return name ? PREFIX + name : null;
}

module.exports = { iconFor, anzahl: () => vorhanden.size };
