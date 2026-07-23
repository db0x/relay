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
const { accessFor } = require("../access");
const { secureFilename, securePath, encPath, dirFor, pathFor, walkDirs, walkFiles } = require("../storage");
const { BLANKS, BASE, DOCTYPE, MAX_UPLOAD_MB } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

// Dateiendung -> Typ-Icon in /static/img/ (verwandte Formate teilen sich eins)
function iconFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["xlsx", "xls", "ods", "csv"].includes(ext)) return "xlsx";
  if (["pptx", "ppt", "odp"].includes(ext)) return "pptx";
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "note";
  return "docx"; // Standard (Textdokumente und Unbekanntes)
}

// Notizen heissen {uuid}-{Titel}.md — angezeigt (Liste, Dialoge, Rueckfragen)
// wird nur der Titel; alle Links/Aktionen laufen weiter ueber den vollen Namen
const NOTE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.*)\.md$/i;
function labelFor(name) {
  const m = path.basename(name).match(NOTE_RE);
  // Unterstriche stammen aus secureFilename (Leerzeichen im Titel) —
  // fuer die Anzeige wieder zu Leerzeichen
  return m ? (m[1].replace(/_/g, " ") || "Notiz") : name;
}

// Dateigroesse menschenlesbar (deutsche Schreibweise: Komma als Dezimaltrenner)
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("de-DE", { maximumFractionDigits: 1 })} KB`;
  return `${(kb / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

// Zeitstempel -> "05.07.2026, 14:30"
function formatDate(ms) {
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
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
  const posRows = notemeta.desktopPositions(me);
  const posOf = (owner, filename) => {
    const r = posRows.find((p) => p.owner === owner && p.filename === filename);
    return r ? { x: r.x, y: r.y } : null;
  };
  const out = [];
  const add = (owner, filename, canedit, color) => {
    if (!/\.md$/i.test(filename) || !fs.existsSync(pathFor(owner, filename))) return;
    out.push({
      owner, relpath: filename, label: labelFor(filename), canedit,
      pos: posOf(owner, filename), color: color || "", dark: notemeta.isDark(color),
    });
  };
  // eigene ToDo-Notizen (alle Ordner)
  notemeta.listTodos(me).forEach((n) => add(me, n.filename, true, n.color));
  // an mich freigegebene ToDo-Notizen
  shares.listForUser(me).forEach((s) => {
    const m = notemeta.get(s.owner, s.filename);
    if (m.isTodo) add(s.owner, s.filename, s.perm === "edit", m.color);
  });
  return out;
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
  const otherUsers = users.listUsers().filter((u) => u.username !== me);
  const hiddenLangs = settings.get("hidden_langs", []);

  const cur = securePath(req.query.p || "");
  const curAbs = cur ? path.join(userDir, cur) : userDir;
  if (cur === null || !fs.existsSync(curAbs) || !fs.statSync(curAbs).isDirectory())
    return res.redirect(`${BASE}/`);

  const meta = (name, p) => {
    const st = fs.statSync(p);
    return {
      name, label: labelFor(name), isNote: /\.md$/i.test(name),
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
    const m = meta(e.name, path.join(curAbs, e.name));
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
    const m = meta(s.filename, p);
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
    desktopNotes: desktopNotesFor(me),
    // gemerkte Position der frei verschiebbaren Dokumentenliste (oder null)
    pageLayout: notemeta.getLayout(me, "page"),
    allDirs: walkDirs(userDir).sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" })),
    user: req.session.name,
    me,
    hasAvatar: avatars.has(me),
    // Personen-Auswahl im Notiz-Dialog: ALLE Nutzer (auch man selbst, im
    // Gegensatz zu otherUsers beim Freigeben-Dialog); hasAvatar fuer die
    // minimalistische Lese-Ansicht (Avatar statt Initialen-Kreis)
    knownUsers: users.listUsers().map((u) => (
      { username: u.username, display_name: u.display_name, hasAvatar: avatars.has(u.username) }
    )),
    // Dateiauswahl beim Hochladen auf die Formate begrenzen, die der Editor
    // oeffnen kann — abgeleitet aus DOCTYPE, bleibt also automatisch synchron
    uploadAccept: Object.keys(DOCTYPE).map((e) => "." + e).join(","),
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
    // Nutzerverwaltung (nur Admins): Avatar-Flag und belegter Speicherplatz je
    // Nutzer — Familienmassstab, das rekursive Aufsummieren ist billig genug
    allUsers: !row.is_admin ? [] : users.listUsers().map((u) => {
      const dir = dirFor(u.username);
      const bytes = walkFiles(dir)
        .reduce((sum, rel) => sum + fs.statSync(path.join(dir, rel)).size, 0);
      return { ...u, hasAvatar: avatars.has(u.username), size: formatSize(bytes) };
    }),
    api_token: row.api_token,
  });
});

// Position eines frei verschiebbaren UI-Elements merken (aktuell nur die
// Dokumentenliste, key="page") — je Nutzer
router.post("/desktop/layout", loginRequired, express.json(), (req, res) => {
  const b = req.body || {};
  const key = String(b.key || "");
  const x = Number(b.x), y = Number(b.y);
  if (key !== "page" || !Number.isFinite(x) || !Number.isFinite(y)) return res.sendStatus(400);
  notemeta.setLayout(req.session.user, key, x, y);
  res.sendStatus(204);
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
  } else {
    shares.share(me, fid, target, perm);
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
  shares.unshareAll(owner, fid);   // Freigaben mit entfernen
  notemeta.remove(owner, fid);     // Notiz-Metadaten mit entfernen
  req.flash("ok", `„${path.basename(fid)}“ gelöscht.`);
  redirectDir(req, res);
});

module.exports = { router };
