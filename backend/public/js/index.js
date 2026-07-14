// Verhalten der Startseite: Token kopieren + Rückfrage beim Neu-Erzeugen.
// Läuft per defer erst nach dem Parsen des DOM.
(function () {
  // Kebab-Menü neben dem Nutzernamen auf-/zuklappen
  var menuBtn = document.querySelector(".menu-btn");
  var menuPanel = document.querySelector(".menu-panel");
  function closeMenu() {
    if (menuPanel) menuPanel.hidden = true;
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }
  if (menuBtn && menuPanel) {
    menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = menuPanel.hidden;
      menuPanel.hidden = !willOpen;
      menuBtn.setAttribute("aria-expanded", String(willOpen));
    });
    menuPanel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
  }

  // Menüpunkte mit data-dialog öffnen den passenden <dialog>
  document.querySelectorAll("[data-dialog]").forEach(function (item) {
    item.addEventListener("click", function () {
      var dlg = document.getElementById(item.dataset.dialog);
      if (dlg && dlg.showModal) dlg.showModal();
      closeMenu();
    });
  });

  // Symbol-Buttons "Neue Datei": Dateityp übernehmen, Titel anpassen, Dialog öffnen
  var createDlg = document.getElementById("dlg-create");
  if (createDlg) {
    var createTitles = {
      docx: "Neues Textdokument",
      xlsx: "Neue Tabelle",
      pptx: "Neue Präsentation",
    };
    document.querySelectorAll("[data-create]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ext = btn.dataset.create;
        document.getElementById("dlg-create-title").textContent = createTitles[ext] || "Neue Datei";
        document.getElementById("dlg-create-ext").value = ext;
        var icon = document.getElementById("dlg-create-icon");
        icon.src = icon.src.replace(/[^/]+$/, ext + ".svg");
        var nameInput = document.getElementById("dlg-create-name");
        nameInput.value = "";
        createDlg.showModal();
        nameInput.focus();
      });
    });
  }

  var copyBtn = document.querySelector(".copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var tok = document.getElementById("tok").textContent;
      navigator.clipboard.writeText(tok);
      copyBtn.textContent = "kopiert ✓";
      setTimeout(function () { copyBtn.textContent = "kopieren"; }, 1500);
    });
  }

  // gewählten Dateinamen neben dem "Datei wählen"-Button anzeigen
  var fileInput = document.querySelector(".file-label input[type=file]");
  var fileName = document.querySelector(".file-name");
  if (fileInput && fileName) {
    fileInput.addEventListener("change", function () {
      fileName.textContent = fileInput.files.length
        ? fileInput.files[0].name
        : fileName.dataset.empty;
    });
  }

  // Rückfrage für alle Formulare mit data-confirm (Token neu erzeugen, Löschen)
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
})();
