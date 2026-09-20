// Geteilte Bibliothek: ein Ordner, der dem SERVER gehoert (nicht einem
// Nutzer) und den Relay ausschliesslich ANZEIGT. Host-Pfad in der .env
// (SHARED_LIB), im Container unter LIB_DIR nur lesend eingehaengt (:ro in
// docker-compose.yml). Nichts hier schreibt jemals — es gibt keine Route zum
// Anlegen, Verschieben, Umbenennen oder Loeschen.
//
// Freigeschaltet wird je Nutzer und je ORDNER — auf jeder Ebene, nicht nur
// ganz oben. Der Admin kann also "Doku" komplett freigeben und aus "fsk6" nur
// einen einzelnen Unterordner. Ein Recht gilt immer fuer alles darunter.
//
// Zu jedem Recht gehoert ein optionaler ANZEIGENAME (Spalte label): der
// Nutzer sieht "Filme ab 6", im Dateisystem heisst der Ordner "fsk6". Der
// Name gehoert zur Freigabe, nicht zum Ordner — zwei Nutzer koennen denselben
// Ordner also unterschiedlich benannt bekommen.
//
// Was freigeschaltet ist, ist zugleich der EINSTIEG: die Dateiliste zeigt
// genau diese Ordner auf der obersten Ebene. Ein Recht, das schon von einem
// Recht weiter oben abgedeckt ist, wird darum beim Speichern verworfen
// (setFolders) — sonst erschiene derselbe Ordner zweimal.
//
// PFAD-SICHERHEIT: hier greift NICHT secureFilename wie bei den Nutzerdateien.
// Die Namen stammen aus einem fremden Dateisystem und duerfen Umlaute,
// Leerzeichen und Klammern tragen ("Der Pate (1972)") — durch secureFilename
// gedreht fuende man die Datei nie wieder. Stattdessen:
//   1. safeRel wirft alles weg, was ein Pfad-Trick sein koennte ("..", "\",
//      Null-Bytes, leere Segmente),
//   2. absOf loest den Pfad AUF (realpath) und prueft, dass er unterhalb der
//      aufgeloesten Wurzel bleibt — damit fuehrt auch ein Symlink in der
//      Bibliothek nicht aus ihr heraus.
const fs = require("fs");
const path = require("path");

const { db } = require("./db");
const { LIB_DIR, SHARED_LIB, DOCS } = require("./config");

// Wurzel mit aufgeloesten Symlinks, oder null wenn nichts eingehaengt ist.
// Bewusst bei jedem Aufruf frisch: die Einhaengung kann nach einem Neustart
// des Hosts spaeter kommen als der Container.
function root() {
  try { return fs.realpathSync(LIB_DIR); } catch (e) { return null; }
}

// Ist ueberhaupt eine Bibliothek konfiguriert? (fuer den Hinweis im
// Admin-Dialog — ohne SHARED_LIB haengt dort ein leerer Platzhalter)
function configured() {
  return !!SHARED_LIB;
}

function isDir(abs) {
  try { return fs.statSync(abs).isDirectory(); } catch (e) { return false; }
}

// Relativen Pfad auf eine unverfaengliche Form bringen; null = nicht benutzbar.
// "" (die Wurzel selbst) gilt als ungueltig: dorthin bekommt niemand Zugriff,
// freigeschaltet wird immer ein konkreter Ordner.
function safeRel(rel) {
  const out = [];
  for (const seg of String(rel == null ? "" : rel).split("/")) {
    if (seg === "") continue;                       // doppelte Slashes ignorieren
    if (seg === "." || seg === ".." || seg.includes("\0") || seg.includes("\\")) return null;
    out.push(seg);
  }
  return out.length ? out.join("/") : null;
}

// Absoluter, aufgeloester Pfad eines Bibliothekseintrags — oder null, wenn er
// unsicher ist, nicht existiert oder aus der Bibliothek herausfuehrt.
function absOf(rel) {
  const r = root();
  const safe = safeRel(rel);
  if (!r || !safe) return null;
  let real;
  try { real = fs.realpathSync(path.join(r, safe)); } catch (e) { return null; }
  if (real !== r && !real.startsWith(r + path.sep)) return null;
  return real;
}

// Alle Ordner der Bibliothek als BAUM — die Auswahl im Admin-Dialog.
// Rueckgabe in Anzeigereihenfolge (Vorordnung): jeder Ordner steht direkt vor
// seinen Kindern, `tiefe` traegt die Einrueckung, `kinder` sagt, ob sich die
// Zeile aufklappen laesst (die Oberflaeche haengt daran ihren Pfeil), und
// `beschnitten` markiert einen Ordner, dessen Unterordner NICHT in der Liste
// stehen — siehe unten.
//
// Gemerkt wie der Suchindex: der Dialog wird bei JEDEM Seitenaufbau gerendert
// (und der Baum je Nutzer einmal ins HTML geschrieben), ein Durchlauf ueber
// eine Netzfreigabe kostet sonst jedes Mal.
//
// EINGESAMMELT WIRD BREITENWEISE, Ebene fuer Ebene — nicht tiefenzuerst.
// Der Unterschied ist nicht kosmetisch, er war ein handfester Fehler: bei
// einem tiefenzuersten Durchlauf frisst der erste grosse Zweig das ganze
// Zeilenbudget, und alles, was im Alphabet dahinter kommt, verschwindet
// SPURLOS aus der Auswahl — samt ganzer Ordner der obersten Ebene. Genau so
// geschehen (2026-09-20): 378 Ordner unter "movies" verdraengten
// "public/scan", "public/OS-ISOs", "relay", "TV series" und "tschwerdt" aus
// dem Dialog. Kein Admin konnte sie noch freigeben, und nichts wies darauf
// hin. Breitenweise trifft die Grenze immer nur die TIEFSTEN Ordner.
//
// Zwei Dinge stehen ausserdem UNANTASTBAR in der Liste, egal wie voll sie ist:
//   - die gesamte oberste Ebene — das ist die uebliche Einheit einer Freigabe,
//     sie darf nie an der Sammlung eines Nachbarordners scheitern,
//   - jeder Ordner, der IRGENDJEMANDEM freigeschaltet ist (und seine
//     Vorfahren, sonst haengt die Zeile im Baum in der Luft). Sonst faehrt
//     der Fehler eine zweite, schlimmere Ernte ein: was das Formular nicht
//     anzeigt, schickt es nicht mit, und setGrants ersetzt die Rechte
//     KOMPLETT — ein unsichtbares Recht waere beim naechsten Speichern des
//     Dialogs still geloescht worden.
//
// TREE_DEPTH begrenzt zugleich einen Symlink, der innerhalb der Bibliothek
// auf einen seiner Vorfahren zeigt.
const TREE_TTL = 60 * 1000;
// Grosszuegig, aber begrenzt: der Baum landet je Nutzer einmal im HTML der
// Seite, das Budget vervielfacht sich also mit der Zahl der Konten.
const TREE_MAX = 1200;
const TREE_DEPTH = 6;
let treeCache = null;

// Unterordner eines Ordners — sicher (nichts, was aus der Bibliothek
// herausfuehrt) und in Anzeigereihenfolge.
function unterordner(abs, r) {
  let ents = [];
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const e of ents) {
    if (e.name.startsWith(".")) continue;
    let real;
    try { real = fs.realpathSync(path.join(abs, e.name)); } catch (err) { continue; }
    if (real !== r && !real.startsWith(r + path.sep)) continue;   // fuehrt hinaus
    if (isDir(real)) out.push({ name: e.name, abs: real });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
  return out;
}

// Jeder freigeschaltete Ordner und alle seine Vorfahren: "a/b/c" liefert
// "a", "a/b", "a/b/c".
function pflichtOrdner() {
  const pflicht = new Set();
  let reihen = [];
  try {
    reihen = db().prepare("SELECT DISTINCT folder FROM library_access").all();
  } catch (e) { return pflicht; }   // Tabelle gibt es noch nicht (Erstlauf)
  for (const { folder } of reihen) {
    const safe = safeRel(folder);
    if (!safe) continue;
    const teile = safe.split("/");
    for (let i = 1; i <= teile.length; i++) pflicht.add(teile.slice(0, i).join("/"));
  }
  return pflicht;
}

function folderTree() {
  const jetzt = Date.now();
  if (treeCache && jetzt - treeCache.at < TREE_TTL) return treeCache.list;
  const r = root();
  const list = [];
  if (!r) { treeCache = { at: jetzt, list }; return list; }
  const pflicht = pflichtOrdner();

  // --- Ebene fuer Ebene einsammeln ------------------------------------
  const knoten = (o, rel, tiefe) =>
    ({ rel, name: o.name, abs: o.abs, tiefe, kinder: [], beschnitten: false });
  const oben = unterordner(r, r).map((o) => knoten(o, o.name, 0));
  // Die oberste Ebene zaehlt nicht gegen das Budget — sie ist gesetzt.
  let budget = TREE_MAX;
  let ebene = oben;
  let tiefe = 1;
  for (; tiefe < TREE_DEPTH && ebene.length; tiefe++) {
    const naechste = [];
    for (const eltern of ebene) {
      for (const o of unterordner(eltern.abs, r)) {
        const rel = `${eltern.rel}/${o.name}`;
        const muss = pflicht.has(rel);
        if (!muss) {
          if (budget <= 0) { eltern.beschnitten = true; continue; }
          budget--;
        }
        const k = knoten(o, rel, tiefe);
        eltern.kinder.push(k);
        naechste.push(k);
      }
    }
    ebene = naechste;
  }
  // Was allein an TREE_DEPTH gescheitert ist, ebenfalls ehrlich markieren:
  // sonst sieht die unterste Ebene aus wie ein Blatt.
  if (tiefe >= TREE_DEPTH) {
    for (const k of ebene) if (unterordner(k.abs, r).length) k.beschnitten = true;
  }

  // --- flach in Vorordnung ausgeben -----------------------------------
  const flach = (k) => {
    list.push({ rel: k.rel, name: k.name, tiefe: k.tiefe,
                kinder: k.kinder.length > 0, beschnitten: k.beschnitten });
    for (const c of k.kinder) flach(c);
  };
  for (const k of oben) flach(k);
  treeCache = { at: jetzt, list };
  return list;
}

// Inhalt eines Bibliotheksordners: { name, isDir, size, mtime }.
// Der Aufrufer hat das Leserecht vorher geprueft (mayRead).
function entries(rel) {
  const r = root();
  const abs = absOf(rel);
  if (!r || !abs || !isDir(abs)) return [];
  let ents = [];
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const e of ents) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(abs, e.name);
    let real, st;
    try { real = fs.realpathSync(p); st = fs.statSync(real); } catch (err) { continue; }
    // Zeigt ein Symlink aus der Bibliothek heraus, wird er gar nicht erst
    // aufgefuehrt: absOf wuerde ihn spaeter ohnehin abweisen, und ein Eintrag,
    // der beim Anklicken ins Leere fuehrt, ist schlimmer als keiner.
    if (!real.startsWith(r + path.sep)) continue;
    if (!st.isDirectory() && !st.isFile()) continue;
    out.push({ name: e.name, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

// Rekursiver Index eines freigeschalteten Ordners fuer die SUCHE:
// [{ rel, isDir }] mit Pfaden relativ zur Bibliothekswurzel.
//
// Gemerkt und erst nach INDEX_TTL erneuert: die Suche laeuft bei jedem
// Tastendruck, und ein Durchlauf durch eine Filmsammlung auf einer
// Netzfreigabe kostet sonst jedes Mal. Die Bibliothek aendert sich nur, wenn
// jemand am Server etwas ablegt — eine Minute Verzoegerung faellt dabei nicht
// ins Gewicht.
//
// Zwei Deckel: INDEX_MAX gegen eine ausufernde Sammlung und MAX_DEPTH gegen
// einen Symlink, der innerhalb der Bibliothek auf einen seiner Vorfahren
// zeigt — die Wurzelpruefung faengt so eine Schleife nicht ab, sie bleibt ja
// die ganze Zeit unterhalb der Wurzel.
const INDEX_TTL = 60 * 1000;
const INDEX_MAX = 20000;
const MAX_DEPTH = 12;
const indexCache = new Map();

function walkUnder(top) {
  const jetzt = Date.now();
  const gemerkt = indexCache.get(top);
  if (gemerkt && jetzt - gemerkt.at < INDEX_TTL) return gemerkt.list;

  const r = root();
  const start = absOf(top);
  const list = [];
  const stapel = (r && start && isDir(start)) ? [{ abs: start, rel: top, tiefe: 0 }] : [];
  while (stapel.length && list.length < INDEX_MAX) {
    const knoten = stapel.pop();
    if (knoten.tiefe > MAX_DEPTH) continue;
    let ents = [];
    try { ents = fs.readdirSync(knoten.abs, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (list.length >= INDEX_MAX) break;
      if (e.name.startsWith(".")) continue;
      let real, st;
      try {
        real = fs.realpathSync(path.join(knoten.abs, e.name));
        st = fs.statSync(real);
      } catch (err) { continue; }
      if (!real.startsWith(r + path.sep)) continue;   // fuehrt hinaus -> weg
      const rel = `${knoten.rel}/${e.name}`;
      if (st.isDirectory()) {
        list.push({ rel, isDir: true });
        stapel.push({ abs: real, rel, tiefe: knoten.tiefe + 1 });
      } else if (st.isFile()) {
        list.push({ rel, isDir: false });
      }
    }
  }
  indexCache.set(top, { at: jetzt, list });
  return list;
}

// Erscheint die Bibliothek AUCH innerhalb der Nutzerdateien? Rueckgabe der
// Pfad relativ zu DOCS, sonst "".
//
// WARUM DAS HIER STEHT: Die Bibliothek gehoert nicht ins Backup — sie gehoert
// dem Server, wird nur gelesen und ist auf einer ganz anderen Ebene gesichert
// (NAS). Normalerweise kann sie auch gar nicht hineingeraten: sie haengt als
// eigener Mount unter LIB_DIR, voellig ausserhalb von DOCS, und rsync sieht
// sie nie. Auch ein Symlink im Nutzerordner reicht nicht — rsync -a kopiert
// Symlinks als Symlinks, nicht ihr Ziel (nachgemessen).
//
// EIN Fall bleibt: wer SHARED_LIB auf einen Pfad INNERHALB von DOCUMENTS_DIR
// setzt, hat dieselben Dateien an zwei Stellen, und die zweite liegt mitten
// im Nutzerbaum. Fuer rsync ist das ein ganz normaler Ordner — die halbe
// Filmsammlung waere im Backup. Erkennbar ist es an Geraet+Inode: derselbe
// Ordner, zwei Wege dorthin (ein Bind-Mount aendert beides nicht).
//
// Gesucht wird nur ueber ORDNER und nur bis zum ersten Treffer; das ist
// derselbe Aufwand, den die Nutzerverwaltung ohnehin je Seitenaufbau treibt.
function insideDocs() {
  const r = root();
  if (!r) return "";
  let ziel;
  try { ziel = fs.statSync(r); } catch (e) { return ""; }
  const suche = (abs, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return ""; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;                 // Symlinks zaehlen nicht
      const p = path.join(abs, e.name);
      let st;
      try { st = fs.statSync(p); } catch (err) { continue; }
      const kind = rel ? `${rel}/${e.name}` : e.name;
      if (st.dev === ziel.dev && st.ino === ziel.ino) return kind;
      const tiefer = suche(p, kind);
      if (tiefer) return tiefer;
    }
    return "";
  };
  return suche(DOCS, "");
}

// --- Leserechte -------------------------------------------------------
// Welche Ordner darf dieser Nutzer sehen, und wie heissen sie fuer ihn?
// [{ folder, label }] — folder ist der Pfad relativ zur Wurzel, auf beliebiger
// Ebene ("Doku", "fsk6/Konzerte/2024"); label ist der abweichende Anzeigename
// oder null.
function grants(username) {
  return db().prepare("SELECT folder, label FROM library_access WHERE username=? ORDER BY folder")
    .all(username);
}

// nur die Pfade — fuer alles, was mit der Beschriftung nichts zu tun hat
function grantedFolders(username) {
  return grants(username).map((r) => r.folder);
}

// Wie heisst dieser freigeschaltete Ordner fuer den Nutzer? Ohne eigenen
// Namen der Ordnername selbst.
function labelOf(eintrag) {
  return eintrag.label || path.basename(eintrag.folder);
}

// Ein Recht auf "fsk6" schliesst "fsk6/Filme" mit ein. Solche Doppel werden
// verworfen: gespeichert werden nur die WURZELN der Auswahl. Verglichen wird
// mit < auf der Zeichenkette (NICHT localeCompare): nur so steht ein
// Elternteil garantiert vor seinen Kindern, denn "a" ist ein Praefix von
// "a/b". Ein Blick zurueck genuegt dann.
function nurWurzeln(liste) {
  const gesehen = new Set();
  const sortiert = liste
    .filter((e) => (gesehen.has(e.folder) ? false : gesehen.add(e.folder)))
    .sort((a, b) => (a.folder < b.folder ? -1 : (a.folder > b.folder ? 1 : 0)));
  const wurzeln = [];
  for (const e of sortiert) {
    if (wurzeln.some((w) => e.folder.startsWith(w.folder + "/"))) continue;
    wurzeln.push(e);
  }
  return wurzeln;
}

// Anzeigenamen zaehmen: Leerraum weg, gedeckelt, und was am Ende dem
// Ordnernamen entspricht (oder leer ist) wird gar nicht erst gespeichert —
// dann steht in der Spalte NULL und die Anzeige faellt auf das Dateisystem
// zurueck. Zeilenumbrueche fliegen raus, der Name steht in einer Tabellenzeile.
const LABEL_MAX = 80;
function saubererName(text, folder) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return (!t || t === path.basename(folder)) ? null : t;
}

// Rechte eines Nutzers KOMPLETT ersetzen (das Formular schickt immer alle
// angehakten Ordner) — in einer Transaktion, damit nie ein Zwischenstand
// sichtbar wird.
// Rechte eines Nutzers KOMPLETT ersetzen; liste ist [{ folder, label }].
const setGrants = (() => {
  let fn = null;
  return (username, liste) => {
    if (!fn) {
      const loeschen = db().prepare("DELETE FROM library_access WHERE username=?");
      const setzen = db().prepare(
        "INSERT OR IGNORE INTO library_access (username, folder, label) VALUES (?,?,?)");
      fn = db().transaction((user, eintraege) => {
        loeschen.run(user);
        for (const e of eintraege) setzen.run(user, e.folder, saubererName(e.label, e.folder));
      });
    }
    // nurWurzeln: ein Recht, das schon von einem darueberliegenden abgedeckt
    // ist, kommt gar nicht erst in die Datenbank
    fn(username, nurWurzeln(liste));
    // Der gemerkte Ordnerbaum haelt die freigeschalteten Ordner fest in der
    // Liste (folderTree/pflichtOrdner). Aendern sich die Rechte, ist er
    // ueberholt — sonst zeigte der Dialog bis zu einer Minute lang einen
    // Baum, der zu den gerade gespeicherten Rechten nicht mehr passt.
    treeCache = null;
  };
})();

// Welches Recht deckt diesen Pfad ab? Der freigeschaltete Ordner selbst oder
// einer seiner Vorfahren — "" wenn keiner. Wird auch fuer die Brotkrumen
// gebraucht: sie duerfen nicht ueber den Einstieg hinaus nach oben zeigen, da
// kommt der Nutzer ja nicht hin.
function grantFor(username, rel) {
  const safe = safeRel(rel);
  if (!safe) return "";
  // laengstes passendes Recht gewinnt (bei "fsk6" und "fsk6/Filme" waere
  // nach setFolders zwar nur eines uebrig, aber Altbestand kann beides haben)
  return grantedFolders(username)
    .filter((g) => safe === g || safe.startsWith(g + "/"))
    .sort((a, b) => b.length - a.length)[0] || "";
}

// Darf `username` diesen Pfad lesen?
function mayRead(username, rel) {
  return !!grantFor(username, rel);
}

module.exports = {
  configured, root, isDir, safeRel, absOf, folderTree, entries, walkUnder, insideDocs,
  grants, grantedFolders, labelOf, setGrants, grantFor, mayRead,
};
