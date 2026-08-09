// Hover ueber einem Notiz-Namen: gerenderte Vorschau als Kaertchen unter
// dem Namen (gleiche Verzoegerung wie Tooltips, Inhalt wird gecacht;
// nach dem Speichern laedt die Seite ohnehin neu -> Cache immer frisch).
// Bindet ausserdem das Klick-Oeffnen der .note-open-Elemente (Listenzeilen
// UND Desktop-Icons) — beides teilt sich dieselbe Zielmenge.
import { showNotice } from "../core/dialogs.js";
import { appendSummaryBadges } from "./summary.js";
import { externalizeLinks, renderMarkdown, highlightCode } from "./markdown.js";
import { bindDocLinks } from "./doclinks.js";
import { zeigeKarte, versteckeKarte } from "../core/card-tip.js";

// config: { baseUrl, openNote, knownByUsername }
// Rueckgabe: { bindNoteOpen, hideNoteTip, invalidateNote } — bindNoteOpen(root)
// ist root-skopiert (nach einem Ordnerwechsel bindet swapFolder nur die neuen
// Listenzeilen; die Desktop-Icons behalten ihre Bindung vom Erststart).
export function initHoverPreview(config) {
  var baseUrl = config.baseUrl;
  var openNote = config.openNote;
  var knownByUsername = config.knownByUsername;

  var noteTip = document.getElementById("note-tip");
  var noteTipCache = {};
  var noteTipTimer = null;
  function hideNoteTip() {
    clearTimeout(noteTipTimer);
    versteckeKarte(noteTip);
  }
  window.addEventListener("scroll", hideNoteTip, true);

  // Gecachten Eintrag verwerfen, wenn sich eine Notiz geaendert hat, OHNE dass
  // die Seite neu geladen wurde. Genau das macht der Statuswechsel per
  // Kontextmenue (status.js) — ohne diesen Aufruf zeigte die Vorschau
  // hartnaeckig den alten Stand weiter.
  function invalidateNote(owner, rel) {
    delete noteTipCache[owner + "/" + rel];
  }

  // Vorschau einer Notiz an einem beliebigen Anker zeigen (Listenzeile,
  // Desktop-Icon ODER ein Verweis im Notiztext). Die Verzoegerung steckt hier
  // drin, damit jeder Aufrufer sie gleich bekommt.
  function showNoteTip(anker, owner, rel) {
    if (!noteTip || !window.marked || !window.DOMPurify) return;
    clearTimeout(noteTipTimer);
    noteTipTimer = setTimeout(function () {
      var ownerPart = encodeURIComponent(owner) + "/" +
        rel.split("/").map(encodeURIComponent).join("/");
      var key = owner + "/" + rel;
      // Inhalt UND Metadaten laden (Meta ist optional -> Fehler schluckt der
      // Badge-Teil einfach); zusammen gecacht {text, meta}
      var loaded = noteTipCache[key] !== undefined
        ? Promise.resolve(noteTipCache[key])
        : Promise.all([
            fetch(baseUrl + "/notes/raw/" + ownerPart)
              .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
            fetch(baseUrl + "/notes/meta/" + ownerPart)
              .then(function (r) { return r.ok ? r.json() : null; })
              .catch(function () { return null; }),
          ]).then(function (res) {
            var data = { text: res[0], meta: res[1] };
            noteTipCache[key] = data;
            return data;
          });
      loaded.then(function (data) {
        noteTip.innerHTML = "";
        var body = document.createElement("div");
        body.className = "md-render";
        body.innerHTML = renderMarkdown(data.text);
        // ohne openNote: das Kaertchen verschwindet, sobald man es
        // ansteuert — hier sind Verweise reine Anzeige
        bindDocLinks(body, { baseUrl: baseUrl });
        externalizeLinks(body);
        highlightCode(body);
        noteTip.appendChild(body);
        // Meta-Badges als Fuss unten ins Kaertchen (nur, wenn gesetzt);
        // ~10% kleiner als in der Dialog-Lese-Ansicht
        if (data.meta) {
          var badges = document.createElement("div");
          badges.className = "note-tip-badges";
          if (appendSummaryBadges(badges, data.meta, knownByUsername, baseUrl, { avatar: 16, icon: 13 }))
            noteTip.appendChild(badges);
        }
        zeigeKarte(noteTip, anker);
      }).catch(function () { /* Vorschau ist optional — Fehler still schlucken */ });
    }, 350);
  }

  function bindNoteOpen(root) {
    root.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("mouseleave", hideNoteTip);
      btn.addEventListener("mouseenter", function () {
        showNoteTip(btn, btn.dataset.owner, btn.dataset.rel);
      });
    });

    root.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        hideNoteTip();
        ladeUndOeffne(btn.dataset.owner, btn.dataset.rel, btn.dataset.label, {
          canEdit: btn.dataset.canedit === "1",
          // Loeschen darf nur der Besitzer — canedit reicht nicht, das gilt
          // auch fuer eine mit Bearbeiten-Recht freigegebene Notiz.
          isOwner: btn.dataset.isowner === "1",
        });
      });
    });
  }

  // Notiz laden und im Dialog oeffnen. rechte ist optional: wo die Rechte am
  // Element stehen (Liste, Desktop, Suchtreffer), werden sie durchgereicht —
  // ein Verweis im Notiztext kennt sie nicht und laesst sie aus den Metadaten
  // ableiten. sharedBy liefert der Server NUR bei fremden Notizen und traegt
  // dann die Freigabestufe (siehe routes/notes.js).
  function ladeUndOeffne(owner, rel, label, rechte) {
    var ownerPart = encodeURIComponent(owner) + "/" +
      rel.split("/").map(encodeURIComponent).join("/");
    Promise.all([
      fetch(baseUrl + "/notes/raw/" + ownerPart)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
      fetch(baseUrl + "/notes/meta/" + ownerPart)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ])
      .then(function (res) {
        var meta = res[1];
        var isOwner = rechte ? rechte.isOwner : !meta.sharedBy;
        var canEdit = rechte ? rechte.canEdit
          : (isOwner || meta.sharedBy.perm === "edit");
        openNote(label, res[0], baseUrl + "/notes/save/" + ownerPart,
          canEdit, false, meta,
          isOwner ? baseUrl + "/delete/" + ownerPart : null);
      })
      .catch(function () {
        showNotice("Fehler", "Die Notiz konnte nicht geladen werden.", { danger: true });
      });
  }

  return {
    bindNoteOpen: bindNoteOpen,
    hideNoteTip: hideNoteTip,
    invalidateNote: invalidateNote,
    // Vorschau an einem fremden Anker zeigen — fuer Verweise im Notiztext
    showNoteTip: showNoteTip,
    // Notiz allein ueber Besitzer und Pfad oeffnen — fuer Verweise im
    // Notiztext, die kein Element mit Rechte-Angaben hinter sich haben.
    openNoteByPath: function (owner, rel, label) {
      hideNoteTip();
      ladeUndOeffne(owner, rel, label, null);
    },
  };
}
