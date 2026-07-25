// Markdown: Vorschau-Rendering (marked -> DOMPurify -> highlight.js) und die
// Editor-Toolbar (Toggle-Operationen auf der CodeMirror-Selektion).
if (window.marked) marked.use({ gfm: true, breaks: true });

// Links in gerendertem Markdown: externe (http/https/mailto) mit
// target=_blank versehen — Wrapper-Apps (z.B. Voltage) reichen _blank an
// den System-Browser durch, normale Navigation bliebe in der App haengen.
// Interne/relative Links und Anker wuerden mitten in der App auf
// Nirgendwo-Pfade navigieren -> href entfernen, sie werden reiner Text.
export function externalizeLinks(root) {
  root.querySelectorAll("a[href]").forEach(function (a) {
    if (/^(https?:|mailto:)/i.test(a.getAttribute("href"))) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else {
      a.removeAttribute("href");
    }
  });
}

// Markdown -> sanitiztes HTML; wirft, wenn der Parser scheitert (ungueltiges
// Markdown) oder marked/DOMPurify (noch) nicht geladen sind.
export function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) throw new Error("marked/DOMPurify nicht geladen");
  return DOMPurify.sanitize(marked.parse(text));
}

export function highlightCode(root) {
  if (!window.hljs) return;
  root.querySelectorAll("pre code").forEach(function (el) {
    hljs.highlightElement(el);
  });
}

// Markdown-Toolbar: Toggle-Operationen auf der CodeMirror-Selektion.
// Alle Aenderungen laufen ueber die CM-API -> change-Event -> Vorschau
// und Speichern-Zustand aktualisieren sich von selbst.
// getCM(): liefert die aktuelle CodeMirror-Instanz (kann anfangs null sein).
export function createMarkdownActions(getCM) {
  function mdWrap(marker) {
    var cm = getCM();
    if (!cm) return;
    var sel = cm.getSelection();
    if (sel.length >= 2 * marker.length && sel.startsWith(marker) && sel.endsWith(marker)) {
      cm.replaceSelection(sel.slice(marker.length, sel.length - marker.length), "around");
    } else if (sel) {
      cm.replaceSelection(marker + sel + marker, "around");
    } else {
      var cur = cm.getCursor();
      cm.replaceRange(marker + marker, cur);
      cm.setCursor({ line: cur.line, ch: cur.ch + marker.length });
    }
    cm.focus();
  }
  function mdEachLine(fn) { // fn(text) -> neuer Text, fuer alle selektierten Zeilen
    var cm = getCM();
    if (!cm) return;
    var from = cm.getCursor("from").line, to = cm.getCursor("to").line;
    cm.operation(function () {
      for (var l = from, i = 0; l <= to; l++, i++) {
        var t = cm.getLine(l);
        cm.replaceRange(fn(t, i), { line: l, ch: 0 }, { line: l, ch: t.length });
      }
    });
    cm.focus();
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
  return {
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
      var cm = getCM();
      if (!cm) return;
      var sel = cm.getSelection();
      if (sel) {
        cm.replaceSelection("```\n" + sel + "\n```", "around");
      } else {
        var cur = cm.getCursor();
        cm.replaceRange("```\n\n```", cur);
        cm.setCursor({ line: cur.line + 1, ch: 0 });
      }
      cm.focus();
    },
    link: function () {
      var cm = getCM();
      if (!cm) return;
      cm.replaceSelection("[" + (cm.getSelection() || "Text") + "](url)");
      var end = cm.getCursor();
      cm.setSelection({ line: end.line, ch: end.ch - 4 }, { line: end.line, ch: end.ch - 1 });
      cm.focus();
    },
    hr: function () {
      var cm = getCM();
      if (!cm) return;
      var cur = cm.getCursor();
      cm.replaceRange("\n---\n", { line: cur.line, ch: cm.getLine(cur.line).length });
      cm.focus();
    },
  };
}

export function bindMarkdownToolbar(getCM, actions) {
  document.querySelectorAll("#note-toolbar .note-tb").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cm = getCM();
      var fn = actions[btn.dataset.md];
      if (fn && cm && !cm.getOption("readOnly")) fn();
    });
  });
}
