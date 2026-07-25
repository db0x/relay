// Fusszeilen-Filter: "Nur eigene Dateien" blendet die mir freigegebenen
// Zeilen aus; der Zustand ueberlebt im localStorage. root-skopiert, weil der
// Filter (und die Fusszeile) beim Ordnerwechsel neu aus der Liste kommen.
var OWN_KEY = "relay-own-only";

export function bindOwnOnly(root) {
  var ownOnly = root.querySelector("#own-only");
  if (!ownOnly) return;
  var applyOwnFilter = function () {
    root.querySelectorAll("tr.row-foreign").forEach(function (row) {
      row.hidden = ownOnly.checked;
    });
    localStorage.setItem(OWN_KEY, ownOnly.checked ? "1" : "0");
  };
  ownOnly.checked = localStorage.getItem(OWN_KEY) === "1";
  ownOnly.addEventListener("change", applyOwnFilter);
  applyOwnFilter();
}

export function initOwnFilter() {
  bindOwnOnly(document);
}
