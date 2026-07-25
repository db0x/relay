// Speichern/Anlegen/Erstellen/Ändern nur aktiv, wenn sich gegenüber dem
// Ausgangszustand etwas geändert hat UND alle Validierungen erfüllt sind.
// Beobachtet: alle Formulare mit .dialog-submit-Button plus die Nutzeranlage.
// Der Ausgangszustand ist der serialisierte FormData-Stand beim Laden;
// form.reset() (Dialog schließen) meldet sich über das reset-Event zurück.
export function initFormWatch() {
  var watchedForms = [];
  document.querySelectorAll(".dialog-submit").forEach(function (btn) {
    var f = btn.closest("form");
    if (f) watchedForms.push([f, btn]);
  });
  var userCreate = document.querySelector("form.user-create");
  if (userCreate) watchedForms.push([userCreate, userCreate.querySelector("button")]);
  watchedForms.forEach(function (pair) {
    var form = pair[0], btn = pair[1];
    var initial = new URLSearchParams(new FormData(form)).toString();
    function refresh() {
      var now = new URLSearchParams(new FormData(form)).toString();
      btn.disabled = now === initial || !form.checkValidity();
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    // reset-Event feuert VOR dem Zuruecksetzen der Werte -> einen Tick warten
    form.addEventListener("reset", function () { setTimeout(refresh, 0); });
    refresh();
  });
}
