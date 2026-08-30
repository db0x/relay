// Das Netz einer Notiz: welche anderen Notizen haengen mit ihr zusammen?
//
// Dritter Modus der Lese-Ansicht (neben Text und Bearbeiten). Gezeigt wird ein
// EGO-NETZ mit genau einem Sprung: die Notiz in der Mitte, links die, die auf
// sie verweisen, rechts die, auf die sie verweist. Richtung durch LAGE statt
// durch Pfeilspitzen — das liest sich auf kleinem Raum schneller.
//
// Tiefer geht es durch Klicken: der angeklickte Knoten wird zur neuen Mitte
// (die Notiz wird dabei wirklich geoeffnet, siehe note-dialog.js). So wandert
// man durch das Geflecht, statt es nur anzuschauen.
//
// Kanten als SVG, Knoten als echte <button> darueber. Absichtlich gemischt:
// Text-Kuerzung, Hover-Vorschau, Fokus und Tastaturbedienung gibt es in HTML
// geschenkt, in SVG waeren sie Handarbeit.
import { paintNoteIcon } from "./color.js";
import { personAvatar } from "./summary.js";

var KNOTEN_B = 132;  // Breite eines Knotens (muss zur CSS-Breite passen)
// Nominalhoehe NUR fuer die Abstandsrechnung — die echte Hoehe waechst mit
// dem Inhalt (fremde Notizen tragen eine zweite Zeile mit dem Besitzer).
// Darum der groessere Wert: er muss den schlimmsten Fall abdecken, sonst
// ruecken zwei Knoten bei knapper Hoehe ineinander.
var KNOTEN_H = 82;
var RAND = 10;
// Oben rechts schweben die Aktionen der Lese-Ansicht (loeschen/Netz/PDF/
// bearbeiten) ueber dem Panel — so viel Platz bleibt darum oben frei.
var OBEN = 46;
var LUFT = 14;       // Mindestabstand zwischen zwei Knoten derselben Spalte

// config: { baseUrl, wurzel, openNote, noteTip, hideNoteTip, aufMitte }
//   openNote(owner, rel, label)  oeffnet die Notiz (und zeichnet neu)
//   aufMitte()                   Klick auf die Mitte -> zurueck zum Text
// Rueckgabe: { zeichne, leere }
export function initNetz(config) {
  var wurzel = config.wurzel;
  if (!wurzel) return { zeichne: function () {}, leere: function () {} };
  var kanten = wurzel.querySelector(".netz-kanten");
  var lage = wurzel.querySelector(".netz-knoten-lage");
  var leerText = wurzel.querySelector(".netz-leer");
  var daten = null;   // letzte Antwort, fuer das Neuzeichnen beim Skalieren
  var token = 0;

  function leere() {
    token++;
    daten = null;
    lage.innerHTML = "";
    kanten.innerHTML = "";
    leerText.hidden = true;
  }

  // --- ein Knoten ---------------------------------------------------------

  function knotenEl(n, rolle) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "netz-knoten netz-" + rolle;
    // Der Bearbeitungsstand faerbt hier BEWUSST nichts ein: im Netz geht es um
    // die Verbindungen, und gedaempfte Knoten lasen sich wie "weniger wichtig".
    // Auf dem Desktop und im Board bleibt die Daempfung — dort ist der Stand
    // der Gegenstand der Ansicht. (n.status kommt weiter mit.)
    if (n.fremd) b.classList.add("netz-fremd");
    if (n.beide) b.classList.add("netz-beide");

    var ico = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ico.setAttribute("class", "note-ico netz-ico");
    ico.setAttribute("width", "28");
    ico.setAttribute("height", "28");
    ico.setAttribute("aria-hidden", "true");
    ico.setAttribute("focusable", "false");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#note-ico");
    ico.appendChild(use);
    b.appendChild(ico);
    // dieselbe Faerbung wie Desktop-Icons und Board-Karten
    paintNoteIcon(ico, n.color || "");
    if (n.dark) ico.classList.add("note-dark");

    var t = document.createElement("span");
    t.className = "netz-label";
    t.textContent = n.label;
    b.appendChild(t);
    // Wem gehoert sie? Nur bei fremden — bei eigenen waere es Rauschen.
    // Mit Bild, wie ueberall sonst auch (Personen-Chips, Freigabe-Kaertchen).
    if (n.fremd) {
      var v = document.createElement("span");
      v.className = "netz-von";
      v.appendChild(personAvatar(
        { username: n.owner, name: n.von, hasAvatar: n.hatBild }, 16, config.baseUrl));
      var name = document.createElement("span");
      name.className = "netz-von-name";
      name.textContent = n.von;
      v.appendChild(name);
      b.appendChild(v);
    }
    b.title = n.label + (n.fremd ? " · von " + n.von : "");
    return b;
  }

  // Ein Ziel, das es nicht (mehr) gibt oder das nicht freigegeben ist. Beide
  // Faelle sehen gleich aus — welcher davon zutrifft, geht den Betrachter
  // nichts an (die Auskunft "diese Notiz existiert" waere schon zu viel).
  function totEl(t) {
    var b = document.createElement("span");
    b.className = "netz-knoten netz-raus netz-tot";
    b.innerHTML = '<span class="netz-tot-mark" aria-hidden="true">?</span>';
    var s = document.createElement("span");
    s.className = "netz-label";
    s.textContent = t.label;
    b.appendChild(s);
    b.title = t.label + " · Ziel nicht erreichbar";
    return b;
  }

  // --- zeichnen -----------------------------------------------------------

  function platziere() {
    if (!daten) return;
    var w = wurzel.clientWidth, sicht = wurzel.clientHeight;
    if (!w || !sicht) return;
    lage.innerHTML = "";
    kanten.innerHTML = "";

    var links = daten.rein;
    var rechts = daten.raus.concat(daten.tot);
    // Auch ohne Nachbarn steht die Notiz da — sie ist der Gegenstand der
    // Ansicht. Nur der Hinweis kommt dazu (und rueckt unter die Mitte).
    var allein = !links.length && !rechts.length;
    leerText.hidden = !allein;
    if (allein) {
      leerText.textContent = "Diese Notiz ist mit keiner anderen verbunden. "
        + "Mit @ im Text lassen sich Verweise setzen.";
    }

    // Reicht die Hoehe nicht fuer alle Knoten einer Spalte, waechst die Flaeche
    // und der Behaelter rollt — lieber scrollen als uebereinanderlegen.
    var meisten = Math.max(links.length, rechts.length);
    var noetig = OBEN + meisten * (KNOTEN_H + LUFT) + RAND;
    var h = Math.max(sicht, noetig);
    lage.style.height = h + "px";
    kanten.style.height = h + "px";
    kanten.setAttribute("viewBox", "0 0 " + w + " " + h);

    var mx = w / 2, my = OBEN + (h - OBEN) / 2;
    // Spalten so weit aussen wie moeglich, aber vollstaendig im Bild
    var lx = Math.max(RAND + KNOTEN_B / 2, w * 0.17);
    var rx = Math.min(w - RAND - KNOTEN_B / 2, w * 0.83);

    var gesetzt = [];
    function spalte(liste, x, rolle) {
      liste.forEach(function (n, i) {
        // gleichmaessig verteilen; bei vielen Knoten reicht die Hoehe nicht
        // mehr — dann rueckt der Behaelter ins Scrollen (CSS min-height)
        var y = OBEN + (h - OBEN) * (i + 1) / (liste.length + 1);
        var el = n.tot ? totEl(n) : knotenEl(n, rolle);
        // Mittelpunkt setzen, das Zentrieren macht das CSS (translate -50%).
        // Mit einer festen Hoehe zu rechnen ging schief, sobald ein Knoten zwei
        // Zeilen trug: der Inhalt stand dann unten heraus.
        el.style.left = Math.round(x) + "px";
        el.style.top = Math.round(y) + "px";
        lage.appendChild(el);
        gesetzt.push({ n: n, el: el, x: x, y: y, rolle: rolle });
      });
    }
    daten.tot.forEach(function (t) { t.tot = true; });
    spalte(links, lx, "rein");
    spalte(rechts, rx, "raus");

    // Mitte zuletzt: sie liegt ueber den Kanten
    var m = knotenEl(daten.mitte, "mitte");
    m.classList.add("netz-mitte");
    m.style.left = Math.round(mx) + "px";
    m.style.top = Math.round(my) + "px";
    m.title = daten.mitte.label + " · zurück zum Text";
    m.addEventListener("click", function () { if (config.aufMitte) config.aufMitte(); });
    lage.appendChild(m);

    // Kanten: von der Kante der Mitte zur Kante des Knotens, als Bogen
    var svgns = "http://www.w3.org/2000/svg";
    gesetzt.forEach(function (g) {
      var nachRechts = g.rolle === "raus";
      var x1 = mx + (nachRechts ? KNOTEN_B / 2 : -KNOTEN_B / 2);
      var x2 = g.x + (nachRechts ? -KNOTEN_B / 2 : KNOTEN_B / 2);
      var pfad = document.createElementNS(svgns, "path");
      var cx = (x1 + x2) / 2;
      pfad.setAttribute("d", "M" + x1 + " " + my + " C" + cx + " " + my
        + " " + cx + " " + g.y + " " + x2 + " " + g.y);
      pfad.setAttribute("class", "netz-kante netz-kante-" + g.rolle
        + (g.n.beide ? " netz-kante-beide" : "") + (g.n.tot ? " netz-kante-tot" : ""));
      kanten.appendChild(pfad);
    });

    // Bedienung erst jetzt binden — die Elemente stehen
    gesetzt.forEach(function (g) {
      if (g.n.tot) return;
      g.el.addEventListener("click", function () {
        if (config.hideNoteTip) config.hideNoteTip();
        config.openNote(g.n.owner, g.n.rel, g.n.label);
      });
      if (config.noteTip) {
        g.el.addEventListener("mouseenter", function () {
          config.noteTip(g.el, g.n.owner, g.n.rel);
        });
        g.el.addEventListener("mouseleave", function () {
          if (config.hideNoteTip) config.hideNoteTip();
        });
      }
    });
  }

  function zeichne(owner, rel) {
    var meins = ++token;
    var pfad = encodeURIComponent(owner) + "/" +
      rel.split("/").map(encodeURIComponent).join("/");
    fetch(config.baseUrl + "/notes/netz/" + pfad, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (meins !== token) return;
        daten = d;
        platziere();
      })
      .catch(function () {
        if (meins !== token) return;
        daten = null;
        lage.innerHTML = ""; kanten.innerHTML = "";
        leerText.hidden = false;
        leerText.textContent = "Das Netz konnte nicht geladen werden.";
      });
  }

  // Der Dialog ist skalierbar — bei jeder Groessenaenderung neu anordnen.
  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (!wurzel.hidden) platziere(); }).observe(wurzel);
  }

  return { zeichne: zeichne, leere: leere };
}
