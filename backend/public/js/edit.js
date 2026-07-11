// Startet den OnlyOffice-Editor. Die JWT-signierte Config liefert der Server
// als JSON in <script id="editor-config">; hier nur noch auslesen und starten.
(function () {
  var cfg = JSON.parse(document.getElementById("editor-config").textContent);
  new DocsAPI.DocEditor("editor", cfg);
})();
