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

// autoHide "never" ist Absicht und der Kern der Sache: die nativen Leisten
// blendeten aus, und genau deshalb sah man nicht, dass ein Fenster weitergeht.
// Eine Leiste, die man erst durch Hineinfahren hervorholt, loeste das nur zur
// Haelfte. clickScroll: Klick in die Bahn springt seitenweise.
var OPTIONS = {
  scrollbars: { autoHide: "never", clickScroll: true },
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
var AREAS = [
  ".notif-panel",       // Nachrichten-Menue
  ".app-search-scroll", // Trefferliste der Suche (Inhalt sitzt in der <ul> darin)
  ".note-preview", // Vorschau im Notiz-Editor (Inhalt in #note-preview-body)
  ".emoji-panel",  // Emoji-Auswahl
  ".backup-log",   // rsync-Ausgabe im Backup-Dialog (Text im <code> darin)
  ".lang-list",    // Sprachauswahl in den Einstellungen
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

// Bildlaufleiste an ein Element haengen. Mehrfachaufrufe sind unschaedlich —
// ist schon eine da, kommt sie unveraendert zurueck.
export function attachScrollbar(el) {
  var OS = lib();
  if (!OS || !el) return null;
  return scrollbarOf(el) || OS(el, OPTIONS);
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
