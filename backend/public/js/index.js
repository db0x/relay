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

  // Passwort-Formular: kam der Redirect mit markiertem Feld zurück (Server-
  // Validierung), Dialog und Abschnitt wieder öffnen und das Feld fokussieren
  var invalidField = document.querySelector("#dlg-account .field-invalid");
  if (invalidField) {
    var accDlg = document.getElementById("dlg-account");
    if (accDlg && accDlg.showModal) accDlg.showModal();
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

  // Tooltips (data-tip + Freigabe-Tooltip) sind position:fixed, damit sie im
  // scrollbaren Tabellen-Wrapper keine Scrollbalken erzeugen — die Zielposition
  // (mittig unter dem Element) wird hier beim Hover/Fokus als CSS-Variablen gesetzt
  function placeTip(el) {
    var r = el.getBoundingClientRect();
    el.style.setProperty("--tip-x", (r.left + r.width / 2) + "px");
    el.style.setProperty("--tip-y", (r.bottom + 6) + "px");
  }
  document.querySelectorAll("[data-tip], .share-badge").forEach(function (el) {
    el.addEventListener("mouseenter", function () { placeTip(el); });
    el.addEventListener("focus", function () { placeTip(el); });
  });

  // Hochladen: ein Knopf öffnet die Dateiauswahl, die Auswahl lädt direkt hoch
  var uploadForm = document.querySelector(".upload-form");
  if (uploadForm) {
    var uploadInput = uploadForm.querySelector("input[type=file]");
    uploadForm.querySelector(".upload-btn").addEventListener("click", function () {
      uploadInput.click();
    });
    uploadInput.addEventListener("change", function () {
      if (uploadInput.files.length) uploadForm.submit();
    });
  }

  // Rückfrage für alle Formulare mit data-confirm (Token neu erzeugen, Löschen)
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
})();
