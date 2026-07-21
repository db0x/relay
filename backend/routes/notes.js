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
const sharp = require("sharp");
const { marked } = require("marked");

const shares = require("../shares");
const notemeta = require("../notemeta");
const users = require("../users");
const avatars = require("../avatars");
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

// Metadaten-Badges fuers PDF als GRAFIK: dieselben Pillen wie in der UI
// (ToDo farbig, Personen mit Avatar/Initialen, Ort) werden als SVG aufgebaut
// und mit sharp zu PNG gerastert — OnlyOffice bettet das Bild sauber ein.
// (Direkt als HTML-Pillen konvertiert OnlyOffice border-radius/Hintergruende
// nicht; darum der Umweg ueber ein Bild.) Rueckgabe {dataUri,width,height}
// oder null, wenn nichts gesetzt ist.
async function metaBadgeImage(meta) {
  const FS = 14, H = 30, R = 15, PADX = 12, CIRC = 22, CGAP = 6, PILLGAP = 8, ROWGAP = 8, MAXW = 540;
  const estW = (t, bold) => Math.ceil([...String(t)].length * FS * (bold ? 0.66 : 0.6));
  const txt = (x, y, t, fill, bold) =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${FS}" fill="${fill}"`
    + `${bold ? ' font-weight="bold"' : ""}>${escapeHtml(t)}</text>`;
  let clipId = 0;

  // Text-Pille (ToDo/Ort): Segmente erlauben fett+normal in einer Pille
  const textPill = (segs, bg, fg) => {
    const w = PADX * 2 + segs.reduce((s, g) => s + estW(g.t, g.bold), 0);
    return { w, render(x, y) {
      let tx = x + PADX; const ty = y + H / 2 + FS * 0.35;
      let out = `<rect x="${x}" y="${y}" width="${w}" height="${H}" rx="${R}" fill="${bg}"/>`;
      for (const g of segs) { out += txt(tx, ty, g.t, fg, g.bold); tx += estW(g.t, g.bold); }
      return out;
    } };
  };
  // Personen-Pille: Avatar (oder Initialen-Kreis) + Name
  const personPill = (p) => {
    const w = 5 + CIRC + CGAP + estW(p.name, false) + PADX;
    return { w, render(x, y) {
      const cy = y + H / 2, cx = x + 5 + CIRC / 2, id = `av${clipId++}`;
      let out = `<rect x="${x}" y="${y}" width="${w}" height="${H}" rx="${R}" fill="#f1f3f5"/>`;
      if (p.avatar) {
        out += `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${CIRC / 2}"/></clipPath>`
          + `<image xlink:href="${p.avatar}" x="${x + 5}" y="${cy - CIRC / 2}" width="${CIRC}" height="${CIRC}" `
          + `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
      } else {
        out += `<circle cx="${cx}" cy="${cy}" r="${CIRC / 2}" fill="#2563eb"/>`
          + `<text x="${cx}" y="${cy + FS * 0.32}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" `
          + `font-size="${FS - 2}" fill="#fff" font-weight="bold">${escapeHtml(p.initial)}</text>`;
      }
      out += txt(x + 5 + CIRC + CGAP, y + H / 2 + FS * 0.35, p.name, "#1a1a1a", false);
      return out;
    } };
  };

  const pills = [];
  if (meta.isTodo) {
    const overdue = !!meta.dueDate && meta.dueDate < new Date().toISOString().slice(0, 10);
    const [y, mo, d] = (meta.dueDate || "").split("-");
    const segs = [{ t: "ToDo", bold: true }];
    if (y) segs.push({ t: ` · fällig ${d}.${mo}.${y}`, bold: false });
    pills.push(textPill(segs, overdue ? "#fdecec" : "#fef3c7", overdue ? "#991b1b" : "#92400e"));
  }
  for (const uname of (meta.people.known || [])) {
    const u = users.get(uname); if (!u) continue; // geloeschte Nutzer auslassen
    let avatar = null;
    if (avatars.has(uname)) {
      try { avatar = "data:image/png;base64," + fs.readFileSync(avatars.pathFor(uname)).toString("base64"); } catch (e) { /* dann Initiale */ }
    }
    pills.push(personPill({ name: u.display_name, avatar, initial: (u.display_name.trim()[0] || "?").toUpperCase() }));
  }
  for (const n of (meta.people.extra || []))
    pills.push(personPill({ name: n, avatar: null, initial: (n.trim()[0] || "?").toUpperCase() }));
  if (meta.ort) pills.push(textPill([{ t: "Ort: ", bold: true }, { t: meta.ort, bold: false }], "#f1f3f5", "#1a1a1a"));

  if (!pills.length) return null;

  // Flow-Layout: Pillen fliessen nebeneinander und brechen bei MAXW um
  let x = 0, y = 0, totalW = 0;
  const placed = [];
  for (const pill of pills) {
    if (x > 0 && x + pill.w > MAXW) { y += H + ROWGAP; x = 0; }
    placed.push({ pill, x, y });
    x += pill.w + PILLGAP;
    totalW = Math.max(totalW, x - PILLGAP);
  }
  const W = Math.ceil(totalW) + 2, Hgt = y + H + 2;
  const body = placed.map((pl) => pl.pill.render(pl.x + 1, pl.y + 1)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${Hgt}">${body}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { dataUri: "data:image/png;base64," + png.toString("base64"), width: W, height: Hgt };
}

// Notiz-HTML rendern und in ein vollstaendiges Dokument mit dezentem Print-Stil
// verpacken (OnlyOffice interpretiert semantisches HTML + einfache CSS-Regeln).
// badge (optional) haengt die Metadaten-Badges als Bild unten unter einer
// Trennlinie an.
function pdfHtmlDoc(md, badge) {
  const body = marked.parse(md);
  const meta = badge
    ? `<div style="margin-top:1.4em;padding-top:.8em;border-top:1px solid #e5e7eb">`
      + `<img src="${badge.dataUri}" width="${badge.width}" height="${badge.height}"/></div>`
    : "";
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
</style></head><body>${body}${meta}</body></html>`;
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
// Besitzer und Freigaben (auch nur-lesen) duerfen das. Der Pfad liegt bewusst
// unter /edit/, damit die Wrapper-App (Voltage) den OnlyOffice-Kontext erkennt
// und ihren "Zurueck zur Liste"-Knopf zeigt (wie beim normalen Datei-Oeffnen).
router.get("/edit/notepdf/:owner/*", loginRequired, async (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  let md;
  try { md = fs.readFileSync(pathFor(owner, fid), "utf8"); } catch (e) { return res.sendStatus(404); }
  const name = titleOf(md);

  // 1) Quell-HTML (inkl. grafischer Metadaten-Badges) kurzlebig bereitstellen
  const srcId = crypto.randomUUID().replace(/-/g, "");
  const srcExp = Math.floor(Date.now() / 1000) + 60;
  let badge = null;
  try { badge = await metaBadgeImage(notemeta.get(owner, fid)); } catch (e) { console.error("Badge-Bild fehlgeschlagen:", e.message); }
  const html = pdfHtmlDoc(md, badge);
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
