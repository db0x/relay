// Verhalten der Startseite: Token kopieren + Rückfrage beim Neu-Erzeugen.
// Läuft per defer erst nach dem Parsen des DOM.
(function () {
  // Zurueck-Navigation aus dem Editor: der Browser stellt die Seite sonst aus
  // dem bfcache wieder her — eingefroren mit offenem Dialog und veralteter
  // Dateiliste. Bei einer bfcache-Wiederherstellung deshalb frisch laden.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) location.reload();
  });

  // Menüs: Topbar-Kebab + ein Kontextmenü pro Dateizeile — es ist immer
  // höchstens eins offen. Die Zeilen-Panels sind position:fixed (im
  // scrollenden Tabellen-Wrapper erzeugte absolute Positionierung
  // Scrollbalken) und werden beim Öffnen am Knopf ausgerichtet;
  // bei Platzmangel unten klappen sie nach oben.
  function closeMenus() {
    document.querySelectorAll(".menu-panel").forEach(function (p) { p.hidden = true; });
    document.querySelectorAll(".menu-btn, .row-menu-btn").forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
  }
  document.querySelectorAll(".menu-btn, .row-menu-btn").forEach(function (btn) {
    var panel = btn.parentElement.querySelector(".menu-panel");
    if (!panel) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = panel.hidden;
      closeMenus();
      if (!willOpen) return;
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      if (panel.classList.contains("row-menu-panel")) {
        var r = btn.getBoundingClientRect();
        var top = r.bottom + 6;
        if (top + panel.offsetHeight > window.innerHeight - 8)
          top = Math.max(8, r.top - panel.offsetHeight - 6);
        panel.style.top = top + "px";
        panel.style.left = Math.max(8, r.right - panel.offsetWidth) + "px";
        panel.style.right = "auto"; // Basisregel .menu-panel setzt right:0
      }
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
  });
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    closeMenus();
    // nicht-modale Dialoge kennen kein cancel-Event -> selbst schliessen
    if (dlgStack.length) dlgStack[dlgStack.length - 1].close();
  });
  // Scrollen (auch im Tabellen-Wrapper, daher capture) wuerde fixe Panels
  // von ihrer Zeile trennen -> einfach schliessen
  window.addEventListener("scroll", closeMenus, true);
  // Klick auf einen Menüpunkt (Download-Link, Löschen ...) schließt das Menü
  document.querySelectorAll(".row-menu-panel .menu-item").forEach(function (item) {
    item.addEventListener("click", closeMenus);
  });

  // Dialoge oeffnen nicht-modal (show statt showModal): showModal legt sie in
  // den Top-Layer des Browsers, ueber den eine umgebende Wrapper-App (z.B.
  // Voltage) per z-index nicht mehr zeichnen kann — ihr Kontextmenue bliebe
  // unter dem Dialog. Backdrop und Stapelreihenfolge deshalb in Eigenregie.
  var dlgBackdrop = document.getElementById("dlg-backdrop");
  var dlgStack = [];
  function openDlg(dlg) {
    if (dlgStack.indexOf(dlg) === -1) dlgStack.push(dlg);
    // spaeter geoeffnete Dialoge liegen oben (DOM-Reihenfolge reicht nicht:
    // z.B. oeffnet die Token-Rueckfrage ueber dem spaeter notierten Konto-Dialog)
    dlg.style.zIndex = String(60 + dlgStack.length);
    if (!dlg.open) dlg.show();
    if (dlgBackdrop) dlgBackdrop.classList.add("open");
  }
  document.querySelectorAll("dialog.dialog").forEach(function (d) {
    d.addEventListener("close", function () {
      var i = dlgStack.indexOf(d);
      if (i !== -1) dlgStack.splice(i, 1);
      if (!dlgStack.length && dlgBackdrop) dlgBackdrop.classList.remove("open");
    });
  });

  // Menüpunkte mit data-dialog öffnen den passenden <dialog>
  document.querySelectorAll("[data-dialog]").forEach(function (item) {
    item.addEventListener("click", function () {
      var dlg = document.getElementById(item.dataset.dialog);
      if (dlg) openDlg(dlg);
      closeMenus();
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
    var createNameLabels = {
      docx: "Name des Textdokuments",
      xlsx: "Name der Tabelle",
      pptx: "Name der Präsentation",
    };
    document.querySelectorAll("[data-create]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ext = btn.dataset.create;
        document.getElementById("dlg-create-title").textContent = createTitles[ext] || "Neue Datei";
        document.getElementById("dlg-create-name-label").textContent =
          createNameLabels[ext] || "Name der Datei";
        document.getElementById("dlg-create-ext").value = ext;
        var icon = document.getElementById("dlg-create-icon");
        icon.src = icon.src.replace(/[^/]+$/, ext + ".svg");
        var nameInput = document.getElementById("dlg-create-name");
        nameInput.value = "";
        // Sprache startet bei jedem Oeffnen wieder auf dem Default (Deutsch)
        var langSelect = document.getElementById("dlg-create-lang");
        if (langSelect) langSelect.value = langSelect.dataset.default;
        // Werte wurden programmatisch gesetzt -> Button-Zustand neu bewerten
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        openDlg(createDlg);
        nameInput.focus();
      });
    });
  }

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

  // Tooltips (data-tip + Freigabe-Tooltip) sind position:fixed, damit sie im
  // scrollbaren Tabellen-Wrapper keine Scrollbalken erzeugen — die Zielposition
  // (mittig unter dem Element) wird hier beim Hover/Fokus als CSS-Variablen gesetzt
  function placeTip(el) {
    var r = el.getBoundingClientRect();
    el.style.setProperty("--tip-x", (r.left + r.width / 2) + "px");
    el.style.setProperty("--tip-y", (r.bottom + 6) + "px");
  }
  // Koordinaten nach dem Ausblenden wieder entfernen: waehrend der
  // Dialog-Animationen (transform!) wuerde ein Dialog kurz zum Bezugsrahmen
  // der fixen Tooltips — gespeicherte Viewport-Koordinaten laegen dann weit
  // ausserhalb und erzeugten fluechtige Scrollbalken im Dialog.
  function clearTip(el) {
    setTimeout(function () { // erst nach dem .12s-Fade, sonst springt er beim Ausblenden
      el.style.removeProperty("--tip-x");
      el.style.removeProperty("--tip-y");
    }, 150);
  }
  document.querySelectorAll("[data-tip], .share-badge").forEach(function (el) {
    el.addEventListener("mouseenter", function () { placeTip(el); });
    el.addEventListener("focus", function () { placeTip(el); });
    el.addEventListener("mouseleave", function () { clearTip(el); });
    el.addEventListener("blur", function () { clearTip(el); });
  });

  // Lange Dateinamen (Liste) und Dialog-Titel sind per Ellipsis gekuerzt (CSS);
  // der volle Text erscheint als Tooltip — aber nur, wenn wirklich abgeschnitten
  document.querySelectorAll(".fname:not(.note-open), .dialog-head h2").forEach(function (el) {
    el.addEventListener("mouseenter", function () {
      if (el.scrollWidth > el.clientWidth) {
        el.dataset.tip = el.textContent.trim().replace(/\s+/g, " ");
        placeTip(el);
      } else {
        delete el.dataset.tip;
      }
    });
    el.addEventListener("mouseleave", function () { clearTip(el); });
  });

  // Fusszeilen-Filter: "Nur eigene Dateien" blendet die mir freigegebenen
  // Zeilen aus; der Zustand ueberlebt im localStorage
  var ownOnly = document.getElementById("own-only");
  if (ownOnly) {
    var OWN_KEY = "relay-own-only";
    var applyOwnFilter = function () {
      document.querySelectorAll("tr.row-foreign").forEach(function (row) {
        row.hidden = ownOnly.checked;
      });
      localStorage.setItem(OWN_KEY, ownOnly.checked ? "1" : "0");
    };
    ownOnly.checked = localStorage.getItem(OWN_KEY) === "1";
    ownOnly.addEventListener("change", applyOwnFilter);
    applyOwnFilter();
  }

  // Notizen: Markdown-Editor (CodeMirror mit Markdown-Highlighting) als
  // grosser modaler Dialog, rechts eine Live-Vorschau (marked -> DOMPurify ->
  // highlight.js fuer Code-Bloecke). "Neue Notiz" oeffnet sofort mit
  // "# Titel"-Vorlage; Klick auf eine Notiz laedt deren Inhalt.
  // Speichern erst bei Aenderung gegenueber dem Oeffnen (eigene Logik statt
  // dialog-submit-Waechter: der Ausgangszustand wechselt mit jedem Oeffnen).
  var noteDlg = document.getElementById("dlg-note");
  if (noteDlg) {
    var noteForm = document.getElementById("note-form");
    var noteText = noteForm.querySelector("textarea");
    var noteSave = document.getElementById("note-save");
    var noteTitleEl = document.getElementById("dlg-note-title");
    var notePreview = document.getElementById("note-preview");
    var noteStatus = document.getElementById("note-status");
    var noteCreateAction = noteForm.action; // .../notes/create
    var noteBaseUrl = noteCreateAction.replace(/\/notes\/create$/, "");
    var noteBaseline = "";
    var noteCM = null;    // CodeMirror-Instanz; ohne Vendor-JS bleibt die Textarea
    var noteTimer = null;

    if (window.marked) marked.use({ gfm: true, breaks: true });

    function noteVal() { return noteCM ? noteCM.getValue() : noteText.value; }

    // Links in gerendertem Markdown: externe (http/https/mailto) mit
    // target=_blank versehen — Wrapper-Apps (z.B. Voltage) reichen _blank an
    // den System-Browser durch, normale Navigation bliebe in der App haengen.
    // Interne/relative Links und Anker wuerden mitten in der App auf
    // Nirgendwo-Pfade navigieren -> href entfernen, sie werden reiner Text.
    function externalizeLinks(root) {
      root.querySelectorAll("a[href]").forEach(function (a) {
        if (/^(https?:|mailto:)/i.test(a.getAttribute("href"))) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        } else {
          a.removeAttribute("href");
        }
      });
    }

    // Vorschau rendern; wirft der Parser, gilt das Markdown als ungueltig
    // und die Statuszeile zeigt den Fehler (Speichern bleibt moeglich)
    function renderNotePreview() {
      if (!window.marked || !window.DOMPurify) return;
      var html;
      try {
        html = marked.parse(noteVal());
        noteStatus.textContent = "";
      } catch (e) {
        noteStatus.textContent = "Markdown-Fehler: " + (e && e.message || e);
        return;
      }
      notePreview.innerHTML = DOMPurify.sanitize(html);
      externalizeLinks(notePreview);
      if (window.hljs) {
        notePreview.querySelectorAll("pre code").forEach(function (el) {
          hljs.highlightElement(el);
        });
      }
    }

    function onNoteChange() {
      var v = noteVal();
      noteSave.disabled = v === noteBaseline || v.trim() === "";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(renderNotePreview, 200);
    }

    function ensureNoteEditor() {
      if (noteCM || !window.CodeMirror) return;
      noteCM = CodeMirror.fromTextArea(noteText, {
        mode: "markdown",
        lineWrapping: true,
        extraKeys: {
          "Ctrl-B": function () { mdActions.bold(); },
          "Ctrl-I": function () { mdActions.italic(); },
        },
      });
      noteCM.on("change", onNoteChange);
    }
    noteText.addEventListener("input", onNoteChange); // Fallback ohne CodeMirror

    // Ansicht vs. Bearbeiten: bestehende Notizen oeffnen als gerendertes
    // Panel (note-view); der Stift auf dem Panel wechselt ins Bearbeiten.
    var noteCanEdit = false;
    var noteEditBtn = document.getElementById("note-edit");
    function setNoteMode(editMode) {
      noteDlg.classList.toggle("note-view", !editMode);
      if (noteEditBtn) noteEditBtn.hidden = editMode || !noteCanEdit;
      if (editMode && noteCM) {
        noteCM.refresh(); // Spalte war ausgeblendet -> Masse neu messen
        noteCM.focus();
      }
    }
    if (noteEditBtn) {
      noteEditBtn.addEventListener("click", function () { setNoteMode(true); });
    }

    function openNote(title, content, action, canEdit, startEdit) {
      ensureNoteEditor();
      noteCanEdit = canEdit;
      setNoteMode(!!(startEdit && canEdit));
      noteTitleEl.textContent = title;
      noteForm.action = action;
      if (noteCM) {
        noteCM.setValue(content);
        noteCM.setOption("readOnly", canEdit ? false : "nocursor");
      } else {
        noteText.value = content;
        noteText.readOnly = !canEdit;
      }
      noteSave.hidden = !canEdit;
      noteSave.disabled = true;
      noteStatus.textContent = "";
      noteBaseline = content;
      openDlg(noteDlg);
      if (noteCM) {
        noteCM.refresh(); // war beim Initialisieren unsichtbar -> Masse neu messen
        if (canEdit) noteCM.focus();
      } else if (canEdit) {
        noteText.focus();
      }
      renderNotePreview();
    }

    // Splitter: Aufteilung Editor/Vorschau per Ziehen aendern (20-80%),
    // gemerkt im localStorage; CodeMirror muss bei Breitenaenderung neu messen
    var noteSplitter = document.getElementById("note-splitter");
    var noteMain = noteForm.querySelector(".note-main");
    var noteEditorPane = noteForm.querySelector(".note-editor-pane");
    var SPLIT_KEY = "relay-note-split";
    var savedSplit = parseFloat(localStorage.getItem(SPLIT_KEY));
    if (savedSplit >= 20 && savedSplit <= 80)
      noteEditorPane.style.flex = "0 0 " + savedSplit + "%";
    if (noteSplitter) {
      noteSplitter.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        noteSplitter.setPointerCapture(e.pointerId);
        noteSplitter.classList.add("dragging");
      });
      noteSplitter.addEventListener("pointermove", function (e) {
        if (!noteSplitter.hasPointerCapture(e.pointerId)) return;
        var rect = noteMain.getBoundingClientRect();
        var pct = Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100));
        noteEditorPane.style.flex = "0 0 " + pct + "%";
        localStorage.setItem(SPLIT_KEY, pct.toFixed(1));
        if (noteCM) noteCM.refresh();
      });
      noteSplitter.addEventListener("pointerup", function (e) {
        noteSplitter.releasePointerCapture(e.pointerId);
        noteSplitter.classList.remove("dragging");
      });
    }

    // Markdown-Toolbar: Toggle-Operationen auf der CodeMirror-Selektion.
    // Alle Aenderungen laufen ueber die CM-API -> change-Event -> Vorschau
    // und Speichern-Zustand aktualisieren sich von selbst.
    function mdWrap(marker) {
      if (!noteCM) return;
      var sel = noteCM.getSelection();
      if (sel.length >= 2 * marker.length && sel.startsWith(marker) && sel.endsWith(marker)) {
        noteCM.replaceSelection(sel.slice(marker.length, sel.length - marker.length), "around");
      } else if (sel) {
        noteCM.replaceSelection(marker + sel + marker, "around");
      } else {
        var cur = noteCM.getCursor();
        noteCM.replaceRange(marker + marker, cur);
        noteCM.setCursor({ line: cur.line, ch: cur.ch + marker.length });
      }
      noteCM.focus();
    }
    function mdEachLine(fn) { // fn(text) -> neuer Text, fuer alle selektierten Zeilen
      if (!noteCM) return;
      var from = noteCM.getCursor("from").line, to = noteCM.getCursor("to").line;
      noteCM.operation(function () {
        for (var l = from, i = 0; l <= to; l++, i++) {
          var t = noteCM.getLine(l);
          noteCM.replaceRange(fn(t, i), { line: l, ch: 0 }, { line: l, ch: t.length });
        }
      });
      noteCM.focus();
    }
    function mdPrefix(prefix, re) {
      mdEachLine(function (t) { return re.test(t) ? t.replace(re, "") : prefix + t; });
    }
    function mdHeading(level) {
      mdEachLine(function (t) {
        var m = t.match(/^(#{1,6})\s+/);
        var stripped = t.replace(/^#{1,6}\s+/, "");
        return m && m[1].length === level ? stripped : "#".repeat(level) + " " + stripped;
      });
    }
    var mdActions = {
      bold: function () { mdWrap("**"); },
      italic: function () { mdWrap("*"); },
      strike: function () { mdWrap("~~"); },
      code: function () { mdWrap("`"); },
      h1: function () { mdHeading(1); },
      h2: function () { mdHeading(2); },
      h3: function () { mdHeading(3); },
      ul: function () { mdPrefix("- ", /^-\s+(?!\[)/); },
      ol: function () { mdEachLine(function (t, i) {
        return /^\d+\.\s+/.test(t) ? t.replace(/^\d+\.\s+/, "") : (i + 1) + ". " + t;
      }); },
      task: function () { mdPrefix("- [ ] ", /^-\s+\[[ xX]\]\s+/); },
      quote: function () { mdPrefix("> ", /^>\s?/); },
      codeblock: function () {
        if (!noteCM) return;
        var sel = noteCM.getSelection();
        if (sel) {
          noteCM.replaceSelection("```\n" + sel + "\n```", "around");
        } else {
          var cur = noteCM.getCursor();
          noteCM.replaceRange("```\n\n```", cur);
          noteCM.setCursor({ line: cur.line + 1, ch: 0 });
        }
        noteCM.focus();
      },
      link: function () {
        if (!noteCM) return;
        noteCM.replaceSelection("[" + (noteCM.getSelection() || "Text") + "](url)");
        var end = noteCM.getCursor();
        noteCM.setSelection({ line: end.line, ch: end.ch - 4 }, { line: end.line, ch: end.ch - 1 });
        noteCM.focus();
      },
      hr: function () {
        if (!noteCM) return;
        var cur = noteCM.getCursor();
        noteCM.replaceRange("\n---\n", { line: cur.line, ch: noteCM.getLine(cur.line).length });
        noteCM.focus();
      },
    };
    document.querySelectorAll("#note-toolbar .note-tb").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var fn = mdActions[btn.dataset.md];
        if (fn && noteCM && !noteCM.getOption("readOnly")) fn();
      });
    });

    var noteNew = document.getElementById("note-new");
    if (noteNew) {
      noteNew.addEventListener("click", function () {
        openNote("Neue Notiz", "# Titel\n\n", noteCreateAction, true, true);
        // "Titel" vorselektieren: lostippen ersetzt das Platzhalterwort
        if (noteCM) noteCM.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 7 });
        else noteText.setSelectionRange(2, 7);
      });
    }
    // Hover ueber einem Notiz-Namen: gerenderte Vorschau als Kaertchen unter
    // dem Namen (gleiche Verzoegerung wie Tooltips, Inhalt wird gecacht;
    // nach dem Speichern laedt die Seite ohnehin neu -> Cache immer frisch)
    var noteTip = document.getElementById("note-tip");
    var noteTipCache = {};
    var noteTipTimer = null;
    function hideNoteTip() {
      clearTimeout(noteTipTimer);
      if (noteTip) noteTip.classList.remove("open");
    }
    window.addEventListener("scroll", hideNoteTip, true);
    document.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("mouseleave", hideNoteTip);
      btn.addEventListener("mouseenter", function () {
        if (!noteTip || !window.marked || !window.DOMPurify) return;
        clearTimeout(noteTipTimer);
        noteTipTimer = setTimeout(function () {
          var rel = btn.dataset.rel.split("/").map(encodeURIComponent).join("/");
          var key = btn.dataset.owner + "/" + btn.dataset.rel;
          var loaded = noteTipCache[key] !== undefined
            ? Promise.resolve(noteTipCache[key])
            : fetch(noteBaseUrl + "/notes/raw/" + encodeURIComponent(btn.dataset.owner) + "/" + rel)
                .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
                .then(function (t) { noteTipCache[key] = t; return t; });
          loaded.then(function (text) {
            noteTip.innerHTML = DOMPurify.sanitize(marked.parse(text));
            externalizeLinks(noteTip);
            if (window.hljs) {
              noteTip.querySelectorAll("pre code").forEach(function (el) {
                hljs.highlightElement(el);
              });
            }
            var r = btn.getBoundingClientRect();
            var left = Math.max(8, Math.min(r.left, window.innerWidth - noteTip.offsetWidth - 8));
            var top = r.bottom + 6;
            if (top + noteTip.offsetHeight > window.innerHeight - 8)
              top = Math.max(8, r.top - noteTip.offsetHeight - 6);
            noteTip.style.left = left + "px";
            noteTip.style.top = top + "px";
            noteTip.classList.add("open");
          }).catch(function () { /* Vorschau ist optional — Fehler still schlucken */ });
        }, 350);
      });
    });

    document.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        hideNoteTip();
        var rel = btn.dataset.rel.split("/").map(encodeURIComponent).join("/");
        var url = noteBaseUrl + "/notes/raw/" + encodeURIComponent(btn.dataset.owner) + "/" + rel;
        fetch(url)
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then(function (text) {
            openNote(btn.dataset.label,
              text,
              noteBaseUrl + "/notes/save/" + encodeURIComponent(btn.dataset.owner) + "/" + rel,
              btn.dataset.canedit === "1");
          })
          .catch(function () {
            showNotice("Fehler", "Die Notiz konnte nicht geladen werden.", { danger: true });
          });
      });
    });
  }

  // Hinweis-Dialog mit einer OK-Taste (App-Design statt window.alert).
  // content: String oder DOM-Knoten (fuer Fettdruck u.ae.);
  // opts.danger: roter Kopf ("geht nicht"), opts.icon: Bild-URL im Kopf
  function showNotice(title, content, opts) {
    var dlg = document.getElementById("dlg-notice");
    if (!dlg) { // Sicherheitsnetz
      window.alert(typeof content === "string" ? content : content.textContent);
      return;
    }
    opts = opts || {};
    document.getElementById("dlg-notice-title").textContent = title;
    var p = document.getElementById("dlg-notice-text");
    p.textContent = "";
    if (typeof content === "string") p.textContent = content;
    else p.appendChild(content);
    document.getElementById("dlg-notice-head")
      .classList.toggle("dialog-head-danger", !!opts.danger);
    var icon = document.getElementById("dlg-notice-icon");
    icon.hidden = !opts.icon;
    if (opts.icon) icon.src = opts.icon;
    openDlg(dlg);
  }

  // Dateityp-Icon zum Namen (gleiche Gruppen wie iconFor im Backend);
  // null, wenn die Endung nicht erkennbar ist
  function iconForName(name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    var map = {
      xlsx: "xlsx", xls: "xlsx", ods: "xlsx", csv: "xlsx",
      pptx: "pptx", ppt: "pptx", odp: "pptx", pdf: "pdf",
      docx: "docx", doc: "docx", odt: "docx", rtf: "docx", txt: "docx",
    };
    return map[ext] || null;
  }

  // Hochladen: ein Knopf öffnet die Dateiauswahl, die Auswahl lädt direkt hoch.
  // Vorher wird die Dateigröße gegen das Limit geprüft (MAX_UPLOAD_MB aus der
  // .env, via data-max-mb) — zu große Dateien starten den Upload gar nicht erst.
  var uploadForm = document.querySelector(".upload-form");
  if (uploadForm) {
    var uploadInput = uploadForm.querySelector("input[type=file]");
    uploadForm.querySelector(".upload-btn").addEventListener("click", function () {
      uploadInput.click();
    });
    uploadInput.addEventListener("change", function () {
      if (!uploadInput.files.length) return;
      var maxMb = parseInt(uploadForm.dataset.maxMb, 10) || 128;
      var f = uploadInput.files[0];
      if (f.size > maxMb * 1024 * 1024) {
        var mb = (f.size / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 });
        // Dateiname fett, Rest als Text — daher DOM-Knoten statt String
        var msg = document.createDocumentFragment();
        var strong = document.createElement("strong");
        strong.textContent = "„" + f.name + "“";
        msg.appendChild(strong);
        msg.appendChild(document.createTextNode(
          " ist " + mb + " MB groß — erlaubt sind maximal " + maxMb + " MB."));
        var icon = iconForName(f.name);
        showNotice("Datei zu groß", msg, {
          danger: true,
          // Basis-URL aus der Formular-Action ableiten (beruecksichtigt BASE_PATH)
          icon: icon ? uploadForm.action.replace(/\/upload$/, "") + "/static/img/" + icon + ".svg" : null,
        });
        uploadInput.value = ""; // Auswahl verwerfen, sonst haengt sie im Formular
        return;
      }
      uploadForm.submit();
    });
  }

  // Speichern/Anlegen/Erstellen/Ändern nur aktiv, wenn sich gegenüber dem
  // Ausgangszustand etwas geändert hat UND alle Validierungen erfüllt sind.
  // Beobachtet: alle Formulare mit .dialog-submit-Button plus die Nutzeranlage.
  // Der Ausgangszustand ist der serialisierte FormData-Stand beim Laden;
  // form.reset() (Dialog schließen) meldet sich über das reset-Event zurück.
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

  // Rückfrage für alle Formulare mit data-confirm (Token neu erzeugen, Löschen,
  // Freigabe entziehen, sperren ...) — eigener Dialog im App-Design statt
  // window.confirm. "Bestätigen" schickt das gemerkte Formular ab; Abbrechen,
  // × und Escape schließen nur den Dialog.
  var confirmDlg = document.getElementById("dlg-confirm");
  var confirmPending = null;
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
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
  if (confirmDlg) {
    document.getElementById("dlg-confirm-cancel").addEventListener("click", function () {
      confirmDlg.close();
    });
    document.getElementById("dlg-confirm-ok").addEventListener("click", function () {
      confirmDlg.close();
      // submit() statt requestSubmit(): loest das submit-Event (und damit
      // diese Rueckfrage) nicht erneut aus
      if (confirmPending) confirmPending.submit();
      confirmPending = null;
    });
    confirmDlg.addEventListener("close", function () { confirmPending = null; });
  }
})();
