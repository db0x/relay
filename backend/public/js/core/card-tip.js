// Hover-Kaertchen: platzieren, zeigen, verstecken.
//
// Gemeint sind die groesseren Karten mit echtem Inhalt — die Notiz-Vorschau
// (js/notes/hover-preview.js) und die Datei-Kurzinfo (js/files/file-tip.js).
// Der kleine data-tip-Tooltip ist etwas anderes und lebt in core/tooltips.js.
//
// WICHTIG — warum die Karte umgehaengt wird:
// Ein modaler Dialog liegt in der "top layer" des Browsers und wird UEBER
// allem anderen gezeichnet, unabhaengig von z-index. Eine Karte, die am
// <body> haengt, waere hinter einem offenen Dialog also unsichtbar — genau
// dort, wo sie gebraucht wird (Verweise im Notiztext stehen im Dialog). Also
// wandert sie zu dem Dialog, in dem ihr Anker sitzt.
// Das geht auf, weil ein offener Dialog `transform:none` hat (die
// Oeffnen-Animation ist dann durch): er ist damit kein Bezugsrahmen fuer
// position:fixed, und weder seine Koordinaten noch sein overflow:hidden
// wirken auf die Karte.

var ABSTAND = 6; // Luft zwischen Anker und Karte

export function zeigeKarte(karte, anker) {
  var wirt = anker.closest("dialog") || document.body;
  if (karte.parentNode !== wirt) wirt.appendChild(karte);

  // erst messbar machen, dann messen: unsichtbar hat die Karte zwar Layout,
  // aber ihr Inhalt wurde eben erst gesetzt
  karte.style.left = "0px";
  karte.style.top = "0px";
  var r = anker.getBoundingClientRect();
  var links = Math.max(8, Math.min(r.left, window.innerWidth - karte.offsetWidth - 8));
  var oben = r.bottom + ABSTAND;
  if (oben + karte.offsetHeight > window.innerHeight - 8)
    oben = Math.max(8, r.top - karte.offsetHeight - ABSTAND);
  karte.style.left = links + "px";
  karte.style.top = oben + "px";
  karte.classList.add("open");
}

export function versteckeKarte(karte) {
  if (karte) karte.classList.remove("open");
}
