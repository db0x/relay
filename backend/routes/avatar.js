// Profilbilder: Upload (mit Verkleinerung via sharp), Entfernen, Auslieferung.
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");

const avatars = require("../avatars");
const { BASE } = require("../config");
const { loginRequired } = require("./auth");

const router = express.Router();

// Rohbild darf gross sein (Handyfoto) — gespeichert wird ohnehin 128x128
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Auslieferung: gueltige Session ODER signierte URL (Editor ohne Cookies)
router.get("/avatar/:user", (req, res) => {
  const user = req.params.user;
  const exp = parseInt(req.query.expires, 10) || 0;
  const tok = req.query.token || "";
  const good = avatars.token(user, exp);
  const signed = exp >= Math.floor(Date.now() / 1000) &&
    tok.length === good.length &&
    crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(good));
  if (!signed && !req.session.user) return res.sendStatus(403);
  const p = avatars.pathFor(user);
  if (!p || !fs.existsSync(p)) return res.sendStatus(404);
  res.sendFile(p);
});

router.post("/avatar", loginRequired, (req, res) => {
  // multer manuell aufrufen, damit ein zu grosses Bild als Flash landet
  // statt als nackter 500er
  upload.single("file")(req, res, async (err) => {
    if (err || !req.file) {
      req.flash("err", err ? "Das Bild ist zu groß (max. 10 MB)." : "Keine Datei gewählt.");
      return res.redirect(`${BASE}/`);
    }
    try {
      const buf = await sharp(req.file.buffer)
        .rotate()                             // EXIF-Orientierung (Handyfotos)
        .resize(128, 128, { fit: "cover" })   // quadratisch zuschneiden
        .png()                                // Format normalisieren
        .toBuffer();
      fs.writeFileSync(avatars.pathFor(req.session.user), buf);
      req.flash("ok", "Profilbild gespeichert.");
    } catch (e) {
      req.flash("err", "Das Bild konnte nicht verarbeitet werden — bitte PNG, JPEG oder WebP nutzen.");
    }
    res.redirect(`${BASE}/`);
  });
});

router.post("/avatar/delete", loginRequired, (req, res) => {
  avatars.remove(req.session.user);
  req.flash("ok", "Profilbild entfernt.");
  res.redirect(`${BASE}/`);
});

module.exports = { router };
