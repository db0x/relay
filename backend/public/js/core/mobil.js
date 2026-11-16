// Schmaler Schirm — die EINE Stelle, an der Relay das entscheidet.
//
// Der Umbruchpunkt steht ZWEIMAL: hier und als @media-Abfrage im Abschnitt
// MOBIL am Ende von css/index.css. Das ist Absicht, kein Versehen — CSS kennt
// keine selbst benannten Media-Abfragen, und die Oberflaeche soll auch dann
// schmal werden, wenn das Javascript nicht laeuft. Wer dreht, dreht an
// BEIDEN; dasselbe Paar-Verhaeltnis wie bei --desk-bg und dem kritischen
// Inline-Stil in views/partials/head.ejs.
//
// Warum die BREITE und nicht der Zeigertyp:
//   * Ein schmal gezogenes Fenster am Rechner soll dasselbe bekommen — nur
//     so laesst sich der Mobilmodus ueberhaupt bequem pruefen.
//   * (pointer:coarse) trifft Touch-Notebooks mit, die reichlich Platz haben,
//     und verfehlt umgekehrt jedes Telefon, an dem eine Maus haengt.
//   * Platz ist das, was die Entscheidung wirklich erzwingt: zwei frei
//     verschiebbare Fenster nebeneinander gehen auf 390px nicht, unabhaengig
//     davon, womit gezeigt wird.
export var MOBIL_Q = "(max-width: 760px)";

var mq = window.matchMedia(MOBIL_Q);

export function istMobil() { return mq.matches; }

// Ruft fn NUR beim Wechsel schmal <-> breit auf, nicht bei jedem Pixel einer
// Groessenaenderung. Auf dem Telefon feuert ein `resize` auch, wenn die
// Bildschirmtastatur auffaehrt — das ist kein Wechsel der Betriebsart.
export function beiMobilWechsel(fn) {
  mq.addEventListener("change", fn);
}
