// Anmeldeseite: den Chat-Hauptschluessel aus dem eingegebenen Passwort
// ableiten und fuer die Startseite hinterlegen (crypto.js: merkePending).
//
// WARUM hier: der Server bekommt das Passwort nur zum Pruefen (bcrypt) und
// darf den Chat-Schluessel nicht kennen. Der einzige Ort, an dem das Passwort
// im Browser vorliegt, ist dieses Formular — also entsteht der Schluessel
// genau hier. Weitergereicht wird er als nicht auslesbarer CryptoKey, nicht
// das Passwort.
//
// Schlaegt hier irgendetwas fehl, wird trotzdem angemeldet: der Chat fragt
// dann auf der Startseite nach dem Passwort. Die Anmeldung darf an einer
// Nebensache nie scheitern.
import { hauptschluessel, merkePending } from "./crypto.js";

var form = document.getElementById("login-form");
// crypto.subtle gibt es nur auf einer sicheren Herkunft (https oder
// localhost). Im unverschluesselten LAN-Betrieb fehlt es — dann bleibt der
// Chat aus, die Anmeldung laeuft unveraendert weiter.
if (form && window.crypto && crypto.subtle) {
  var laeuft = false;
  form.addEventListener("submit", function (e) {
    if (laeuft) return;               // zweiter Durchlauf: jetzt wirklich senden
    var name = (form.username.value || "").trim();
    var pw = form.password.value || "";
    if (!name || !pw) return;         // leeres Formular: der Server meckert
    e.preventDefault();
    laeuft = true;
    var knopf = form.querySelector("button");
    if (knopf) knopf.disabled = true;
    hauptschluessel(name, pw)
      .then(function (mk) { return merkePending(name, mk); })
      .catch(function () { /* ohne Schluessel eben ohne Chat */ })
      .then(function () {
        if (knopf) knopf.disabled = false;
        form.submit();
      });
  });
}
