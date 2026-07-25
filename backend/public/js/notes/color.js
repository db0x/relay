// Notiz-Farbe: Feld ist frei tippbar -> nur '#rrggbb' zaehlt; die Standardfarbe
// selbst wird als "" gefuehrt (gleiche Regel wie noteColor() im Backend).
export var NOTE_COLOR_DEFAULT = "#fab9ff";

export function noteColorValue(input) {
  var v = (input.value || "").trim().toLowerCase();
  return (/^#[0-9a-f]{6}$/.test(v) && v !== NOTE_COLOR_DEFAULT) ? v : "";
}

// Ist die Farbe dunkel? Dann muss die umgeknickte Ecke des Icons AUFGEHELLT
// werden statt abgedunkelt (sonst ist sie auf dunkler Flaeche unsichtbar).
// Mass ist die wahrgenommene Helligkeit (OKLCH-L), nicht der RGB-Mittelwert.
// ACHTUNG: Zwilling im Backend — isDark() in notemeta.js, gleiche Schwelle.
export function isDarkNoteColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return false;
  var chan = function (i) {
    var c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  var r = chan(1), g = chan(3), b = chan(5);
  var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s < 0.62;
}

// --note-color am Icon setzen bzw. entfernen; ohne Farbe greifen die
// Standardwerte aus dem <symbol>. Auch fuer die Desktop-Icons nutzbar.
export function paintNoteIcon(el, hex) {
  if (!el) return;
  el.classList.toggle("note-colored", !!hex);
  el.classList.toggle("note-dark", isDarkNoteColor(hex));
  if (hex) el.style.setProperty("--note-color", hex);
  else el.style.removeProperty("--note-color");
}

// Coloris-Farbwaehler an `input` binden; ruft onChange(hex) bei jeder Aenderung
// (hex ist bereits normalisiert wie noteColorValue()).
export function initNoteColorPicker(input, onChange) {
  if (window.Coloris) {
    Coloris({
      el: "#" + input.id,
      // Der Notiz-Dialog ist modal: im Top-Layer ist nur sein eigener
      // Teilbaum bedienbar. Der Waehler muss deshalb IN den Dialog, sonst
      // laege er unsichtbar/blockiert dahinter.
      parent: "#dlg-note",
      theme: "polaroid", themeMode: "light", margin: 6,
      format: "hex", alpha: false, focusInput: false,
      // ohne eigene Farbe steht der Waehler auf der Standardfarbe (nicht auf
      // Schwarz) — von dort aus greift man am ehesten daneben
      defaultColor: NOTE_COLOR_DEFAULT,
      clearButton: true, clearLabel: "Standard",
      // Voreinstellung im gleichen Pastellregister wie das Original-Pink,
      // damit die Icons auf dem Desktop zusammen ruhig bleiben
      swatches: ["#fab9ff", "#ffd666", "#8fd694", "#8fbcff",
        "#ff9a8f", "#7fd8d0", "#c3a6ff", "#c9ced6"],
    });
  }
  input.addEventListener("input", function () { onChange(); });
}
