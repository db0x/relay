// Seite "Passwort setzen" (Erstpasswort, must_change): den Chat-Schluessel
// ueber den Passwortwechsel hinwegretten.
//
// Der private Chat-Schluessel liegt umhuellt auf dem Server, und die Huelle
// haengt am Passwort. Wechselt das Passwort, muss die Huelle mitwechseln —
// sonst waere der bisherige Verlauf verloren. Auf-und-zu kann nur der
// Browser: er hat den ALTEN Hauptschluessel von der Anmeldung
// (crypto.js: holePending) und leitet den NEUEN aus dem Formular ab.
//
// Die fertige neue Huelle geht als verstecktes Feld mit dem Formular mit;
// der Server uebernimmt sie erst, wenn der Wechsel wirklich geklappt hat
// (routes/auth.js: chatSchluesselMitnehmen).
//
// Der Normalfall auf DIESER Seite ist ein frischer Zugang ohne Chat-
// Schluessel. Dann gibt es nichts zu retten, und es passiert schlicht nichts —
// die Startseite legt spaeter das erste Schluesselpaar an.
import {
  hauptschluessel, oeffneHuelle, umhuelle, holePending, merkePending, KDF_AKTUELL,
} from "./crypto.js";

var form = document.getElementById("setpw-form");
var me = form && form.dataset.me;
// Pfad-Praefix der Instanz aus der Formular-Adresse (dieselbe Herleitung wie
// core/base.js auf der Startseite, nur gibt es hier kein Logo).
var BASE_URL = form
  ? (form.getAttribute("action") || "").replace(/\/passwort-setzen$/, "")
  : "";

// crypto.subtle gibt es nur auf einer sicheren Herkunft (https oder
// localhost) — im unverschluesselten LAN-Betrieb bleibt der Chat aus, das
// Setzen des Passworts laeuft unveraendert weiter.
if (form && me && window.crypto && crypto.subtle) {
  var laeuft = false;
  form.addEventListener("submit", function (e) {
    if (laeuft) return;                                   // zweiter Durchlauf: senden
    var neu = form.new1.value || "";
    if (!neu || neu !== (form.new2.value || "")) return;  // der Server meckert
    e.preventDefault();
    laeuft = true;
    var knopf = form.querySelector("button");
    if (knopf) knopf.disabled = true;
    umhuellenNeu(neu)
      .catch(function () { /* nicht zu retten -> der Chat richtet sich neu ein */ })
      .then(function () {
        if (knopf) knopf.disabled = false;
        form.submit();
      });
  });
}

async function umhuellenNeu(neuesPasswort) {
  // ZUERST den alten abholen: holePending raeumt den Uebergabeplatz dabei
  // leer, und gleich darauf legen wir den neuen genau dorthin.
  var mkAlt = await holePending(me);
  var mkNeu = await hauptschluessel(me, neuesPasswort);
  await merkePending(me, mkNeu);

  var antwort = await fetch(BASE_URL + "/chat/keys/me", { credentials: "same-origin" });
  if (!antwort.ok) return;
  var bund = await antwort.json();
  if (!bund.hasKeys || !mkAlt) return;   // nichts da bzw. altes Passwort weg

  // wirft, wenn der alte Hauptschluessel nicht passt — dann bleibt es beim
  // Neuanfang, und das ist ehrlicher als eine kaputte Huelle abzuliefern
  var pkcs8 = await oeffneHuelle(bund.priv, mkAlt);
  var huelle = await umhuelle(pkcs8, mkNeu);
  setzeFeld("chat_priv_iv", huelle.iv);
  setzeFeld("chat_priv_ct", huelle.ct);
  setzeFeld("chat_kdf", JSON.stringify(KDF_AKTUELL));
}

function setzeFeld(name, wert) {
  var f = form.querySelector('input[name="' + name + '"]');
  if (!f) {
    f = document.createElement("input");
    f.type = "hidden"; f.name = name;
    form.appendChild(f);
  }
  f.value = wert;
}
