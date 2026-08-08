// Pfad-Praefix der Instanz (BASE_PATH): "" oder z.B. "/relay", wenn Relay
// hinter einem Reverse Proxy unter einem Unterpfad laeuft. Alle Module bauen
// ihre URLs damit — abgeleitet aus dem Logo-Link, der immer da ist und
// serverseitig schon das Praefix traegt.
var brand = document.querySelector("a.brand");
export var BASE_URL = brand
  ? new URL(brand.getAttribute("href"), location.href).pathname.replace(/\/+$/, "")
  : "";

// Nachweis gegen faelschende Fremdseiten: steht als <meta> im Kopf (csrf.js).
// Jeder aendernde fetch-Aufruf schickt ihn mit -- ohne ihn antwortet der
// Server mit 403.
export function csrfToken() {
  var m = document.querySelector('meta[name="csrf-token"]');
  return m ? m.getAttribute("content") : "";
}

// Kopfzeilen fuer einen aendernden fetch-Aufruf, inkl. Nachweis.
export function schreibKopf(weitere) {
  return Object.assign({ "X-CSRF-Token": csrfToken() }, weitere || {});
}
