// Rückfrage für alle Formulare mit data-confirm (Token neu erzeugen, Löschen,
// Freigabe entziehen, sperren ...) — eigener Dialog im App-Design statt
// window.confirm. "Bestätigen" schickt das gemerkte Formular ab; Abbrechen,
// × und Escape schließen nur den Dialog.
import { openDlg } from "./dialogs.js";

var confirmDlg = document.getElementById("dlg-confirm");
var confirmPending = null;

// root-skopiert: Loeschen-Formulare (Zeilenmenue) und Freigabe-entziehen
// (Freigabe-Dialog) kommen beim Ordnerwechsel neu und muessen erneut binden.
export function bindConfirmForms(root) {
  root.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!confirmDlg) { // Sicherheitsnetz, falls der Dialog mal fehlt
        if (!window.confirm(form.dataset.confirm)) e.preventDefault();
        return;
      }
      e.preventDefault();
      confirmPending = form;
      document.getElementById("dlg-confirm-text").textContent = form.dataset.confirm;
      openDlg(confirmDlg);
    });
  });
}

export function initConfirmDialog() {
  bindConfirmForms(document);
  if (!confirmDlg) return;
  document.getElementById("dlg-confirm-cancel").addEventListener("click", function () {
    confirmDlg.close();
  });
  document.getElementById("dlg-confirm-ok").addEventListener("click", function () {
    confirmDlg.close();
    var form = confirmPending;
    confirmPending = null;
    if (!form) return;
    // form[data-ajax]: eigene Logik uebernimmt den Versand (z.B. Backup-
    // Dialog, der offen bleiben und das Ergebnis inline zeigen will) statt
    // der normalen vollen Seitennavigation.
    if (form.dataset.ajax) form.dispatchEvent(new CustomEvent("relay-confirmed"));
    // submit() statt requestSubmit(): loest das submit-Event (und damit
    // diese Rueckfrage) nicht erneut aus
    else form.submit();
  });
  confirmDlg.addEventListener("close", function () { confirmPending = null; });
}
