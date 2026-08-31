// Emojis im Notiz-Editor: Kuerzel wie :) werden beim Tippen ersetzt, und ein
// Knopf in der Werkzeugleiste oeffnet eine Auswahl.
//
// Bewusst OHNE Fremdbibliothek: eine vollstaendige Namenstabelle (:tada: & Co.)
// waere rund 50 KB, die hier kuratierten Listen sind wenige Kilobyte. Das
// Emoji landet ECHT im Text — damit steht es auch im Titel, in der Dateiliste,
// auf dem Board und (spaeter) im PDF, nicht nur in der Vorschau.

// --- Kuerzel -> Emoji ---------------------------------------------------
// Nur die Klassiker, die man beim Schreiben wirklich tippt. Laengere Kuerzel
// zuerst pruefen (siehe emoticonAt), sonst schnappt ":)" vor ":-)" zu.
export var EMOTICONS = {
  ":-)": "🙂", ":)": "🙂", "=)": "🙂",
  ":-D": "😀", ":D": "😀",
  ";-)": "😉", ";)": "😉",
  ":-(": "🙁", ":(": "🙁",
  ":'(": "😢",
  ":-P": "😛", ":P": "😛", ":p": "😛",
  ":-O": "😮", ":O": "😮", ":o": "😮",
  ":-|": "😐", ":|": "😐",
  ":-/": "😕", ":/": "😕",
  ":-*": "😘", ":*": "😘",
  "8-)": "😎", "8)": "😎", "B)": "😎",
  "xD": "😆", "XD": "😆",
  "^^": "😊",
  ":@": "😠",
  "o_O": "😳", "O_o": "😳",
  "<3": "❤️", "</3": "💔",
  ":+1:": "👍", ":-1:": "👎",
};

// Kuerzel absteigend nach Laenge: ":-)" muss vor ":)" geprueft werden
var KEYS = Object.keys(EMOTICONS).sort(function (a, b) { return b.length - a.length; });

// Endet `text` auf einem Kuerzel, das am Wortanfang steht? Rueckgabe das
// Kuerzel oder null. Die Pruefung auf das Zeichen davor ist wichtig: sonst
// wuerde in "https://…" das ":/" ersetzt.
export function emoticonAt(text) {
  for (var i = 0; i < KEYS.length; i++) {
    var k = KEYS[i];
    if (text.slice(-k.length) !== k) continue;
    var before = text.charAt(text.length - k.length - 1);
    if (before === "" || /\s/.test(before)) return k;
  }
  return null;
}

// --- Auswahl-Palette ----------------------------------------------------
// Kuratiert statt vollstaendig: was eine Familie beim Notieren braucht.
export var EMOJI_GROUPS = [
  { name: "Gesichter", list: "😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 🤩 😎 🤓 🥳 🤗 🤔 😐 😴 😢 😭 😅 😂 🤣 😳 😱 😡 🤒 🤢 🥶 🥵".split(" ") },
  { name: "Gesten", list: "👍 👎 👌 ✌️ 🤞 👏 🙌 🙏 💪 🤝 👋 ✊ 🫶 ❤️ 💔 💖 ⭐ ✨ 🔥 💯".split(" ") },
  { name: "Menschen & Tiere", list: "👶 🧒 👩 👨 👵 👴 👪 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🦁 🐷 🐸 🐥 🦄 🐝 🐟 🐢 🦋".split(" ") },
  { name: "Essen", list: "🍎 🍌 🍓 🍒 🍇 🍉 🥕 🥦 🍞 🧀 🥚 🍗 🍕 🍔 🌭 🍟 🥗 🍝 🍰 🎂 🍪 🍫 🍬 ☕ 🍵 🥤 🍺 🍷".split(" ") },
  { name: "Aktivität", list: "⚽ 🏀 🎾 🏊 🚴 🏃 🧘 🎣 🎿 ⛺ 🎮 🎲 🎸 🎹 🎤 🎧 🎨 📚 ✏️ 🎬 🎉 🎈 🎁 🏆".split(" ") },
  { name: "Reise & Orte", list: "🚗 🚌 🚂 ✈️ 🚀 🚲 ⛵ 🏠 🏡 🏫 🏥 🏖️ ⛰️ 🌳 🌻 🌈 ☀️ ⛅ 🌧️ ❄️ ⛄ 🌙 🗺️ 📍".split(" ") },
  { name: "Dinge", list: "📱 💻 ⌚ 📷 💡 🔑 🔒 🧹 🧺 🛒 💊 💉 🩹 🧰 🔧 🔨 📦 ✉️ 📝 📅 📎 ✂️ 🧾 💶".split(" ") },
  { name: "Zeichen", list: "✅ ❌ ❗ ❓ ⚠️ ⏰ ⏳ 🔔 🔕 ➕ ➖ 🔴 🟠 🟡 🟢 🔵 🟣 ⬆️ ⬇️ ➡️ ⬅️ ♻️ ⚡ 🎯".split(" ") },
];

// Palette einmalig aufbauen (danach nur ein- und ausblenden)
function fillPanel(panel, onPick) {
  if (panel.dataset.filled) return;
  panel.dataset.filled = "1";
  EMOJI_GROUPS.forEach(function (group) {
    var h = document.createElement("div");
    h.className = "emoji-group-name";
    h.textContent = group.name;
    panel.appendChild(h);
    var grid = document.createElement("div");
    grid.className = "emoji-grid";
    group.list.forEach(function (ch) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "emoji-btn";
      b.textContent = ch;
      b.setAttribute("aria-label", ch);
      // mousedown statt click: der Editor verliert sonst zuerst den Fokus und
      // die Einfuegestelle waere weg
      b.addEventListener("mousedown", function (e) {
        e.preventDefault();
        onPick(ch);
      });
      grid.appendChild(b);
    });
    panel.appendChild(grid);
  });
}

// config: { getCM, textarea, button, panel }
// getCM liefert die CodeMirror-Instanz (kann null sein — dann Textarea).
export function initEmoji(config) {
  var button = config.button, panel = config.panel;
  var getCM = config.getCM, textarea = config.textarea;

  // --- Einfuegen an der Schreibmarke ---
  function insert(text) {
    var cm = getCM();
    if (cm) {
      cm.replaceSelection(text);
      cm.focus();
      return;
    }
    if (!textarea) return;
    var s = textarea.selectionStart, e = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, s) + text + textarea.value.slice(e);
    textarea.selectionStart = textarea.selectionEnd = s + text.length;
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // --- Auswahl oeffnen/schliessen ---
  if (button && panel) {
    // Befuellt wird NIE der Behaelter selbst: der traegt die Bildlaufleiste,
    // und OverlayScrollbars haengt seine Huelle da hinein (GRUNDREGEL in
    // js/core/scrollbars.js). Die Gruppen kommen in den Rumpf darin.
    var body = panel.querySelector(".emoji-panel-body") || panel;
    fillPanel(body, function (ch) {
      insert(ch);
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    // Klick daneben oder Escape schliesst
    document.addEventListener("click", function () {
      if (!panel.hidden) { panel.hidden = true; button.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });
  }
}

// Kuerzel-Ersetzung an eine CodeMirror-Instanz haengen. Getrennt von
// initEmoji(), weil der Editor erst beim ersten Oeffnen des Dialogs entsteht —
// note-dialog.js ruft das dort nach.
//
// Ausgeloest vom gerade getippten Leerzeichen/Umbruch: das davor stehende
// Kuerzel wird getauscht. So bleibt ein einzelner ":" unangetastet, und
// Rueckgaengig macht die Ersetzung mit einem Griff wieder rueckgaengig.
export function bindEmoticons(cm) {
  if (!cm || cm._emojiBound) return;
  cm._emojiBound = true;
  cm.on("inputRead", function (inst, change) {
    var typed = change.text && change.text[0];
    // nur ein Leerzeichen oder ein Zeilenumbruch loest aus
    var isBreak = change.text && change.text.length > 1;
    if (!isBreak && typed !== " ") return;
    var cur = inst.getCursor();
    // Text der Zeile bis VOR das gerade getippte Zeichen
    var line = inst.getLine(cur.line) || "";
    var upto = isBreak ? (inst.getLine(cur.line - 1) || "") : line.slice(0, cur.ch - 1);
    var key = emoticonAt(upto);
    if (!key) return;
    // In Code (`…` oder Codeblock) nichts ersetzen — dort ist ":)" gewollt
    var probeLine = isBreak ? cur.line - 1 : cur.line;
    var tok = inst.getTokenAt({ line: probeLine, ch: upto.length });
    if (tok && /comment|string/.test(tok.type || "")) return;
    var from = { line: probeLine, ch: upto.length - key.length };
    var to = { line: probeLine, ch: upto.length };
    inst.replaceRange(EMOTICONS[key], from, to);
  });
}
