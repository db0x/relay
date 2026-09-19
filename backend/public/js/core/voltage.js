// Laeuft Relay gerade in der Voltage-Runtime (unserem AppImage) statt in einem
// Browser-Tab?
//
// Der Unterschied ist keine Spielerei: Relay bringt einen eigenen, in der Seite
// gezeichneten Fenstermanager mit (core/window.js) — Dateiliste, Board, Chat und
// der Editor sind verschiebbare Pseudo-Fenster. In einem Browser-Tab ist das die
// richtige Antwort, denn dort gibt es nichts anderes. In der App dagegen ist es
// die Nachbildung von etwas, das der Rechner schon hat: echte Fenster, mit
// Taskleiste, Alt-Tab und eigenen Bildschirmen.
//
// Voltage meldet sich deshalb der Seite. Das Merkmal kommt aus dem Preload und
// steht schon VOR dem ersten Skript bereit (additionalArguments) — es muss also
// nichts abgewartet oder gepollt werden. In jedem normalen Browser ist
// window.voltage schlicht nicht da und alles hier faellt auf "nein" zurueck.
//
// Bewusst KEINE Erkennung ueber den User-Agent: der wandert in Protokolle, in
// Analysen und in fremde Haende, und eine Kennung dort waere eine Aussage ueber
// den Nutzer. Ein Merkmal im Fenster-Objekt sieht nur die eigene Seite.

// Das Brueckenobjekt oder null. Nie zwischenspeichern: es ist ein Objekt aus dem
// Preload, kein Zustand von uns.
function bruecke() {
  var v = (typeof window !== "undefined") ? window.voltage : null;
  return (v && typeof v.openDocumentWindow === "function") ? v : null;
}

// Laeuft die Seite in der Voltage-Runtime?
export function imVoltage() {
  return !!bruecke();
}

// Dokument in einem EIGENEN Fenster der Runtime oeffnen (eine zweite Instanz des
// AppImage, angemeldet ueber dasselbe Profil).
//
// Liefert ein Promise auf true, wenn die Runtime wirklich etwas gestartet hat.
// Bei false muss der Aufrufer seinen gewohnten Weg gehen — das ist kein
// Ausnahmefall, sondern der Normalfall ausserhalb der App und bei einem
// Entwicklungsstart ohne AppImage. Ein Fehler in der Bruecke zaehlt genauso als
// "nicht gestartet": ein Klick darf nie ins Leere laufen.
export function oeffneEigenesFenster(url) {
  var v = bruecke();
  if (!v) return Promise.resolve(false);
  try {
    // IMMER absolut. Die Runtime prueft die Adresse gegen die Basis ihrer App und weist alles ab,
    // was nicht darunter liegt — ein blosser Pfad faellt dabei durch. Unsere Aufrufer sind sich
    // darin nicht einig: ein Klick liefert a.href (absolut), der Weg ueber ?open= baut die Adresse
    // aus BASE_URL zusammen, und das ist nur ein PFAD. Genau daran scheiterte eine frisch
    // angelegte Datei: sie landete wieder im gezeichneten Fenster. Die Umrechnung gehoert hierher,
    // an die eine Stelle, die mit der Runtime spricht.
    var absolut = new URL(url, location.href).href;
    return Promise.resolve(v.openDocumentWindow(absolut)).then(
      function (ok) { return ok === true; },
      function () { return false; }
    );
  } catch (e) {
    return Promise.resolve(false);
  }
}
