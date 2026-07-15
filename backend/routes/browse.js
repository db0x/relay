// Browser-UI: Startseite (Dateiliste mit Ordnernavigation) und alle
// Datei-/Ordner-Aktionen des eingeloggten Nutzers inkl. Freigaben.
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const users = require("../users");
const avatars = require("../avatars");
const shares = require("../shares");
const { accessFor } = require("../access");
const { secureFilename, securePath, encPath, dirFor, pathFor, walkDirs } = require("../storage");
const { BLANKS, BASE, DOCTYPE } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

// Dateiendung -> Typ-Icon in /static/img/ (verwandte Formate teilen sich eins)
function iconFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["xlsx", "xls", "ods", "csv"].includes(ext)) return "xlsx";
  if (["pptx", "ppt", "odp"].includes(ext)) return "pptx";
  return "docx"; // Standard (Textdokumente und Unbekanntes)
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

// zurueck in den Ordner, aus dem eine Aktion kam (Formulare schicken `dir` mit)
function redirectDir(req, res) {
  const d = securePath(req.body && req.body.dir || "");
  res.redirect(d ? `${BASE}/?p=${encodeURIComponent(d)}` : `${BASE}/`);
}

// --- Startseite -------------------------------------------------------
// ?p=<unterordner> navigiert in den eigenen Unterordner; freigegebene Dateien
// anderer Nutzer erscheinen nur auf der obersten Ebene.
router.get("/", loginRequired, (req, res) => {
  const me = req.session.user;
  const row = users.get(me);
  const userDir = dirFor(me);
  const otherUsers = users.listUsers().filter((u) => u.username !== me);

  const cur = securePath(req.query.p || "");
  const curAbs = cur ? path.join(userDir, cur) : userDir;
  if (cur === null || !fs.existsSync(curAbs) || !fs.statSync(curAbs).isDirectory())
    return res.redirect(`${BASE}/`);

  const meta = (name, p) => {
    const st = fs.statSync(p);
    return {
      name, icon: iconFor(name), sizeBytes: st.size, mtime: st.mtimeMs,
      size: formatSize(st.size), modified: formatDate(st.mtimeMs),
    };
  };

  const entries = fs.readdirSync(curAbs, { withFileTypes: true });

  // Unterordner im aktuellen Ordner
  const folders = entries.filter((e) => e.isDirectory()).map((e) => {
    const st = fs.statSync(path.join(curAbs, e.name));
    return {
      name: e.name, relpath: cur ? `${cur}/${e.name}` : e.name, isDir: true,
      icon: "folder", sizeBytes: -1, size: "—", mtime: st.mtimeMs,
      modified: formatDate(st.mtimeMs),
      owner: me, ownerName: req.session.name, isOwner: true, perm: "owner",
      shares: [], availableUsers: [],
    };
  });

  // eigene Dateien im aktuellen Ordner (mit ihren Freigaben) ...
  const own = entries.filter((e) => e.isFile()).map((e) => {
    const relpath = cur ? `${cur}/${e.name}` : e.name;
    const sh = shares.listForFile(me, relpath);
    return {
      ...meta(e.name, path.join(curAbs, e.name)),
      relpath, isDir: false,
      owner: me, ownerName: req.session.name, isOwner: true, perm: "owner",
      shares: sh,
      availableUsers: otherUsers.filter((u) => !sh.some((s) => s.target === u.username)),
    };
  });

  // ... plus die mir freigegebenen (liegen physisch beim Besitzer) — nur oben
  const shared = cur ? [] : shares.listForUser(me).map((s) => {
    const p = pathFor(s.owner, s.filename);
    if (!fs.existsSync(p)) return null;   // Karteileiche: Datei wurde geloescht
    return {
      ...meta(s.filename, p),
      relpath: s.filename, isDir: false,
      owner: s.owner, ownerName: s.owner_name, isOwner: false, perm: s.perm,
      shares: [], availableUsers: [],
    };
  }).filter(Boolean);

  const files = own.concat(shared);

  // Sortierung aus der URL; Default: Änderungsdatum absteigend. Ordner stehen
  // immer vor den Dateien, beide Gruppen sortieren gleich.
  const sort = ["name", "size", "date"].includes(req.query.sort) ? req.query.sort : "date";
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
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
    allDirs: walkDirs(userDir).sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" })),
    user: req.session.name,
    me,
    hasAvatar: avatars.has(me),
    // Dateiauswahl beim Hochladen auf die Formate begrenzen, die der Editor
    // oeffnen kann — abgeleitet aus DOCTYPE, bleibt also automatisch synchron
    uploadAccept: Object.keys(DOCTYPE).map((e) => "." + e).join(","),
    // einmalig: fehlgeschlagene Passwort-Aenderung -> Feld markieren,
    // Dialog + Abschnitt wieder oeffnen (index.ejs/index.js)
    pwError: (() => { const e = req.session.pwError || null; delete req.session.pwError; return e; })(),
    isAdmin: !!row.is_admin,
    allUsers: users.listUsers(),
    api_token: row.api_token,
  });
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
    req.flash("ok", `„${base}“ nach „${to || "Meine Dateien"}“ verschoben.`);
  }
  redirectDir(req, res);
});

const upload = multer({ storage: multer.memoryStorage() });
router.post("/upload", loginRequired, upload.single("file"), (req, res) => {
  const cur = securePath(req.body.dir || "");
  if (cur !== null && req.file && req.file.originalname) {
    const base = secureFilename(req.file.originalname);
    if (base) fs.writeFileSync(pathFor(req.session.user, cur ? `${cur}/${base}` : base),
      req.file.buffer);
  }
  redirectDir(req, res);
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
  req.flash("ok", `„${path.basename(fid)}“ gelöscht.`);
  redirectDir(req, res);
});

module.exports = { router };
