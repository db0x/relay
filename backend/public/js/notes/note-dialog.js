// Notizen: Markdown-Editor (CodeMirror mit Markdown-Highlighting) als
// grosser modaler Dialog, rechts eine Live-Vorschau (marked -> DOMPurify ->
// highlight.js fuer Code-Bloecke). "Neue Notiz" oeffnet sofort mit
// "# Titel"-Vorlage; Klick auf eine Notiz laedt deren Inhalt.
// Speichern erst bei Aenderung gegenueber dem Oeffnen (eigene Logik statt
// dialog-submit-Waechter: der Ausgangszustand wechselt mit jedem Oeffnen).
import { openDlg, closeMenus } from "../core/dialogs.js";
import { createPeopleChips } from "./people-chips.js";
import { NOTE_COLOR_DEFAULT, noteColorValue, paintNoteIcon, initNoteColorPicker } from "./color.js";
import { renderNoteSummary } from "./summary.js";
import { externalizeLinks, renderMarkdown, highlightCode, createMarkdownActions, bindMarkdownToolbar } from "./markdown.js";
import { initEmoji, bindEmoticons } from "./emoji.js";
import { bindDocLinks } from "./doclinks.js";
import { initMention } from "./mention.js";

// baseUrl: Basis-URL der Notiz-Endpunkte (.../notes/create ohne den Suffix).
// Rueckgabe: { openNote } — von notes.js an das Hover-/Klick-Modul weitergereicht.
export function initNoteDialog(baseUrl) {
  var noteDlg = document.getElementById("dlg-note");
  var noteForm = document.getElementById("note-form");
  var noteText = noteForm.querySelector("textarea");
  var noteSave = document.getElementById("note-save");
  var noteTitleEl = document.getElementById("dlg-note-title");
  // NICHT der Scroll-Behaelter #note-preview, sondern die Ebene darin: dessen
  // Innenleben gehoert der Bildlaufleiste (siehe Kommentar im Template)
  var notePreview = document.getElementById("note-preview-body");
  var noteStatus = document.getElementById("note-status");
  var noteCreateAction = noteForm.action; // .../notes/create — vor jeder openNote-Mutation gemerkt
  var noteBaseline = "";
  var noteCM = null;    // CodeMirror-Instanz; ohne Vendor-JS bleibt die Textarea
  var noteTimer = null;

  // ToDo/Personen/Ort — eigenes Formular-Stueck, laeuft aber ueber denselben
  // Speichern-Button wie der Markdown-Inhalt (ein Submit pro Dialog).
  // Der Bearbeitungsstand gehoert bewusst NICHT dazu: er wird ausschliesslich
  // ueber das Kontextmenue der Notiz-Icons gewechselt (status.js) und hier nur
  // als Badge in der Lese-Ansicht angezeigt.
  var noteTodo = document.getElementById("note-todo");
  var noteDue = document.getElementById("note-due");
  var noteOrt = document.getElementById("note-ort");
  var noteMetaBaseline = "";

  // Farbe des Notiz-Icons — dezent als Farbtupfer in der Fusszeile, der
  // Waehler kommt von Coloris (vendor). Leerer Wert = Standardfarbe.
  var noteColorInput = document.getElementById("note-color");
  var noteColorWrap = document.getElementById("note-color-wrap");
  var noteDlgIco = document.getElementById("note-dlg-ico");
  var noteDetails = document.getElementById("note-details");
  var noteViewSummary = document.getElementById("note-view-summary");
  var noteSummaryHasContent = false;

  var people = createPeopleChips({
    field: document.getElementById("note-people-field"),
    chipsEl: document.getElementById("note-people-chips"),
    input: document.getElementById("note-people-input"),
    hiddenEl: document.getElementById("note-people-hidden"),
    form: noteForm,
    baseUrl: baseUrl,
    onChange: function () { onNoteChange(); },
  });

  function updateDueVisibility() {
    // Faelligkeitsdatum ist optional — es gibt ToDos ohne feste Timeline;
    // das Datumsfeld erscheint inline neben dem Schalter, nur wenn ToDo an ist
    var on = noteTodo.checked;
    noteDue.hidden = !on;
    if (!on) noteDue.value = "";
  }

  function metaSnapshot() {
    return JSON.stringify({
      isTodo: noteTodo.checked, dueDate: noteTodo.checked ? noteDue.value : "",
      people: people.getChips().map(function (c) { return c.username || ("~" + c.name); }),
      ort: noteOrt.value,
      color: noteColorValue(noteColorInput),
    });
  }

  // Farbe uebernommen: das Icon im Dialogkopf zeigt sie sofort, und der
  // Farbtupfer in der Fusszeile bekommt sie ueber --note-swatch — bei
  // "Standard" (leerer Wert) eben die Standardfarbe (siehe index.css).
  function onColorChanged() {
    var hex = noteColorValue(noteColorInput);
    paintNoteIcon(noteDlgIco, hex);
    noteColorWrap.style.setProperty("--note-swatch", hex || NOTE_COLOR_DEFAULT);
  }
  initNoteColorPicker(noteColorInput, function () {
    onColorChanged();
    onNoteChange();
  });

  function noteVal() { return noteCM ? noteCM.getValue() : noteText.value; }

  // Vorschau rendern; wirft der Parser, gilt das Markdown als ungueltig
  // und die Statuszeile zeigt den Fehler (Speichern bleibt moeglich)
  function renderNotePreview() {
    var html;
    try {
      html = renderMarkdown(noteVal());
      noteStatus.textContent = "";
    } catch (e) {
      noteStatus.textContent = "Markdown-Fehler: " + (e && e.message || e);
      return;
    }
    notePreview.innerHTML = html;
    // Verweise auf Dokumente VOR externalizeLinks: der wuerde ihnen sonst als
    // vermeintlich internen Links den href abnehmen
    bindDocLinks(notePreview, {
      baseUrl: baseUrl,
      openNote: function (o, r, l) { if (hooks.open) hooks.open(o, r, l); },
      noteTip: function (a, o, r) { if (hooks.tip) hooks.tip(a, o, r); },
      hideNoteTip: function () { if (hooks.hide) hooks.hide(); },
    });
    externalizeLinks(notePreview);
    highlightCode(notePreview);
  }

  // Verweise im gerenderten Text verhalten sich wie die Notiz selbst:
  // Vorschau beim Hinfahren, Oeffnen beim Klick. Beides kommt von der
  // Hover-/Klick-Bindung — und die kennt diesen Dialog erst, wenn es ihn gibt,
  // wird also von aussen nachgereicht (notes.js).
  var hooks = {};

  function onNoteChange() {
    var v = noteVal();
    var unchanged = v === noteBaseline && metaSnapshot() === noteMetaBaseline;
    noteSave.disabled = unchanged || v.trim() === "";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(renderNotePreview, 200);
  }

  noteTodo.addEventListener("change", function () { updateDueVisibility(); onNoteChange(); });
  [noteDue, noteOrt].forEach(function (el) { el.addEventListener("input", onNoteChange); });

  var mdActions = createMarkdownActions(function () { return noteCM; });

  // Verlinken per @: die Auswahl liegt in der Editor-Spalte, damit sie beim
  // Verschieben und Skalieren des Dialogs mitwandert
  var mention = initMention({
    getCM: function () { return noteCM; },
    pane: noteForm.querySelector(".note-editor-pane"),
    baseUrl: baseUrl,
  });

  function ensureNoteEditor() {
    if (noteCM || !window.CodeMirror) return;
    var opts = {
      mode: "markdown",
      theme: "github", // eigene Palette in index.css, passend zur Vorschau
      lineWrapping: true,
      extraKeys: {
        "Ctrl-B": function () { mdActions.bold(); },
        "Ctrl-I": function () { mdActions.italic(); },
      },
    };
    // Eigene Bildlaufleiste statt der nativen (Addon vendor/cm-scrollbars.js,
    // Optik in index.css) — die native ist auf vielen Systemen unsichtbar,
    // siehe core/scrollbars.js. Nur setzen, wenn das Addon wirklich da ist:
    // ein unbekanntes Modell laesst CodeMirror werfen.
    if (CodeMirror.scrollbarModel && CodeMirror.scrollbarModel.overlay)
      opts.scrollbarStyle = "overlay";
    noteCM = CodeMirror.fromTextArea(noteText, opts);
    noteCM.on("change", onNoteChange);
    // Kuerzel wie :) beim Tippen ersetzen — erst jetzt moeglich, der Editor
    // entsteht ja beim ersten Oeffnen des Dialogs
    bindEmoticons(noteCM);
    // ebenso das Verlinken per @
    mention.bindeCM(noteCM);
  }
  noteText.addEventListener("input", onNoteChange); // Fallback ohne CodeMirror

  // Ansicht vs. Bearbeiten: bestehende Notizen oeffnen als gerendertes
  // Panel (note-view); der Stift auf dem Panel wechselt ins Bearbeiten.
  var noteCanEdit = false;
  var noteEditBtn = document.getElementById("note-edit");
  var notePdfBtn = document.getElementById("note-pdf");
  var noteDelBtn = document.getElementById("note-delete");
  var noteDelForm = document.getElementById("note-del-form");
  // Ziel des Loeschens; null = kein Loeschen (fremde Notiz oder neue Notiz)
  var noteDeleteUrl = null;
  var noteExportUrl = null; // /notes/pdf/... — nur bei gespeicherten Notizen

  // Groesse wird je Modus getrennt gemerkt (siehe setNoteMode). Der Schluessel
  // haengt an der Klasse, nicht an einem Merker: setNoteMode setzt sie als
  // Erstes, danach fragen Anwenden UND Merken dieselbe Quelle.
  function groesseKey() {
    return noteDlg.classList.contains("note-view")
      ? "relay-note-view-size" : "relay-note-size";
  }

  function setNoteMode(editMode) {
    noteDlg.classList.toggle("note-view", !editMode);
    // evtl. beim Resizen eingefrorene Position aufheben -> wieder zentriert
    noteDlg.style.left = noteDlg.style.top = noteDlg.style.margin = "";
    // Gemerkte Groesse anwenden, aber nie groesser als das Fenster. Beide Modi
    // merken sich ihre eigene: die Lese-Ansicht ist schmaler (keine
    // Editor-Spalte), eine gemeinsame Groesse waere fuer einen der beiden
    // immer falsch. Ohne gemerkte Groesse gilt die CSS-Vorgabe.
    var s = (localStorage.getItem(groesseKey()) || "").split("x");
    if (s.length === 2 && +s[0] && +s[1]) {
      noteDlg.style.width = Math.min(+s[0], window.innerWidth - 24) + "px";
      noteDlg.style.height = Math.min(+s[1], window.innerHeight - 24) + "px";
    } else {
      noteDlg.style.width = noteDlg.style.height = "";
    }
    if (noteEditBtn) noteEditBtn.hidden = editMode || !noteCanEdit;
    // PDF-Export nur im Lese-Modus und nur bei bereits gespeicherten Notizen
    // (auch fuer nur-lesende Freigaben verfuegbar)
    if (notePdfBtn) notePdfBtn.hidden = editMode || !noteExportUrl;
    // Loeschen nur im Lesemodus und nur beim BESITZER — eine mit
    // Bearbeiten-Recht freigegebene Notiz gehoert einem anderen (dieselbe
    // Regel wie im Zeilenmenue der Dateiliste, serverseitig in /delete).
    if (noteDelBtn) noteDelBtn.hidden = editMode || !noteDeleteUrl;
    // Detailfelder nur im Bearbeiten-Modus anfassbar — wie der Editor
    // selbst (das Panel im Lese-Modus zeigt nur an, aendert nichts)
    var metaEditable = editMode && noteCanEdit;
    noteTodo.disabled = !metaEditable;
    [noteDue, noteOrt, document.getElementById("note-people-input"), noteColorInput]
      .forEach(function (el) { el.disabled = !metaEditable; });
    if (!metaEditable) people.hideDropdown();
    // Farbtupfer ist ein Bedienelement -> nur beim Bearbeiten; im Lese-Modus
    // zeigt das Icon im Dialogkopf die Farbe ohnehin an
    noteColorWrap.hidden = !metaEditable;
    // Formular nur beim Bearbeiten sichtbar, Lese-Zusammenfassung nur im
    // Lese-Modus UND nur, wenn es ueberhaupt etwas zu zeigen gibt
    noteDetails.hidden = !editMode;
    noteViewSummary.hidden = editMode || !noteSummaryHasContent;
    if (editMode && noteCM) {
      noteCM.refresh(); // Spalte war ausgeblendet -> Masse neu messen
      noteCM.focus();
    }
  }

  // Verschieben (am Kopf) und Skalieren (unsichtbare Griffecke unten
  // rechts): beides wandelt die zentrierte Lage (inset:0 + margin:auto)
  // zuerst in feste left/top-Koordinaten um — beim Skalieren wuerde der
  // Dialog sonst symmetrisch wachsen und der Griff der Maus davonlaufen.
  // Kein Sprung: left/top = aktuelle Position; setNoteMode zentriert wieder.
  function pinNote() {
    // Der Farbwaehler haengt an einer festen Position im Dialog — beim
    // Verschieben/Skalieren wanderte er sonst nicht mit. (Er schliesst sonst
    // bei jedem Klick von selbst; hier unterdrueckt das preventDefault des
    // Ziehens aber das mousedown, auf das Coloris dafuer hoert.)
    if (window.Coloris) Coloris.close();
    var r = noteDlg.getBoundingClientRect();
    noteDlg.style.left = r.left + "px";
    noteDlg.style.top = r.top + "px";
    noteDlg.style.margin = "0";
    return r;
  }
  function noteDrag(handle, onMove) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      // Klicks auf Bedienelemente im Kopf (×) nicht kapern
      if (e.target.closest("button,a,input")) return;
      var r = pinNote();
      var sx = e.clientX, sy = e.clientY;
      function move(ev) { onMove(r, ev.clientX - sx, ev.clientY - sy); }
      function stop() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      }
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      e.preventDefault(); // sonst wuerde der Titeltext beim Ziehen markiert
    });
  }
  noteDrag(noteDlg.querySelector(".dialog-head"), function (r, dx, dy) {
    // Kopfzeile bleibt immer erreichbar: nie ganz aus dem Fenster schieben
    noteDlg.style.left = Math.max(80 - r.width,
      Math.min(r.left + dx, window.innerWidth - 80)) + "px";
    noteDlg.style.top = Math.max(8,
      Math.min(r.top + dy, window.innerHeight - 48)) + "px";
  });
  var noteResize = document.getElementById("note-resize");
  if (noteResize) noteDrag(noteResize, function (r, dx, dy) {
    // Untergrenzen zieht das CSS ein (min-width/min-height)
    noteDlg.style.width = (r.width + dx) + "px";
    noteDlg.style.height = (r.height + dy) + "px";
  });
  // bei jeder Groessenaenderung: CodeMirror neu vermessen und die vom
  // Nutzer gewaehlte Groesse merken (Inline-width setzt nur der UA-Resize
  // bzw. setNoteMode aus dem gemerkten Wert — CSS-Groessen nicht speichern)
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      if (!noteDlg.open) return;
      // CodeMirror muss nach jeder Breitenaenderung neu messen — im Lese-Modus
      // ist die Spalte ausgeblendet, dort waere es vergeblich
      if (noteCM && !noteDlg.classList.contains("note-view")) noteCM.refresh();
      // offsetWidth/-Height, NICHT getBoundingClientRect: der Dialog faehrt mit
      // transform:scale(.97) auf (siehe .dialog im CSS), und das Rechteck
      // enthaelt diese Skalierung. Waehrend der Oeffnen-Animation gemessen,
      // wanderten so bei JEDEM Oeffnen 3% Groesse in den Speicher — der Dialog
      // schrumpfte mit der Zeit. Die Layout-Masse kennen kein transform.
      if (noteDlg.style.width) {
        localStorage.setItem(groesseKey(),
          noteDlg.offsetWidth + "x" + noteDlg.offsetHeight);
      }
    }).observe(noteDlg);
  }
  if (noteEditBtn) {
    noteEditBtn.addEventListener("click", function () { setNoteMode(true); });
  }
  if (notePdfBtn) {
    // oeffnet das gerenderte PDF im OnlyOffice-Viewer — im SELBEN Tab
    // (wie das normale Datei-Oeffnen), nicht in einem neuen
    notePdfBtn.addEventListener("click", function () {
      if (noteExportUrl) window.location.assign(noteExportUrl);
    });
  }

  function openNote(title, content, action, canEdit, startEdit, meta, deleteUrl) {
    meta = meta || {
      isTodo: false, dueDate: "", people: { known: [], extra: [] },
      ort: "", color: "", status: "open",
    };
    ensureNoteEditor();
    mention.schliesse(); // eine offene @-Auswahl gehoert zur vorigen Notiz
    noteCanEdit = canEdit;
    noteDeleteUrl = deleteUrl || null;
    if (noteDelForm && noteDeleteUrl) {
      noteDelForm.action = noteDeleteUrl;
      noteDelForm.dataset.confirm = "„" + title
        + "“ wirklich löschen? Das lässt sich nicht rückgängig machen.";
    }
    noteTitleEl.textContent = title;
    noteForm.action = action;
    // PDF-Export nur fuer gespeicherte Notizen: die Save-Action traegt owner/rel.
    // Ziel liegt unter /edit/, damit Voltage den OnlyOffice-Kontext erkennt.
    noteExportUrl = action.indexOf("/notes/save/") !== -1
      ? action.replace("/notes/save/", "/edit/notepdf/") : null;
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

    // Formularfelder (Bearbeiten-Modus) befuellen: people speichert
    // Nutzernamen bekannter Nutzer + Freitext getrennt (siehe notemeta.js)
    var chips = [];
    (meta.people.known || []).forEach(function (uname) {
      var u = people.knownByUsername[uname];
      if (u) chips.push({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar });
    });
    (meta.people.extra || []).forEach(function (name) {
      chips.push({ username: null, name: name, hasAvatar: false });
    });
    people.setChips(chips);
    noteTodo.checked = meta.isTodo;
    noteDue.value = meta.dueDate || "";
    updateDueVisibility();
    noteOrt.value = meta.ort || "";
    noteColorInput.value = meta.color || "";
    onColorChanged();
    noteMetaBaseline = metaSnapshot();

    // Lese-Zusammenfassung aus denselben Daten bauen, dann erst den Modus
    // setzen — der blendet Formular/Zusammenfassung passend ein/aus
    noteSummaryHasContent = renderNoteSummary(noteViewSummary, meta, people.knownByUsername, baseUrl);
    setNoteMode(!!(startEdit && canEdit));

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

  bindMarkdownToolbar(function () { return noteCM; }, mdActions);

  // Emoji-Auswahl in der Werkzeugleiste
  initEmoji({
    getCM: function () { return noteCM; },
    textarea: noteText,
    button: document.getElementById("emoji-btn"),
    panel: document.getElementById("emoji-panel"),
  });

  // Alle "Neue Notiz"-Ausloeser: der Knopf im Board-Kopf und der Eintrag im
  // Anwendungs-Menue der Topbar. Beide tragen .note-new — ueber die Klasse
  // statt ueber eine id, weil es mehr als einen gibt.
  document.querySelectorAll(".note-new").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeMenus(); // falls der Ausloeser im Anwendungs-Menue sitzt
      openNote("Neue Notiz", "# Titel\n\n", noteCreateAction, true, true);
      // "Titel" vorselektieren: lostippen ersetzt das Platzhalterwort
      if (noteCM) noteCM.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 7 });
      else noteText.setSelectionRange(2, 7);
    });
  });

  return {
    openNote: openNote,
    knownByUsername: people.knownByUsername,
    // { open, tip, hide } — reicht notes.js nach, sobald die Hover-/Klick-
    // Bindung steht.
    setNoteHooks: function (h) { hooks = h || {}; },
  };
}
