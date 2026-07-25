// Hover ueber einem Notiz-Namen: gerenderte Vorschau als Kaertchen unter
// dem Namen (gleiche Verzoegerung wie Tooltips, Inhalt wird gecacht;
// nach dem Speichern laedt die Seite ohnehin neu -> Cache immer frisch).
// Bindet ausserdem das Klick-Oeffnen der .note-open-Elemente (Listenzeilen
// UND Desktop-Icons) — beides teilt sich dieselbe Zielmenge.
import { showNotice } from "../core/dialogs.js";
import { appendSummaryBadges } from "./summary.js";
import { externalizeLinks, renderMarkdown, highlightCode } from "./markdown.js";

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
    if (noteTip) noteTip.classList.remove("open");
  }
  window.addEventListener("scroll", hideNoteTip, true);

  // Gecachten Eintrag verwerfen, wenn sich eine Notiz geaendert hat, OHNE dass
  // die Seite neu geladen wurde. Genau das macht der Statuswechsel per
  // Kontextmenue (status.js) — ohne diesen Aufruf zeigte die Vorschau
  // hartnaeckig den alten Stand weiter.
  function invalidateNote(owner, rel) {
    delete noteTipCache[owner + "/" + rel];
  }

  function bindNoteOpen(root) {
    root.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("mouseleave", hideNoteTip);
      btn.addEventListener("mouseenter", function () {
        if (!noteTip || !window.marked || !window.DOMPurify) return;
        clearTimeout(noteTipTimer);
        noteTipTimer = setTimeout(function () {
          var rel = btn.dataset.rel.split("/").map(encodeURIComponent).join("/");
          var ownerPart = encodeURIComponent(btn.dataset.owner) + "/" + rel;
          var key = btn.dataset.owner + "/" + btn.dataset.rel;
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

    root.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        hideNoteTip();
        var rel = btn.dataset.rel.split("/").map(encodeURIComponent).join("/");
        var ownerPart = encodeURIComponent(btn.dataset.owner) + "/" + rel;
        Promise.all([
          fetch(baseUrl + "/notes/raw/" + ownerPart)
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
          fetch(baseUrl + "/notes/meta/" + ownerPart)
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
        ])
          .then(function (res) {
            openNote(btn.dataset.label,
              res[0],
              baseUrl + "/notes/save/" + ownerPart,
              btn.dataset.canedit === "1",
              false,
              res[1]);
          })
          .catch(function () {
            showNotice("Fehler", "Die Notiz konnte nicht geladen werden.", { danger: true });
          });
      });
    });
  }

  return {
    bindNoteOpen: bindNoteOpen,
    hideNoteTip: hideNoteTip,
    invalidateNote: invalidateNote,
  };
}
