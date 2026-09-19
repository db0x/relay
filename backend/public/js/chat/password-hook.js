// Passwort aendern (Konto-Dialog): den Chat-Schluessel mitnehmen.
//
// Dieselbe Aufgabe wie setpw-key.js, nur der bequemere Fall: hier stehen
// ALTES und NEUES Passwort im selben Formular — der alte Hauptschluessel
// laesst sich also direkt ableiten, nichts muss zwischengelagert werden.
//
// Das Markup des Konto-Dialogs bleibt dabei unangetastet: die versteckten
// Felder haengt dieses Modul selbst an. Der Server nimmt die neue Huelle erst
// an, NACHDEM das Passwort wirklich geaendert wurde (routes/auth.js) — bei
// falschem aktuellen Passwort bleibt die alte stehen und passt weiter.
import { BASE_URL } from "../core/base.js";
import {
  hauptschluessel, oeffneHuelle, umhuelle, importierePrivat,
  merkeSchluessel, KDF_AKTUELL,
} from "./crypto.js";

export function initChatPasswordHook(me) {
  var form = document.getElementById("pw-form");
  if (!form || !me || !window.crypto || !crypto.subtle) return;

  var laeuft = false;
  form.addEventListener("submit", function (e) {
    if (laeuft) return;
    var alt = form.old.value || "", neu = form.new1.value || "";
    // Stimmen die Eingaben nicht, soll der Server antworten (er kennt die
    // Meldungen und markiert das richtige Feld) — hier nichts vorwegnehmen.
    if (!alt || !neu || neu !== (form.new2.value || "")) return;
    e.preventDefault();
    laeuft = true;
    var knopf = form.querySelector("button");
    if (knopf) knopf.disabled = true;
    mitnehmen(form, me, alt, neu)
      .catch(function () { /* dann eben ohne — der Chat merkt es und fragt nach */ })
      .then(function () {
        if (knopf) knopf.disabled = false;
        form.submit();
      });
  });
}

async function mitnehmen(form, me, altesPw, neuesPw) {
  var antwort = await fetch(BASE_URL + "/chat/keys/me", { credentials: "same-origin" });
  if (!antwort.ok) return;
  var bund = await antwort.json();
  if (!bund.hasKeys) return;                  // noch kein Chat eingerichtet

  var mkAlt = await hauptschluessel(me, altesPw, bund.kdf);
  var pkcs8 = await oeffneHuelle(bund.priv, mkAlt);   // wirft bei falschem Passwort
  var mkNeu = await hauptschluessel(me, neuesPw);
  var huelle = await umhuelle(pkcs8, mkNeu);
  setzeFeld(form, "chat_priv_iv", huelle.iv);
  setzeFeld(form, "chat_priv_ct", huelle.ct);
  setzeFeld(form, "chat_kdf", JSON.stringify(KDF_AKTUELL));

  // Der private Schluessel selbst bleibt derselbe — die Zwischenablage im
  // Browser wird nur aufgefrischt, damit die Seite nach dem Neuladen
  // (das Formular leitet um) sofort wieder entsperrt ist.
  await merkeSchluessel(me, await importierePrivat(pkcs8), bund.pubJwk);
}

function setzeFeld(form, name, wert) {
  var f = form.querySelector('input[name="' + name + '"]');
  if (!f) {
    f = document.createElement("input");
    f.type = "hidden"; f.name = name;
    form.appendChild(f);
  }
  f.value = wert;
}
