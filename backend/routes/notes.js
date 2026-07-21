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
const { BASE, DS_INTERNAL, HOST_INTERNAL, JWT_SECRET, FILE_SECRET } = require("../config");
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

// --- PDF-Export ueber die OnlyOffice-Konvertierung ---------------------
// Ablauf: Markdown -> HTML (marked) -> kurzlebig signiert bereitgestellt ->
// DocumentServer holt es und konvertiert HTML->PDF -> wir reichen das PDF durch.

// Notiz-HTML rendern und in ein vollstaendiges Dokument mit dezentem Print-Stil
// verpacken (OnlyOffice interpretiert semantisches HTML + einfache CSS-Regeln)
function pdfHtmlDoc(md) {
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
</style></head><body>${body}</body></html>`;
}

// kurzlebiger Speicher der Quell-HTML (nur waehrend der Konvertierung); der
// DocumentServer holt sie ueber die signierte pdf-src-Route (kein Login-Cookie)
const pdfSources = new Map(); // id -> { html, expires(ms) }
function prunePdfSources() {
  const now = Date.now();
  for (const [k, v] of pdfSources) if (v.expires < now) pdfSources.delete(k);
}
function pdfSrcToken(id, exp) {
  return crypto.createHmac("sha256", FILE_SECRET).update(`pdfsrc:${id}:${exp}`).digest("base64url");
}

// Quelle fuer den DocumentServer: signiert + zeitlich begrenzt, nur solange die
// Konvertierung laeuft im Map vorhanden
router.get("/notes/pdf-src/:id", (req, res) => {
  const id = req.params.id;
  const exp = parseInt(req.query.expires, 10) || 0;
  const tok = String(req.query.token || "");
  const good = pdfSrcToken(id, exp);
  const ok = exp >= Math.floor(Date.now() / 1000) && tok.length === good.length &&
    crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(good));
  const entry = pdfSources.get(id);
  if (!ok || !entry) return res.sendStatus(403);
  res.type("text/html; charset=utf-8").send(entry.html);
});

// Notiz als PDF: rendert, konvertiert ueber den DS und liefert das PDF inline
// (oeffnet im neuen Tab). Besitzer und Freigaben (auch nur-lesen) duerfen das.
router.get("/notes/pdf/:owner/*", loginRequired, (req, res) => {
  const owner = req.params.owner, fid = req.params[0];
  if (!accessFor(req.session.user, owner, fid)) return res.sendStatus(404);
  let md;
  try { md = fs.readFileSync(pathFor(owner, fid), "utf8"); } catch (e) { return res.sendStatus(404); }
  const name = titleOf(md);

  const id = crypto.randomUUID().replace(/-/g, "");
  const exp = Math.floor(Date.now() / 1000) + 60;
  pdfSources.set(id, { html: pdfHtmlDoc(md), expires: Date.now() + 60000 });
  prunePdfSources();
  const srcUrl = `${HOST_INTERNAL}/notes/pdf-src/${id}`
    + `?expires=${exp}&token=${encodeURIComponent(pdfSrcToken(id, exp))}`;

  const conv = { async: false, filetype: "html", outputtype: "pdf", key: id, title: `${name}.html`, url: srcUrl };
  const payload = JSON.stringify(conv);
  const token = jwt.sign(conv, JWT_SECRET, { algorithm: "HS256" });
  const u = new URL(`${DS_INTERNAL}/ConvertService.ashx`);
  const opts = {
    method: "POST", hostname: u.hostname, port: u.port || 80, path: u.pathname,
    headers: {
      "Content-Type": "application/json", "Accept": "application/json",
      "Content-Length": Buffer.byteLength(payload), "Authorization": "Bearer " + token,
    },
  };
  const creq = http.request(opts, (cres) => {
    let d = "";
    cres.on("data", (c) => (d += c));
    cres.on("end", () => {
      pdfSources.delete(id);
      let j = null;
      try { j = JSON.parse(d); } catch (e) { /* faellt unten in den Fehlerzweig */ }
      if (!j || !j.fileUrl) {
        console.error("PDF-Konvertierung fehlgeschlagen:", d);
        return res.sendStatus(502);
      }
      // PDF liegt im DS-Cache (gleicher interner Host) -> holen und durchreichen
      const pu = new URL(j.fileUrl);
      http.get(DS_INTERNAL + pu.pathname + (pu.search || ""), (pr) => {
        if (pr.statusCode !== 200) { pr.resume(); return res.sendStatus(502); }
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${name}.pdf"`);
        pr.pipe(res);
      }).on("error", () => res.sendStatus(502));
    });
  });
  creq.on("error", (e) => {
    pdfSources.delete(id);
    console.error("PDF-Konvertierung Fehler:", e.message);
    res.sendStatus(502);
  });
  creq.write(payload);
  creq.end();
});

module.exports = { router };
