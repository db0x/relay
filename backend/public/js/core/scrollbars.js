// Eigene Bildlaufleisten (OverlayScrollbars, public/vendor/) statt der nativen.
//
// WARUM: Auf vielen Systemen zeichnet der Browser Overlay-Leisten — sie
// belegen keinen Platz und blenden nach kurzer Zeit aus. In einem Fenster mit
// langer Dateiliste war dadurch gar nicht mehr zu erkennen, dass es weitergeht
// (gemessen: scrollHeight 1387 gegen clientHeight 609, Leistenbreite 0 px).
// Reine CSS-Wege (scrollbar-width/-color, ::-webkit-scrollbar) haengen an
// Browser und Betriebssystem und liessen sich nicht verlaesslich pruefen —
// diese Leisten sehen ueberall gleich aus und sind testbar.
//
// Die Bibliothek kommt als klassisches <script> (views/partials/head.ejs) und
// legt sich global ab, genau wie marked/DOMPurify. Fehlt sie, tut hier alles
// nichts und die nativen Leisten bleiben: die Anwendung laeuft weiter.

// autoHide "leave": die Leiste erscheint, sobald der Zeiger im Bereich ist,
// und geht kurz nach dem Verlassen wieder. Das ist ein VERSUCH — davor stand
// hier "never", weil die nativen Leisten ausblendeten und man einer langen
// Liste darum nicht ansah, dass sie weitergeht. Der Unterschied zu frueher:
// unsere Leiste ist beim Hineinfahren sofort und deutlich da, die native war
// auf vielen Systemen 0px breit. Faellt das Erkennen dennoch schwer, ist
// "never" der Weg zurueck — es ist genau dieses eine Wort.
// autoHideDelay: Nachlauf in ms, bevor sie nach dem Verlassen verschwindet.
// clickScroll: Klick in die Bahn springt seitenweise.
var OPTIONS = {
  scrollbars: { autoHide: "leave", autoHideDelay: 700, clickScroll: true },
};

// GRUNDREGEL — bitte beim Erweitern beachten:
// OverlayScrollbars baut seine Huelle IN das Element hinein und setzt es per
// CSS auf `display:flex; flex-direction:row !important` (der Behaelter hat
// normalerweise genau EIN Kind, den Viewport). Wer den Inhalt eines solchen
// Behaelters danach ersetzt (`innerHTML =`, `textContent =`), reisst diese
// Huelle heraus — die Absaetze werden dann selbst zu Flex-Kindern und stehen
// NEBENEINANDER statt untereinander. Genau so ist die Notiz-Vorschau einmal
// dreispaltig geworden.
// Also: der Behaelter mit der Leiste und das Element, das die Anwendung
// befuellt, duerfen NIE dasselbe sein. Beispiele: #note-preview traegt die
// Leiste, geschrieben wird in #note-preview-body; .backup-log traegt sie, der
// Text steht im <code> darin.
//
// Die uebrigen Scrollflaechen neben den Fenstern (die versorgt createWindow).
// Bewusst NICHT dabei:
//   - Codebloecke in gerendertem Markdown: entstehen bei jedem Tastendruck neu
//   - .chips-dropdown (Personen-Vorschlaege): wird erst bei Bedarf erzeugt und
//     bei jedem Tastendruck neu befuellt — 190px hoch, der Aufwand lohnt nicht
//   - .mention-list (@-Verlinkung im Notiz-Editor): derselbe Fall, hoechstens
//     zwoelf Treffer, und Pfeiltasten holen den markierten ohnehin ins Bild
var AREAS = [
  ".page-body",         // rollender Rumpf eines Fensters (Kopf/Fuss bleiben stehen)
  ".notif-panel",       // Nachrichten-Menue
  ".app-search-scroll", // Trefferliste der Suche (Inhalt sitzt in der <ul> darin)
  ".note-preview", // Vorschau im Notiz-Editor (Inhalt in #note-preview-body)
  ".emoji-panel",  // Emoji-Auswahl
  ".backup-log",   // rsync-Ausgabe im Backup-Dialog (Text im <code> darin)
  ".lang-scroll",  // Sprachauswahl in den Einstellungen (Liste liegt darin)
].join(",");

function lib() {
  var g = window.OverlayScrollbarsGlobal;
  return g ? g.OverlayScrollbars : null;
}

// Vorhandene Instanz eines Elements (oder null). Mit nur einem Argument
// arbeitet OverlayScrollbars als Getter.
export function scrollbarOf(el) {
  var OS = lib();
  if (!OS || !el) return null;
  return OS(el) || null;
}

// Letzte bekannte Zeigerposition. Gebraucht fuer den Fall direkt darunter —
// es gibt keine Abfrage "steht der Zeiger gerade ueber diesem Element?".
var zeigerX = -1, zeigerY = -1;
document.addEventListener("pointermove", function (e) {
  zeigerX = e.clientX; zeigerY = e.clientY;
}, { passive: true, capture: true });

// Eine FRISCH aufgebaute Leiste kennt einen stillstehenden Zeiger nicht.
//
// Der Ordner- und der Sortierwechsel ersetzen den Inhalt von #page; die Leiste
// danach ist eine neue Instanz. Liegt der Zeiger dabei still im Fenster,
// bekommt sie kein pointerenter — und bliebe mit autoHide:"leave" unsichtbar,
// bis man die Maus bewegt. Genau da, wo man eben noch gescrollt hat.
// Also: steht der Zeiger schon drin, die Leiste vorerst dauerhaft zeigen und
// erst beim Verlassen auf das normale Ausblenden zurueckschalten.
function zeigeWennZeigerSchonDrin(el, inst) {
  if (zeigerX < 0 || !inst) return;
  var unter = document.elementFromPoint(zeigerX, zeigerY);
  if (!unter || (unter !== el && !el.contains(unter))) return;
  inst.options({ scrollbars: { autoHide: "never" } });
  el.addEventListener("pointerleave", function zurueck() {
    el.removeEventListener("pointerleave", zurueck);
    inst.options({ scrollbars: { autoHide: OPTIONS.scrollbars.autoHide } });
  });
}

// Bildlaufleiste an ein Element haengen. Mehrfachaufrufe sind unschaedlich —
// ist schon eine da, kommt sie unveraendert zurueck.
export function attachScrollbar(el) {
  var OS = lib();
  if (!OS || !el) return null;
  var vorhanden = scrollbarOf(el);
  if (vorhanden) return vorhanden;
  var inst = OS(el, OPTIONS);
  zeigeWennZeigerSchonDrin(el, inst);
  return inst;
}

// WICHTIG vor jedem innerHTML-Tausch: OverlayScrollbars baut seine Huelle IN
// das Element hinein. Wird die einfach ueberschrieben, bleibt eine Instanz
// zurueck, die sich fuer lebendig haelt (state().destroyed === false) und nie
// wieder etwas zeichnet. Darum vorher aufloesen — das Element selbst UND die
// Scrollflaechen darin.
export function detachScrollbars(root) {
  if (!lib() || !root) return;
  var os = scrollbarOf(root);
  if (os) os.destroy();
  root.querySelectorAll(AREAS).forEach(function (el) {
    var inner = scrollbarOf(el);
    if (inner) inner.destroy();
  });
}

// Scrollflaechen INNERHALB von root versorgen. root-skopiert, damit nach einem
// Ordnerwechsel nur die neu eingehaengten Teile drankommen.
export function bindScrollbars(root) {
  if (!lib()) return;
  root.querySelectorAll(AREAS).forEach(attachScrollbar);
}

export function initScrollbars() {
  bindScrollbars(document);
}
