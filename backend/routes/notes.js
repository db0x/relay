// Notizen: Markdown-Dateien mit eigenem Editor (grosser modaler Dialog statt
// OnlyOffice). Ablage immer als {uuid}-{Titel}.md — die UUID macht den Namen
// eindeutig, der Titel (erste Zeile der Notiz) macht ihn lesbar; die Liste
// zeigt nur den Titel (labelFor in routes/browse.js).
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { marked } = require("marked");

const shares = require("../shares");
const notemeta = require("../notemeta");
const users = require("../users");
const { accessFor } = require("../access");
const { secureFilename, securePath, pathFor } = require("../storage");
const { BASE, DS_INTERNAL, HOST_INTERNAL, PUBLIC_DS, JWT_SECRET, FILE_SECRET, EDITOR_THEME } = require("../config");
const { loginRequired } = require("./auth");

marked.setOptions({ gfm: true, breaks: true });

const router = express.Router();
const NOTES_DIR = "Notizen";

// Titel = erste Zeile ohne fuehrende "#"; unbrauchbar/leer -> "Notiz"
function titleOf(md) {
  const first = (md.split(/\r?\n/, 1)[0] || "").replace(/^#+\s*/, "").trim();
  return secureFilename(first.slice(0, 60)) || "Notiz";
}

// Formularfelder (ToDo/Faelligkeit/Personen/Ort) -> Meta-Objekt fuer notemeta.set.
// people_known sind Nutzernamen (Checkboxen, nur echte Nutzer uebernehmen),
// people_extra ist kommagetrennter Freitext fuer Personen ohne Account.
function metaFromBody(body) {
  const known = [].concat(body.people_known || []).filter((uname) => users.get(uname));
  // people_extra kommt jetzt als je ein Feld pro Freitext-Person (Chip-Feld),
  // frueher als ein kommagetrennter String — beides robust aufloesen
  const extra = [].concat(body.people_extra || [])
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim()).filter(Boolean);
  return {
    isTodo: body.is_todo === "1",
    dueDate: String(body.due_date || "").trim(),
    people: { known, extra },
    ort: String(body.ort || "").trim(),
  };
}

// neue Notiz: landet immer im Ordner "Notizen" (wird bei Bedarf angelegt)
router.post("/notes/create", loginRequired, (req, res) => {
  const md = String(req.body.md || "");
  const name = `${crypto.randomUUID()}-${titleOf(md)}.md`;
  const fid = `${NOTES_DIR}/${name}`;
  const p = pathFor(req.session.user, fid);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, md);
  notemeta.set(req.session.user, fid, metaFromBody(req.body));
  req.flash("ok", "Notiz gespeichert.");
  res.redirect(`${BASE}/?p=${encodeURIComponent(NOTES_DIR)}`);
});

// Rohinhalt fuer den Editor — Besitzer und Freigaben (auch nur-lesen)
router.get("/notes/raw/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  res.type("text/plain; charset=utf-8").send(fs.readFileSync(pathFor(owner, fid), "utf8"));
});

// ToDo/Personen/Ort einer Notiz — Besitzer und Freigaben (auch nur-lesen)
router.get("/notes/meta/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  res.json(notemeta.get(owner, fid));
});

// Speichern einer bestehenden Notiz: Besitzer oder Bearbeiten-Freigabe.
// Aendert der BESITZER die Titelzeile, wird die Datei umbenannt (UUID bleibt)
// und die Freigaben ziehen mit um.
router.post("/notes/save/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  const acc = accessFor(req.session.user, owner, fid);
  if (acc !== "owner" && acc !== "edit") return res.sendStatus(403);
  const md = String(req.body.md || "");
  fs.writeFileSync(pathFor(owner, fid), md);
  let newFid = fid;
  if (acc === "owner") {
    const m = path.basename(fid).match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-.*\.md$/i);
    if (m) {
      const newBase = `${m[1]}-${titleOf(md)}.md`;
      if (newBase !== path.basename(fid)) {
        const dirPart = fid.includes("/") ? fid.slice(0, fid.lastIndexOf("/") + 1) : "";
        newFid = dirPart + newBase;
        fs.renameSync(pathFor(owner, fid), pathFor(owner, newFid));
        shares.rename(owner, fid, newFid);
        notemeta.rename(owner, fid, newFid);
      }
    }
  }
  notemeta.set(owner, newFid, metaFromBody(req.body));
  const dir = securePath(req.body.dir || "") || "";
  req.flash("ok", "Notiz gespeichert.");
  res.redirect(dir ? `${BASE}/?p=${encodeURIComponent(dir)}` : `${BASE}/`);
});

// --- PDF-Export ueber die OnlyOffice-Konvertierung + -Viewer -----------
// Ablauf: Markdown -> HTML (marked) -> kurzlebig signiert bereitgestellt ->
// DocumentServer konvertiert HTML->PDF -> wir puffern das PDF kurzlebig und
// oeffnen es im OnlyOffice-PDF-Viewer (mode:view, ohne es zu speichern).
// "<" escapen: die JSONs landen roh in <script>-Tags der Editor-Seite
const embedJson = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Metadaten fuers PDF (dieselben Infos wie die Lese-Badges) — als dezenter
// Block mit fetten Labels unter einer Trennlinie. Bewusst KEINE Pillen:
// OnlyOffice konvertiert border-radius/Inline-Hintergruende nicht sauber
// (Pillen liefen zu einem Balken zusammen); Personen mit Namen statt Avatar.
// Leer, wenn nichts gesetzt.
function pdfMetaHtml(meta) {
  const rows = [];
  if (meta.isTodo) {
    const overdue = !!meta.dueDate && meta.dueDate < new Date().toISOString().slice(0, 10);
    const [y, mo, d] = (meta.dueDate || "").split("-");
    const due = y ? ` · fällig ${d}.${mo}.${y}` : "";
    rows.push(`<div style="margin:.3em 0"><b style="color:${overdue ? "#991b1b" : "#92400e"}">ToDo</b>${due}</div>`);
  }
  const known = (meta.people.known || [])
    .map((u) => { const x = users.get(u); return x ? x.display_name : null; }).filter(Boolean);
  const people = known.concat(meta.people.extra || []);
  if (people.length) rows.push(`<div style="margin:.3em 0"><b>Personen:</b> ${escapeHtml(people.join(", "))}</div>`);
  if (meta.ort) rows.push(`<div style="margin:.3em 0"><b>Ort:</b> ${escapeHtml(meta.ort)}</div>`);
  return rows.length
    ? `<div style="margin-top:1.6em;padding-top:.7em;border-top:1px solid #d0d5dd;font-size:10.5pt;color:#475467">${rows.join("")}</div>`
    : "";
}

// Notiz-HTML rendern und in ein vollstaendiges Dokument mit dezentem Print-Stil
// verpacken (OnlyOffice interpretiert semantisches HTML + einfache CSS-Regeln).
// metaHtml haengt die Metadaten-Badges unten an (siehe pdfMetaHtml).
function pdfHtmlDoc(md, metaHtml) {
  const body = marked.parse(md);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Notiz</title>
<style>
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.5;margin:0}
h1,h2,h3,h4{line-height:1.25;margin:.8em 0 .3em}
h1{font-size:20pt;margin-top:0} h2{font-size:16pt} h3{font-size:13pt}
p{margin:.4em 0} ul,ol{margin:.4em 0 .4em 1.4em}
code{font-family:Consolas,monospace;background:#f1f3f5;padding:.1em .3em;border-radius:4px}
pre{background:#f6f8fa;padding:.6em .8em;border-radius:6px} pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:.2em .9em;border-left:3px solid #ccc;color:#555}
table{border-collapse:collapse;margin:.6em 0} th,td{border:1px solid #ccc;padding:.3em .6em}
a{color:#2563eb} img{max-width:100%}
</style></head><body>${body}${metaHtml || ""}</body></html>`;
}

// kurzlebiger Speicher der Quell-HTML (nur waehrend der Konvertierung); der
// DocumentServer holt sie ueber die signierte pdf-src-Route (kein Login-Cookie)
const pdfSources = new Map(); // id -> { html, expires(ms) }
// kurzlebiger Speicher der fertigen PDF-Bytes: der OnlyOffice-Viewer laedt sie
// (ueber die signierte pdf-file-Route) beim Oeffnen der Ansicht — daher etwas
// laengere Haltbarkeit als bei der Quelle
const pdfFiles = new Map(); // id -> { buf, name, expires(ms) }
const PDF_TOKENS = { src: "pdfsrc", file: "pdffile" };
function pdfToken(kind, id, exp) {
  return crypto.createHmac("sha256", FILE_SECRET).update(`${kind}:${id}:${exp}`).digest("base64url");
}
function pdfTokenOk(kind, id, exp, tok) {
  const good = pdfToken(kind, id, exp);
  return exp >= Math.floor(Date.now() / 1000) && tok.length === good.length &&
    crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(good));
}
function prune(map) { const now = Date.now(); for (const [k, v] of map) if (v.expires < now) map.delete(k); }

// Quell-HTML fuer die Konvertierung (nur waehrend der Konvertierung vorhanden)
router.get("/notes/pdf-src/:id", (req, res) => {
  const id = req.params.id, exp = parseInt(req.query.expires, 10) || 0;
  const entry = pdfSources.get(id);
  if (!pdfTokenOk(PDF_TOKENS.src, id, exp, String(req.query.token || "")) || !entry)
    return res.sendStatus(403);
  res.type("text/html; charset=utf-8").send(entry.html);
});

// fertiges PDF fuer den OnlyOffice-Viewer (DocumentServer holt es hier ab)
router.get("/notes/pdf-file/:id", (req, res) => {
  const id = req.params.id, exp = parseInt(req.query.expires, 10) || 0;
  const entry = pdfFiles.get(id);
  if (!pdfTokenOk(PDF_TOKENS.file, id, exp, String(req.query.token || "")) || !entry)
    return res.sendStatus(403);
  res.type("application/pdf").send(entry.buf);
});

// Notiz als PDF: rendert -> konvertiert -> oeffnet im OnlyOffice-PDF-Viewer.
// Besitzer und Freigaben (auch nur-lesen) duerfen das.
router.get("/notes/pdf/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  let md;
  try { md = fs.readFileSync(pathFor(owner, fid), "utf8"); } catch (e) { return res.sendStatus(404); }
  const name = titleOf(md);

  // 1) Quell-HTML (inkl. Metadaten-Badges) kurzlebig signiert bereitstellen
  const srcId = crypto.randomUUID().replace(/-/g, "");
  const srcExp = Math.floor(Date.now() / 1000) + 60;
  const html = pdfHtmlDoc(md, pdfMetaHtml(notemeta.get(owner, fid)));
  pdfSources.set(srcId, { html, expires: Date.now() + 60000 });
  prune(pdfSources);
  const srcUrl = `${HOST_INTERNAL}${BASE}/notes/pdf-src/${srcId}`
    + `?expires=${srcExp}&token=${encodeURIComponent(pdfToken(PDF_TOKENS.src, srcId, srcExp))}`;

  // 2) HTML->PDF ueber den DocumentServer konvertieren
  const conv = { async: false, filetype: "html", outputtype: "pdf", key: srcId, title: `${name}.html`, url: srcUrl };
  const payload = JSON.stringify(conv);
  const token = jwt.sign(conv, JWT_SECRET, { algorithm: "HS256" });
  const u = new URL(`${DS_INTERNAL}/ConvertService.ashx`);
  const creq = http.request({
    method: "POST", hostname: u.hostname, port: u.port || 80, path: u.pathname,
    headers: {
      "Content-Type": "application/json", "Accept": "application/json",
      "Content-Length": Buffer.byteLength(payload), "Authorization": "Bearer " + token,
    },
  }, (cres) => {
    let d = "";
    cres.on("data", (c) => (d += c));
    cres.on("end", () => {
      pdfSources.delete(srcId);
      let j = null;
      try { j = JSON.parse(d); } catch (e) { /* Fehlerzweig unten */ }
      if (!j || !j.fileUrl) { console.error("PDF-Konvertierung fehlgeschlagen:", d); return res.sendStatus(502); }
      // 3) PDF-Bytes aus dem DS-Cache holen und kurzlebig puffern
      const pu = new URL(j.fileUrl);
      http.get(DS_INTERNAL + pu.pathname + (pu.search || ""), (pr) => {
        if (pr.statusCode !== 200) { pr.resume(); return res.sendStatus(502); }
        const chunks = [];
        pr.on("data", (c) => chunks.push(c));
        pr.on("end", () => openPdfViewer(req, res, Buffer.concat(chunks), name));
      }).on("error", () => res.sendStatus(502));
    });
  });
  creq.on("error", (e) => {
    pdfSources.delete(srcId);
    console.error("PDF-Konvertierung Fehler:", e.message);
    res.sendStatus(502);
  });
  creq.write(payload);
  creq.end();
});

// 4) PDF-Bytes puffern und die OnlyOffice-Viewer-Seite (mode:view) rendern —
// signierte Viewer-Config wie in routes/editor.js, aber ohne Callback/Speichern
function openPdfViewer(req, res, buf, name) {
  const id = crypto.randomUUID().replace(/-/g, "");
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  pdfFiles.set(id, { buf, name, expires: Date.now() + 15 * 60 * 1000 }); // 15 min
  prune(pdfFiles);
  const fileUrl = `${HOST_INTERNAL}${BASE}/notes/pdf-file/${id}`
    + `?expires=${exp}&token=${encodeURIComponent(pdfToken(PDF_TOKENS.file, id, exp))}`;
  const config = {
    document: {
      fileType: "pdf",
      key: id, // je Export frisch -> immer aktueller Stand, kein Cache-Konflikt
      title: `${name}.pdf`,
      url: fileUrl,
      permissions: { edit: false, download: true, print: true, comment: false },
    },
    documentType: "pdf",
    editorConfig: {
      mode: "view",
      lang: "de-DE",
      region: "de-DE",
      user: { id: req.session.user, name: req.session.name },
      customization: { uiTheme: EDITOR_THEME, features: { tabStyle: "fill" } },
      // kein callbackUrl: reine Ansicht, der DS schreibt nichts zurueck
    },
  };
  config.token = jwt.sign(config, JWT_SECRET, { algorithm: "HS256", noTimestamp: true });
  res.render("edit", {
    ds_api: `${PUBLIC_DS}/web-apps/apps/api/documents/api.js`,
    config: embedJson(config),
    usersJson: embedJson([]), // PDF-Ansicht: keine Co-Editing-Nutzerliste noetig
    dsOrigin: new URL(PUBLIC_DS).origin,
    theme: EDITOR_THEME,
  });
}

module.exports = { router };
