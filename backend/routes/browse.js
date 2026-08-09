// Browser-UI: Startseite (Dateiliste mit Ordnernavigation) und alle
// Datei-/Ordner-Aktionen des eingeloggten Nutzers inkl. Freigaben.
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const users = require("../users");
const avatars = require("../avatars");
const doclang = require("../doclang");
const settings = require("../settings");
const shares = require("../shares");
const notemeta = require("../notemeta");
const twofactor = require("../twofactor");
const protokoll = require("../eventlog");
const notifications = require("../notifications");
const noteicon = require("../noteicon");
const { accessFor } = require("../access");
const { secureFilename, securePath, encPath, dirFor, pathFor, walkDirs, walkFiles } = require("../storage");
const { BLANKS, BASE, DOCTYPE, IMAGE_TYPES, MAX_UPLOAD_MB } = require("../config");
const { formatDate, formatDuration } = require("../format");
const { loginRequired } = require("./auth");

const router = express.Router();

// Fenster des "Desktops", deren Lage/Zustand je Nutzer gemerkt wird
// (desktop_layout). Neue Ansicht -> hier eintragen.
const WINDOW_KEYS = ["page", "board"];

// Dateiendung -> Typ-Icon in /static/img/ (verwandte Formate teilen sich eins)
function iconFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["xlsx", "xls", "ods", "csv"].includes(ext)) return "xlsx";
  if (["pptx", "ppt", "odp"].includes(ext)) return "pptx";
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "note";
  if (IMAGE_TYPES[ext]) return "image"; // nur Rueckfall, sonst zeigt die Liste
  return "docx"; // Standard (Textdokumente und Unbekanntes)
}

// Bilder bekommen in der Liste ein echtes Vorschaubild und oeffnen einen
// Vorschau-Dialog statt OnlyOffice (das kann mit Bildern nichts anfangen).
function isImageName(name) {
  return !!IMAGE_TYPES[(name.split(".").pop() || "").toLowerCase()];
}

// Notizen heissen {uuid}-{Titel}.md — angezeigt (Liste, Dialoge, Rueckfragen)
// wird nur der Titel; alle Links/Aktionen laufen weiter ueber den vollen Namen
const NOTE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.*)\.md$/i;
function labelFromName(name) {
  // Immer nur der Dateiname: hier kommt teils der volle relative Pfad an
  // (Datei in einem Unterordner). Ohne basename stand in der Liste
  // "Steuer/Nebenkosten.xlsx" statt "Nebenkosten.xlsx".
  const base = path.basename(name);
  const m = base.match(NOTE_RE);
  // Unterstriche stammen aus secureFilename (Leerzeichen im Titel) —
  // fuer die Anzeige wieder zu Leerzeichen
  return m ? (m[1].replace(/_/g, " ") || "Notiz") : base;
}

// Anzeigename einer Notiz. Der Dateiname traegt nur ASCII (secureFilename),
// darum steht der echte Titel — mit Emojis, Umlauten, ss — in note_meta.title.
// Ohne gespeicherten Titel (Notizen von vor dieser Spalte) faellt es auf den
// Dateinamen zurueck, so bleibt Altbestand lesbar.
// metaTitle ist optional: wer das Meta ohnehin schon geladen hat, reicht es
// durch und spart den zweiten Datenbankzugriff.
function labelFor(name, owner, metaTitle) {
  if (metaTitle) return metaTitle;
  if (owner !== undefined && /\.md$/i.test(name)) {
    const t = notemeta.get(owner, name).title;
    if (t) return t;
  }
  return labelFromName(name);
}

// Dateigroesse menschenlesbar (deutsche Schreibweise: Komma als Dezimaltrenner)
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("de-DE", { maximumFractionDigits: 1 })} KB`;
  return `${(kb / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

// Notiz-Angaben fuer die Dateiliste, aus EINEM Meta-Zugriff: das ToDo-Badge
// (nur bei aktivem Schalter) und die Icon-Farbe (dieselbe wie auf dem
// Desktop — eine Notiz sieht ueberall gleich aus). "" = Standardfarbe.
function noteInfoFor(owner, relpath, isNote) {
  if (!isNote) return { todo: null, noteColor: "" };
  const m = notemeta.get(owner, relpath);
  const [y, mo, d] = (m.dueDate || "").split("-");
  return {
    todo: m.isTodo ? {
      dueLabel: y ? `${d}.${mo}.${y}` : "",
      overdue: !!m.dueDate && m.dueDate < new Date().toISOString().slice(0, 10),
    } : null,
    noteColor: m.color || "",
    noteDark: notemeta.isDark(m.color),
  };
}

// Notiz-Icons fuer den "Desktop" (freie Bereiche neben der Liste): alle als
// ToDo markierten Notizen — eigene UND geteilte — global (ordnerunabhaengig),
// jeweils mit gemerkter Position (falls der Nutzer das Icon verschoben hat).
function desktopNotesFor(me) {
  // Je Nutzer abschaltbar (Mein Konto). Aus heisst: gar nichts liefern — die
  // Notizen selbst bleiben unberuehrt, sie liegen weiter im Board und in der
  // Liste, und die gemerkten Icon-Positionen ueberstehen das Ausschalten.
  const u = users.get(me);
  if (u && !u.desk_notes) return [];
  const posRows = notemeta.desktopPositions(me);
  const posOf = (owner, filename) => {
    const r = posRows.find((p) => p.owner === owner && p.filename === filename);
    return r ? { x: r.x, y: r.y } : null;
  };
  const out = [];
  // status: Erledigte Icons bleiben liegen, werden aber gedaempft dargestellt
  // (index.css) — und das Kontextmenue braucht den aktuellen Wert
  const add = (owner, filename, canedit, color, status, title) => {
    if (!/\.md$/i.test(filename) || !fs.existsSync(pathFor(owner, filename))) return;
    out.push({
      owner, relpath: filename, label: labelFor(filename, owner, title), canedit,
      isOwner: owner === me, // fremde Notizen bekommen das Freigabe-Overlay
      pos: posOf(owner, filename), color: color || "", dark: notemeta.isDark(color),
      status: notemeta.normalizeStatus(status),
    });
  };
  // eigene ToDo-Notizen (alle Ordner)
  notemeta.listTodos(me).forEach((n) => add(me, n.filename, true, n.color, n.status, n.title));
  // an mich freigegebene ToDo-Notizen
  shares.listForUser(me).forEach((s) => {
    const m = notemeta.get(s.owner, s.filename);
    if (m.isTodo) add(s.owner, s.filename, s.perm === "edit", m.color, m.status, m.title);
  });
  return out;
}

// Notizen fuers Board: ALLE sichtbaren (eigene + freigegebene), unabhaengig
// vom ToDo-Schalter — jede Notiz hat einen Bearbeitungsstand. Gruppiert nach
// Status, damit das Template nur noch ausgeben muss.
//
// Sortierung je Spalte: faellige ToDos zuerst (naechster Termin oben), dann
// alles uebrige alphabetisch. So springt das Dringende ins Auge.
function boardNotesFor(me) {
  const seen = new Set();
  const cols = { open: [], wip: [], closed: [] };
  const add = (owner, filename, canedit) => {
    const key = `${owner}/${filename}`;
    if (seen.has(key)) return;                              // Doppel vermeiden
    if (!/\.md$/i.test(filename)) return;
    if (!fs.existsSync(pathFor(owner, filename))) return;   // verwaiste Freigabe
    seen.add(key);
    const m = notemeta.get(owner, filename);
    const [y, mo, d] = (m.dueDate || "").split("-");
    cols[m.status].push({
      owner, relpath: filename, label: labelFor(filename, owner, m.title), canedit,
      isOwner: owner === me, // fuer den Filter "Nur eigene Notizen"
      color: m.color || "", dark: notemeta.isDark(m.color), status: m.status,
      isTodo: m.isTodo, dueDate: m.dueDate || "",
      dueLabel: y ? `${d}.${mo}.${y}` : "",
      overdue: !!m.dueDate && m.dueDate < new Date().toISOString().slice(0, 10),
    });
  };
  // eigene Notizen: ueber alle Ordner hinweg (das Board ist ordnerunabhaengig)
  walkFiles(dirFor(me)).forEach((rel) => add(me, rel, true));
  // an mich freigegebene Notizen
  shares.listForUser(me).forEach((s) => add(s.owner, s.filename, s.perm === "edit"));

  const byName = (a, b) => a.label.localeCompare(b.label, "de", { sensitivity: "base" });
  Object.values(cols).forEach((list) => list.sort((a, b) => {
    // datierte ToDos ganz nach oben, nach Termin; danach der Rest nach Titel
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || byName(a, b);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return byName(a, b);
  }));
  return cols;
}

// Offene Nachrichten fuer die Kopfzeile: wer hat mir was wann freigegeben.
// Zeigt eine Nachricht auf etwas, das es nicht mehr gibt oder worauf der
// Zugriff entzogen wurde, wird sie hier gleich entsorgt — so bleibt die Liste
// auch dann sauber, wenn eine Aufraeum-Stelle einmal vergessen wird.
function notificationsFor(me) {
  return notifications.listFor(me).map((n) => {
    if (!accessFor(me, n.owner, n.filename)) {
      notifications.markRead(me, n.id);
      return null;
    }
    const u = users.get(n.owner);
    return {
      id: n.id, owner: n.owner, relpath: n.filename,
      ownerName: u ? u.display_name : n.owner,
      label: labelFor(n.filename, n.owner),
      perm: n.perm,
      when: formatDate(n.created),
    };
  }).filter(Boolean);
}

// zurueck in den Ordner, aus dem eine Aktion kam (Formulare schicken `dir` mit)
function redirectDir(req, res) {
  const d = securePath(req.body && req.body.dir || "");
  res.redirect(d ? `${BASE}/?p=${encodeURIComponent(d)}` : `${BASE}/`);
}

// --- Startseite -------------------------------------------------------
// ?p=<unterordner> navigiert in den eigenen Unterordner; freigegebene Dateien
// anderer Nutzer erscheinen nur auf der obersten Ebene.
router.get("/", loginRequired, (req, res) => {
  // Zurueck-Navigation soll die Liste frisch vom Server holen, nicht aus dem
  // HTTP-Cache — sonst fehlen gerade erstellte/geloeschte Dateien
  res.set("Cache-Control", "no-store");
  const me = req.session.user;
  const row = users.get(me);
  const userDir = dirFor(me);
  // Admin-Zugaenge arbeiten ausschliesslich administrativ — sie sind keine
  // Empfaenger von Freigaben und tauchen deshalb in keiner Auswahl auf.
  // Dieselbe Regel serverseitig in POST /share (Auswahl allein waere nur eine
  // ausgeblendete Schaltflaeche).
  const otherUsers = users.listUsers()
    .filter((u) => u.username !== me && !u.is_admin);
  const hiddenLangs = settings.get("hidden_langs", []);

  const cur = securePath(req.query.p || "");
  const curAbs = cur ? path.join(userDir, cur) : userDir;
  if (cur === null || !fs.existsSync(curAbs) || !fs.statSync(curAbs).isDirectory())
    return res.redirect(`${BASE}/`);

  // owner + relpath werden fuer den Anzeigenamen gebraucht: der echte Titel
  // einer Notiz steht in note_meta, und der Schluessel dort ist der Pfad
  // RELATIV zum Nutzerordner — nicht der blosse Dateiname.
  const meta = (name, p, owner, relpath) => {
    const st = fs.statSync(p);
    return {
      name, label: labelFor(relpath, owner), isNote: /\.md$/i.test(name),
      isImage: isImageName(name),
      icon: iconFor(name), sizeBytes: st.size, mtime: st.mtimeMs,
      size: formatSize(st.size), modified: formatDate(st.mtimeMs),
    };
  };

  const entries = fs.readdirSync(curAbs, { withFileTypes: true });

  // Unterordner im aktuellen Ordner
  const folders = entries.filter((e) => e.isDirectory()).map((e) => {
    const st = fs.statSync(path.join(curAbs, e.name));
    return {
      name: e.name, label: e.name, relpath: cur ? `${cur}/${e.name}` : e.name, isDir: true,
      icon: "folder", sizeBytes: -1, size: "—", mtime: st.mtimeMs,
      modified: formatDate(st.mtimeMs),
      owner: me, ownerName: req.session.name, isOwner: true, perm: "owner",
      shares: [], availableUsers: [],
    };
  });

  // eigene Dateien im aktuellen Ordner (mit ihren Freigaben) ...
  const own = entries.filter((e) => e.isFile()).map((e) => {
    const relpath = cur ? `${cur}/${e.name}` : e.name;
    // hasAvatar je Empfaenger: der Freigabe-Tooltip zeigt Avatar + Name + Recht
    const sh = shares.listForFile(me, relpath)
      .map((s) => ({ ...s, hasAvatar: avatars.has(s.target) }));
    const m = meta(e.name, path.join(curAbs, e.name), me, relpath);
    return {
      ...m,
      relpath, isDir: false,
      owner: me, ownerName: req.session.name, isOwner: true, perm: "owner",
      shares: sh,
      availableUsers: otherUsers.filter((u) => !sh.some((s) => s.target === u.username)),
      ...noteInfoFor(me, relpath, m.isNote),
    };
  });

  // ... plus die mir freigegebenen (liegen physisch beim Besitzer) — nur oben
  const shared = cur ? [] : shares.listForUser(me).map((s) => {
    const p = pathFor(s.owner, s.filename);
    if (!fs.existsSync(p)) return null;   // Karteileiche: Datei wurde geloescht
    const m = meta(s.filename, p, s.owner, s.filename);
    return {
      ...m,
      relpath: s.filename, isDir: false,
      owner: s.owner, ownerName: s.owner_name, isOwner: false, perm: s.perm,
      shares: [], availableUsers: [],
      ...noteInfoFor(s.owner, s.filename, m.isNote),
    };
  }).filter(Boolean);

  const files = own.concat(shared);

  // Sortierung aus der URL; Default: Änderungsdatum absteigend. Ordner stehen
  // immer vor den Dateien, beide Gruppen sortieren gleich.
  const sort = ["name", "size", "date"].includes(req.query.sort) ? req.query.sort : "date";
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const cmp = {
    // nach dem ANGEZEIGTEN Namen sortieren — Notizen also nach Titel, nicht UUID
    name: (a, b) => a.label.localeCompare(b.label, "de", { sensitivity: "base" }),
    size: (a, b) => a.sizeBytes - b.sizeBytes,
    date: (a, b) => a.mtime - b.mtime,
  }[sort];
  for (const list of [folders, files]) {
    list.sort(cmp);
    if (dir === "desc") list.reverse();
  }

  // Spaltenköpfe als Sortier-Links aufbereiten (nächste Richtung + Pfeil)
  const pParam = cur ? `&p=${encodeURIComponent(cur)}` : "";
  const defaultDir = { name: "asc", size: "desc", date: "desc" };
  const columns = [
    { key: "name", label: "Datei", cls: "" },
    { key: "size", label: "Größe", cls: "col-size" },
    { key: "date", label: "Geändert", cls: "col-date" },
  ].map((c) => {
    const active = sort === c.key;
    const nextDir = active ? (dir === "asc" ? "desc" : "asc") : defaultDir[c.key];
    return {
      label: c.label, cls: c.cls, active,
      href: `${BASE}/?sort=${c.key}&dir=${nextDir}${pParam}`,
      arrow: active ? (dir === "asc" ? "▲" : "▼") : "",
    };
  });

  // Brotkrumen: "Meine Dateien / steuern / 2026"
  const crumbs = [{ label: "Meine Dateien", href: `${BASE}/` }];
  cur.split("/").filter(Boolean).reduce((prefix, seg) => {
    const rel = prefix ? `${prefix}/${seg}` : seg;
    crumbs.push({ label: seg, href: `${BASE}/?p=${encodeURIComponent(rel)}` });
    return rel;
  }, "");

  res.render("index", {
    files: folders.concat(files),
    columns,
    crumbs,
    curDir: cur,
    // frei platzierbare Notiz-Icons neben der Liste (ordnerunabhaengig sichtbar)
    // Schalter aus "Mein Konto": liegen die Notiz-Icons auf dem Desktop?
    deskNotes: !!(users.get(me) || {}).desk_notes,
    // <symbol> der Notiz-Icons, erzeugt aus public/img/note.svg
    noteSymbol: noteicon.symbolMarkup(),
    desktopNotes: desktopNotesFor(me),
    // gemerkte Position der frei verschiebbaren Dokumentenliste (oder null)
    pageLayout: notemeta.getLayout(me, "page"),
    // Notiz-Board: alle sichtbaren Notizen nach Bearbeitungsstand gruppiert,
    // plus die gemerkte Fensterlage (Default: eingeklappt, siehe board.ejs)
    boardNotes: boardNotesFor(me),
    boardLayout: notemeta.getLayout(me, "board"),
    // offene Benachrichtigungen (Glocke am Avatar + Uebersicht)
    notifications: notificationsFor(me),
    allDirs: walkDirs(userDir).sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" })),
    user: req.session.name,
    me,
    hasAvatar: avatars.has(me),
    // Personen-Auswahl im Notiz-Dialog: alle Nutzer AUSSER Admins (die
    // arbeiten nur administrativ) — anders als bei otherUsers ist man selbst
    // hier dabei. hasAvatar fuer die minimalistische Lese-Ansicht.
    knownUsers: users.listUsers().filter((u) => !u.is_admin).map((u) => (
      { username: u.username, display_name: u.display_name, hasAvatar: avatars.has(u.username) }
    )),
    // Dateiauswahl beim Hochladen auf die Formate begrenzen, die der Editor
    // oeffnen kann — abgeleitet aus DOCTYPE, bleibt also automatisch synchron
    uploadAccept: [...Object.keys(DOCTYPE), ...Object.keys(IMAGE_TYPES)]
      .map((e) => "." + e).join(","),
    maxUploadMb: MAX_UPLOAD_MB,
    // Sprachauswahl im "Neue Datei"-Dialog: Woerterbuch-Sprachen des DS,
    // minus die vom Admin ausgeblendeten (Einstellungen-Dialog)
    docLangs: doclang.LANGS.filter((l) => !hiddenLangs.includes(l.code)),
    docLangDefault: doclang.DEFAULT,
    // fuer den Einstellungen-Dialog (nur Admins): komplette Liste + Status
    settingsLangs: row.is_admin
      ? doclang.LANGS.map((l) => ({ ...l, hidden: hiddenLangs.includes(l.code) }))
      : [],
    // einmalig: fehlgeschlagene Passwort-Aenderung -> Feld markieren,
    // Dialog + Abschnitt wieder oeffnen (index.ejs/index.js)
    pwError: (() => { const e = req.session.pwError || null; delete req.session.pwError; return e; })(),
    email: row.email || "",
    emailError: (() => { const e = !!req.session.emailError; delete req.session.emailError; return e; })(),
    isAdmin: !!row.is_admin,
    // Ereignisprotokoll fuer den Admin-Dialog (eventlog.js). Zeit hier schon
    // formatiert, damit die Vorlage nichts rechnen muss.
    events: row.is_admin
      ? protokoll.letzte(200).map((e) => ({ ...e, zeit: formatDate(e.at) }))
      : [],
    eventTage: protokoll.TAGE,
    // Zustand der zweiten Stufe fuer den Konto-Dialog (nur Admins betroffen)
    zweiFaktor: row.is_admin ? {
      aktiv: !!row.totp_active,
      codes: row.totp_active ? twofactor.offeneCodes(me) : 0,
      geraete: row.totp_active ? twofactor.geraeteZahl(me) : 0,
      tage: twofactor.TAGE_VERTRAUEN,
    } : null,
    // letzter Backup-Lauf (nur Admins) fuer den Backup-Dialog: Zeitpunkt,
    // Dauer, Erfolg + rsync-Log (routes/admin.js /backup/run)
    lastBackup: (() => {
      if (!row.is_admin) return null;
      const b = settings.get("last_backup", null);
      return b && { ...b, atStr: formatDate(b.at), durationStr: formatDuration(b.durationMs) };
    })(),
    // Nutzerverwaltung (nur Admins): Avatar-Flag und belegter Speicherplatz je
    // Nutzer — Familienmassstab, das rekursive Aufsummieren ist billig genug
    allUsers: !row.is_admin ? [] : users.listUsers().map((u) => {
      const dir = dirFor(u.username);
      const bytes = walkFiles(dir)
        .reduce((sum, rel) => sum + fs.statSync(path.join(dir, rel)).size, 0);
      return { ...u, hasAvatar: avatars.has(u.username), size: formatSize(bytes) };
    }),
    // Das Token selbst liegt nur noch als Pruefsumme in der DB und kann
    // deshalb nicht mehr angezeigt werden. Direkt nach dem Erzeugen steht es
    // einmalig in der Sitzung — danach nie wieder (users.js: hashToken).
    freshToken: (() => {
      const t = req.session.freshToken || null; delete req.session.freshToken; return t;
    })(),
  });
});

// Position eines frei verschiebbaren UI-Elements merken (aktuell nur die
// Dokumentenliste, key="page") — je Nutzer
// minimized (optional) klappt die Karte zum Taskleisten-Icon ein. Position
// wird immer mitgeschickt, damit sie beim Wiederherstellen erhalten bleibt.
router.post("/desktop/layout", loginRequired, express.json(), (req, res) => {
  const b = req.body || {};
  const key = String(b.key || "");
  const x = Number(b.x), y = Number(b.y);
  // Whitelist statt freier Schluessel: jedes Fenster des Desktops hat einen
  // festen Namen (js/core/window.js). Weitere Ansichten hier ergaenzen.
  if (!WINDOW_KEYS.includes(key) || !Number.isFinite(x) || !Number.isFinite(y))
    return res.sendStatus(400);
  notemeta.setLayout(req.session.user, key, x, y, b.minimized === true);
  res.sendStatus(204);
});

// --- Benachrichtigungen ----------------------------------------------
// Gelesen = geloescht (Nutzerwunsch). Beide Routen wirken ausschliesslich auf
// die Nachrichten des angemeldeten Nutzers — die Pruefung steckt in
// notifications.js (username im WHERE).
router.post("/notifications/read", loginRequired, express.json(), (req, res) => {
  const id = Number((req.body || {}).id);
  if (!Number.isInteger(id)) return res.sendStatus(400);
  notifications.markRead(req.session.user, id);
  res.sendStatus(204);
});

router.post("/notifications/read-all", loginRequired, (req, res) => {
  const n = notifications.markAllRead(req.session.user);
  req.flash("ok", n ? `${n} Nachricht(en) als gelesen markiert.` : "Keine Nachrichten.");
  res.redirect(`${BASE}/`);
});

// --- Freigaben verwalten (nur eigene Dateien) ------------------------
router.post("/share/*", loginRequired, (req, res) => {
  const me = req.session.user;
  const fid = req.params[0];
  const target = (req.body.target || "").trim();
  const perm = req.body.perm === "view" ? "view" : "edit";

  if (accessFor(me, me, fid) !== "owner") {
    req.flash("err", "Datei nicht gefunden.");
  } else if (!target || target === me || !users.get(target)) {
    req.flash("err", "Unbekannter Nutzer.");
  } else if (users.get(target).is_admin) {
    // Nicht "Unbekannter Nutzer": der Absender kennt den Namen ja: er hat ihn
    // eingetragen. Eine klare Auskunft ist hier hilfreicher als Nebel.
    req.flash("err", "Verwaltungszugänge können keine Freigaben empfangen.");
  } else {
    shares.share(me, fid, target, perm);
    // Empfaenger beim naechsten Laden darueber informieren
    notifications.add(target, me, fid, perm);
    const who = users.get(target).display_name;
    const what = perm === "edit" ? "bearbeiten" : "nur lesen";
    req.flash("ok", `„${fid}“ für ${who} freigegeben (${what}).`);
  }
  redirectDir(req, res);
});

router.post("/unshare/*", loginRequired, (req, res) => {
  const me = req.session.user;
  const fid = req.params[0];
  const target = (req.body.target || "").trim();
  // Nachricht zuerst weg: sie zeigte sonst auf etwas, das der Empfaenger
  // nicht mehr sehen darf
  notifications.removeForShare(me, fid, target);
  if (shares.unshare(me, fid, target)) {
    const u = users.get(target);
    req.flash("ok", `Freigabe von „${fid}“ für ${u ? u.display_name : target} entzogen.`);
  } else {
    req.flash("err", "Freigabe nicht gefunden.");
  }
  redirectDir(req, res);
});

// --- Dateien und Ordner ----------------------------------------------
router.post("/create", loginRequired, (req, res) => {
  const name = (req.body.name || "").trim();
  const ext = req.body.ext;
  const cur = securePath(req.body.dir || "");
  if (!BLANKS[ext] || cur === null) return res.sendStatus(400);
  // Der Zielordner kommt aus einer Auswahl im Dialog und muss darum nicht mehr
  // der Ordner sein, den man gerade ansieht — er kann inzwischen geloescht
  // worden sein (anderer Tab, anderes Geraet). Ohne diese Pruefung liefe das
  // copyFileSync unten in ENOENT und der Nutzer saehe einen Serverfehler.
  if (cur && !fs.existsSync(pathFor(req.session.user, cur))) {
    req.flash("err", `Den Ordner „${cur}“ gibt es nicht mehr.`);
    return res.redirect(`${BASE}/`);
  }
  const base = secureFilename(`${name}.${ext}`);
  if (!name || base === `.${ext}`) {
    req.flash("err", "Bitte einen Dateinamen angeben.");
    return redirectDir(req, res);
  }
  const fid = cur ? `${cur}/${base}` : base;
  const p = pathFor(req.session.user, fid);
  if (fs.existsSync(p)) {
    req.flash("err", `„${base}“ existiert schon.`);
    return redirectDir(req, res);
  }
  fs.copyFileSync(BLANKS[ext], p);
  // gewaehlte Dokumentsprache in die Kopie schreiben (Blanks sind de-DE);
  // unbekannte Codes ignoriert doclang.apply — dann bleibt es bei Deutsch.
  // Vom Admin ausgeblendete Sprachen zaehlen serverseitig ebenfalls nicht.
  const lang = req.body.lang || "";
  doclang.apply(p, ext, settings.get("hidden_langs", []).includes(lang) ? "" : lang);
  res.redirect(`${BASE}/edit/${encodeURIComponent(req.session.user)}/${encPath(fid)}`);
});

// --- Suche ------------------------------------------------------------
// Autovervollstaendigung im Anwendungs-Menue: sucht in den ANZEIGENAMEN aller
// Dateien, die der Anfragende sehen darf — eigene (ueber alle Ordner hinweg)
// plus die ihm freigegebenen. Nie darueber hinaus: die Liste wird aus
// dirFor(me) und shares.listForUser(me) gebaut, ein fremder Pfad kann also gar
// nicht erst hineingeraten.
//
// Die Antwort traegt je Treffer schon alles, was die Oberflaeche zum Oeffnen
// braucht — und zwar in denselben Feldern, die auch die Dateiliste benutzt
// (js/search.js haengt daraus .note-open/.image-open bzw. einen /edit-Link).

// Vergleichsform: Kleinschreibung ohne diakritische Zeichen, damit
// "prasentation" auch "Präsentation" findet.
function searchNorm(s) {
  return s.normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // zerlegte Akzente wegwerfen: ä -> a
    .replace(/ß/g, "ss")            // wird nicht zerlegt, aber gerne "ss" getippt
    .toLowerCase();
}

const SEARCH_MAX = 12;

router.get("/search", loginRequired, (req, res) => {
  const me = req.session.user;
  const q = searchNorm(String(req.query.q || "").trim());
  if (!q) return res.json([]);

  const hits = [];
  const seen = new Set();
  const add = (owner, relpath, ownerName, canedit) => {
    const key = `${owner}/${relpath}`;
    if (seen.has(key)) return;
    const abs = pathFor(owner, relpath);
    if (!fs.existsSync(abs)) return;          // verwaiste Freigabe
    const name = path.basename(relpath);
    const label = labelFor(relpath, owner);
    const pos = searchNorm(label).indexOf(q);
    if (pos === -1) return;
    seen.add(key);
    const dir = path.dirname(relpath);
    hits.push({
      owner, relpath, label,
      isNote: /\.md$/i.test(name),
      isImage: isImageName(name),
      icon: iconFor(name),
      canedit,
      // Woher stammt der Treffer? Bei eigenen der Ordner, bei fremden der
      // Besitzer — beides beantwortet "welches von den gleichnamigen ist es?"
      hint: ownerName || (dir === "." ? "" : dir),
      // Treffer am Wortanfang zuerst, dann alphabetisch
      _pos: pos,
    });
  };

  walkFiles(dirFor(me)).forEach((rel) => add(me, rel, "", true));
  shares.listForUser(me).forEach((s) => add(s.owner, s.filename, s.owner_name, s.perm === "edit"));

  hits.sort((a, b) => a._pos - b._pos
    || a.label.localeCompare(b.label, "de", { sensitivity: "base" }));
  res.json(hits.slice(0, SEARCH_MAX).map((h) => {
    delete h._pos;
    // Links erst hier bauen — so steht die Pfadkodierung an genau einer Stelle
    const p = `${encodeURIComponent(h.owner)}/${encPath(h.relpath)}`;
    return h.isImage
      ? { ...h, src: `${BASE}/image/${p}`, download: `${BASE}/download/${p}` }
      : (h.isNote ? h : { ...h, href: `${BASE}/edit/${p}` });
  }));
});

// Kurzinfo zu EINER Datei — fuer das Hover-Kaertchen an Verweisen im Notiztext
// (public/js/files/file-tip.js). Notizen brauchen das nicht: die zeigen dort
// ihre gewohnte Inhaltsvorschau ueber /notes/raw + /notes/meta.
router.get("/fileinfo/:owner/*", loginRequired, (req, res) => {
  const me = req.session.user;
  const owner = req.params.owner, fid = req.params[0];
  const acc = accessFor(me, owner, fid);
  if (!acc) return res.sendStatus(404);
  const abs = pathFor(owner, fid);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.sendStatus(404);

  const st = fs.statSync(abs);
  const name = path.basename(fid);
  const info = {
    label: labelFor(fid, owner), icon: iconFor(name),
    size: formatSize(st.size), modified: formatDate(st.mtimeMs),
    isOwner: owner === me,
  };
  // Wer die Datei nicht besitzt, erfaehrt nur, VON WEM er sie hat — nicht, wer
  // sie sonst noch bekommen hat. Die Empfaengerliste gehoert dem Besitzer;
  // dieselbe Aufteilung wie bei den Badges der Dateiliste.
  if (info.isOwner) {
    info.shares = shares.listForFile(owner, fid).map((s) => ({
      username: s.target, name: s.display_name, perm: s.perm,
      hasAvatar: avatars.has(s.target),
    }));
  } else {
    const u = users.get(owner);
    info.sharedBy = {
      username: owner, name: u ? u.display_name : owner, perm: acc,
      hasAvatar: avatars.has(owner),
    };
  }
  res.json(info);
});

// neuer Unterordner im aktuellen Ordner
router.post("/mkdir", loginRequired, (req, res) => {
  const cur = securePath(req.body.dir || "");
  const name = secureFilename((req.body.name || "").trim());
  if (cur === null) return res.sendStatus(400);
  if (!name) {
    req.flash("err", "Bitte einen Ordnernamen angeben.");
    return redirectDir(req, res);
  }
  const rel = cur ? `${cur}/${name}` : name;
  const p = path.join(dirFor(req.session.user), rel);
  if (fs.existsSync(p)) req.flash("err", `„${name}“ existiert schon.`);
  else { fs.mkdirSync(p); req.flash("ok", `Ordner „${name}“ angelegt.`); }
  redirectDir(req, res);
});

// Ordner loeschen — nur eigene und nur, wenn er leer ist
router.post("/rmdir/*", loginRequired, (req, res) => {
  const rel = req.params[0];
  const p = path.join(dirFor(req.session.user), rel);
  if (securePath(rel) !== rel || rel === "" ||
      !fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
    req.flash("err", "Ordner nicht gefunden.");
  } else if (fs.readdirSync(p).length > 0) {
    req.flash("err", `„${path.basename(rel)}“ ist nicht leer — erst den Inhalt löschen.`);
  } else {
    fs.rmdirSync(p);
    req.flash("ok", `Ordner „${path.basename(rel)}“ gelöscht.`);
  }
  redirectDir(req, res);
});

// Datei in einen anderen eigenen Ordner verschieben ("" = oberste Ebene).
// Nur eigene Dateien; Freigaben haengen am Pfad und wandern mit.
router.post("/move/*", loginRequired, (req, res) => {
  const me = req.session.user;
  const fid = req.params[0];
  const to = securePath((req.body.to || "").trim());
  const base = path.basename(fid || "");
  const dest = to ? `${to}/${base}` : base;
  const destDirAbs = to ? path.join(dirFor(me), to) : dirFor(me);

  if (accessFor(me, me, fid) !== "owner" || to === null) {
    req.flash("err", "Datei nicht gefunden.");
  } else if (!fs.existsSync(destDirAbs) || !fs.statSync(destDirAbs).isDirectory()) {
    req.flash("err", "Zielordner nicht gefunden.");
  } else if (dest === fid) {
    req.flash("err", "Die Datei liegt schon dort.");
  } else if (fs.existsSync(pathFor(me, dest))) {
    req.flash("err", `Im Zielordner existiert schon „${base}“.`);
  } else {
    fs.renameSync(pathFor(me, fid), pathFor(me, dest));
    shares.rename(me, fid, dest);
    notifications.rename(me, fid, dest);
    notemeta.rename(me, fid, dest);
    req.flash("ok", `„${base}“ nach „${to || "Meine Dateien"}“ verschoben.`);
  }
  redirectDir(req, res);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});
router.post("/upload", loginRequired, (req, res) => {
  // multer manuell aufrufen: eine zu grosse Datei (am Client vorbeigemogelt)
  // soll ein sauberer Flash sein, kein nackter 500er
  upload.single("file")(req, res, (err) => {
    if (err) {
      req.flash("err", `Die Datei ist zu groß — erlaubt sind maximal ${MAX_UPLOAD_MB} MB.`);
      return redirectDir(req, res);
    }
    const cur = securePath(req.body.dir || "");
    if (cur !== null && req.file && req.file.originalname) {
      const base = secureFilename(req.file.originalname);
      if (base) fs.writeFileSync(pathFor(req.session.user, cur ? `${cur}/${base}` : base),
        req.file.buffer);
    }
    redirectDir(req, res);
  });
});

// Besitzer und Nur-Lesende duerfen herunterladen
router.get("/download/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  res.download(pathFor(owner, fid), path.basename(fid));
});

// POST (nicht GET), damit kein Link-Prefetch versehentlich loescht.
// Loeschen darf ausschliesslich der Besitzer.
router.post("/delete/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (accessFor(req.session.user, owner, fid) !== "owner") {
    req.flash("err", "Nur der Besitzer darf diese Datei löschen.");
    return redirectDir(req, res);
  }
  fs.unlinkSync(pathFor(owner, fid));
  shares.unshareAll(owner, fid);        // Freigaben mit entfernen
  notifications.removeForFile(owner, fid); // und die Nachrichten dazu
  notemeta.remove(owner, fid);     // Notiz-Metadaten mit entfernen
  req.flash("ok", `„${path.basename(fid)}“ gelöscht.`);
  redirectDir(req, res);
});

module.exports = { router };
