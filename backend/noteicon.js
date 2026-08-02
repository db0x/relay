// Das <symbol id="note-ico"> fuer die einfaerbbaren Notiz-Icons — ERZEUGT aus
// public/img/note.svg, nicht von Hand gepflegt.
//
// WARUM ueberhaupt zwei Darstellungen? Ein <img src="note.svg"> laesst sich
// nicht je Instanz einfaerben: sein Inhalt ist ein eigenes Dokument, das CSS
// der Seite erreicht es nicht. Einfaerben geht nur ueber ein inline <symbol>
// plus <use> — Custom Properties erben in dessen Schatten-Baum hinein.
//
// Frueher war dieses <symbol> eine handgepflegte Kopie der Datei. Folge: wer
// note.svg aenderte, sah die Aenderung nur an den <img>-Stellen (Kachel "Neue
// Notiz"), waehrend Desktop-Icons, Board-Karten und Liste die alte Zeichnung
// behielten. Genau das ist passiert. Jetzt wird das Symbol aus der Datei
// gebaut; eine Aenderung wirkt ueberall.
//
// Umgefaerbt werden nur die beiden Flaechen der Notiz (Koerper und
// umgeknickte Ecke) — an ihrer Farbe erkannt. Alles Weitere (z.B. ein Glyph
// darauf) wird unveraendert uebernommen.
const fs = require("fs");
const path = require("path");

const SVG = path.join(__dirname, "public", "img", "note.svg");

// Die Farben, die note.svg fuer Koerper und Ecke benutzt. Sie sind zugleich
// die Standardwerte im Symbol: ohne gesetzte Variable sieht das Icon aus wie
// die Datei. Aendert jemand die Farben IN der Datei, gehoeren sie hierher.
const BODY = "#fab9ff";
const FOLD = "#ff7afe";

let cache = null; // { mtimeMs, markup }

// fill:#xxxxxx (im style-Attribut) und fill="#xxxxxx" gleichermassen ersetzen
function themeFill(svg, farbe, variable) {
  const hex = farbe.replace("#", "");
  const re = new RegExp(`(fill\\s*[:=]\\s*"?)#${hex}`, "gi");
  return svg.replace(re, `$1var(${variable},${farbe})`);
}

function build() {
  let svg = fs.readFileSync(SVG, "utf8");

  // Inhalt zwischen <svg …> und </svg>; Inkscape-Beiwerk (defs, namedview,
  // XML-Deklaration) faellt dabei weg — im Symbol stoert es nur.
  const auf = svg.indexOf(">", svg.indexOf("<svg"));
  const zu = svg.lastIndexOf("</svg>");
  let inhalt = svg.slice(auf + 1, zu);
  inhalt = inhalt
    .replace(/<defs[\s\S]*?<\/defs>/gi, "")
    .replace(/<defs[^>]*\/>/gi, "")
    .replace(/<sodipodi:namedview[\s\S]*?\/>/gi, "")
    .replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/gi, "")
    .trim();

  inhalt = themeFill(inhalt, BODY, "--note-body");
  inhalt = themeFill(inhalt, FOLD, "--note-fold");

  // viewBox aus width/height der Datei (note.svg ist 64x64 und zeichnet
  // direkt in diesem Raster — kein Umrechnen noetig)
  const b = (n) => {
    const m = svg.match(new RegExp(`${n}\\s*=\\s*"(\\d+(?:\\.\\d+)?)"`));
    return m ? m[1] : "64";
  };
  return `<svg class="svg-sprite" width="0" height="0" aria-hidden="true" focusable="false">`
    + `<symbol id="note-ico" viewBox="0 0 ${b("width")} ${b("height")}">${inhalt}</symbol>`
    + `</svg>`;
}

// Nach mtime gecacht: im Betrieb wird nicht bei jedem Seitenaufbau gelesen,
// beim Basteln an der Datei genuegt trotzdem ein Neuladen.
function symbolMarkup() {
  const st = fs.statSync(SVG);
  if (!cache || cache.mtimeMs !== st.mtimeMs) {
    cache = { mtimeMs: st.mtimeMs, markup: build() };
  }
  return cache.markup;
}

module.exports = { symbolMarkup };
