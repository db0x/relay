// Konto-Dialog: Passwort-Formular, Anzeigename-/E-Mail-Validierung, Avatar-Upload.
import { openDlg } from "../core/dialogs.js";

export function initAccountDialog() {
  // Passwort-Formular: kam der Redirect mit markiertem Feld zurück (Server-
  // Validierung), Dialog und Abschnitt wieder öffnen und das Feld fokussieren
  var invalidField = document.querySelector("#dlg-account .field-invalid");
  if (invalidField) {
    var accDlg = document.getElementById("dlg-account");
    if (accDlg) openDlg(accDlg);
    invalidField.focus();
  }

  // neue Passwörter live vergleichen: bei Abweichung Feld markieren und
  // Absenden blockieren (setCustomValidity); Tippen löscht die Markierung
  var pwForm = document.getElementById("pw-form");
  if (pwForm) {
    var pwOld = pwForm.querySelector("input[name=old]");
    var pwNew1 = pwForm.querySelector("input[name=new1]");
    var pwNew2 = pwForm.querySelector("input[name=new2]");
    function pwCheck() {
      var mismatch = pwNew2.value !== "" && pwNew1.value !== pwNew2.value;
      pwNew1.classList.toggle("field-invalid", mismatch);
      pwNew2.classList.toggle("field-invalid", mismatch);
      pwNew2.setCustomValidity(mismatch ? "Die neuen Passwörter stimmen nicht überein." : "");
    }
    pwNew1.addEventListener("input", pwCheck);
    pwNew2.addEventListener("input", pwCheck);
    pwOld.addEventListener("input", function () { pwOld.classList.remove("field-invalid"); });
  }

  // Konto-Dialog: beim Schließen ohne Speichern alles zurücksetzen — Felder
  // auf Ausgangswerte (Anzeigename zurück, Passwörter leer), Fehlermarkierungen
  // und Absende-Sperren weg, Abschnitte wieder eingeklappt
  var accountDlg = document.getElementById("dlg-account");
  if (accountDlg) {
    accountDlg.addEventListener("close", function () {
      accountDlg.querySelectorAll("form").forEach(function (f) { f.reset(); });
      accountDlg.querySelectorAll(".field-invalid").forEach(function (el) {
        el.classList.remove("field-invalid");
        el.setCustomValidity("");
      });
      accountDlg.querySelectorAll("details").forEach(function (d) { d.open = false; });
    });
  }

  // Anzeigename: schon beim Tippen rot markieren, wenn er (effektiv) leer ist,
  // und das Absenden blockieren — passend zu required + pattern im Formular
  var displayInput = document.querySelector("#dlg-account input[name=display]");
  if (displayInput) {
    displayInput.addEventListener("input", function () {
      var empty = displayInput.value.trim() === "";
      displayInput.classList.toggle("field-invalid", empty);
      displayInput.setCustomValidity(empty ? "Der Anzeigename darf nicht leer sein." : "");
    });
  }

  // E-Mail-Adresse: leer ist erlaubt (entfernt sie), sonst live gegen das
  // gleiche Regex wie der Server prüfen und bei Verstoß rot markieren
  var emailInput = document.querySelector("#dlg-account input[name=email]");
  if (emailInput) {
    emailInput.addEventListener("input", function () {
      var v = emailInput.value.trim();
      var bad = v !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      emailInput.classList.toggle("field-invalid", bad);
      emailInput.setCustomValidity(bad ? "Bitte eine gültige E-Mail-Adresse eingeben." : "");
    });
  }

  // Profilbild: der Stift auf dem Avatar öffnet die Dateiauswahl,
  // eine Auswahl lädt direkt hoch (kein eigener Hochladen-Knopf)
  var avatarForm = document.getElementById("avatar-upload");
  if (avatarForm) {
    var avatarInput = avatarForm.querySelector("input[type=file]");
    avatarForm.querySelector(".avatar-edit").addEventListener("click", function () {
      avatarInput.click();
    });
    avatarInput.addEventListener("change", function () {
      if (avatarInput.files.length) avatarForm.submit();
    });
  }
}
