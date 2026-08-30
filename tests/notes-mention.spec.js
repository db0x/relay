// Verlinken per @ im Notiz-Editor.
//
// Ein @ am Wortanfang oeffnet die Dokumentsuche; aus der Auswahl entsteht ein
// fertiger Markdown-Verweis auf ein Dokument oder eine andere Notiz. Geprueft
// wird die ganze Kette: Ausloeser -> Auswahl -> eingefuegtes Markdown ->
// gerenderter Verweis -> Klick auf das Ziel. Und die Regel, an der sich das
// Ganze im Alltag beweisen muss: eine E-Mail-Adresse darf nichts ausloesen.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName,
  createNote, uploadFile, shareFile, waitAppReady, expectStatus,
} = require("./helpers/relay");

// CodeMirror ersetzt die Textarea -> Inhalt ueber die Editor-Instanz lesen
const editorText = (page) => page.evaluate(
  () => document.querySelector(".CodeMirror").CodeMirror.getValue());

// Neue Notiz im Editor oeffnen (ohne zu speichern) und den Rumpf tippen.
async function neueNotizTippen(page, text) {
  await waitAppReady(page);
  await page.click("#app-menu-btn");
  await page.click("#app-panel .note-new");
  await expect(page.locator("#dlg-note")).toBeVisible();
  await page.click(".CodeMirror");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

const panel = (page) => page.locator(".mention-panel");
const treffer = (page) => page.locator(".mention-panel .app-hit");

test.describe("Dokumente per @ verlinken", () => {
  let user, doc, notiz;

  async function setup(page) {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    doc = uniqueName("Bericht") + ".docx";
    await uploadFile(page, doc);
    notiz = "Einkauf " + uniqueName("n");
    await createNote(page, notiz);
  }

  test("@ am Wortanfang oeffnet die Suche, eine Mail-Adresse nicht",
    async ({ page }) => {
      await setup(page);
      await neueNotizTippen(page, "# Verweise\n\nSiehe @");
      await expect(panel(page)).toBeVisible();
      // ohne Suchbegriff steht dort erst einmal die Aufforderung
      await expect(page.locator(".mention-hint")).toContainText("Tippen");

      // Escape raeumt die Auswahl weg, der Text bleibt stehen
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeHidden();

      // Und der eigentliche Grund fuer die Leerzeichen-Regel: mitten in einem
      // Wort ist das @ ein Zeichen wie jedes andere.
      await page.keyboard.type(" Mail an thomas@beispiel.de");
      await expect(panel(page)).toBeHidden();
    });

  test("aus der Auswahl entsteht ein fertiger Markdown-Verweis", async ({ page }) => {
    await setup(page);
    await neueNotizTippen(page, "# Verweise\n\nSiehe @" + doc.slice(0, 8));
    await expect(treffer(page).first()).toBeVisible();
    await expect(treffer(page).first()).toContainText(doc);

    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeHidden();
    // Titel als Text, Ziel ohne Instanz-Praefix (siehe js/notes/doclinks.js)
    expect(await editorText(page)).toContain(`[${doc}](relay/${user.username}/${doc})`);

    // … und in der Vorschau ist daraus eine Kachel mit echtem Ziel geworden,
    // keine sichtbare Klammer-Schreibweise
    const link = page.locator("#note-preview-body a.doc-link");
    await expect(link).toHaveText(doc);
    await expect(link).toHaveAttribute("href", `/edit/${user.username}/${doc}`);
  });

  test("ein Verweis auf eine Notiz oeffnet sie im selben Dialog", async ({ page }) => {
    await setup(page);
    await neueNotizTippen(page, "# Verweise\n\nDazu @" + notiz.split(" ")[0]);
    await expect(treffer(page).first()).toBeVisible();
    await page.click(".mention-panel .app-hit");
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);

    // Lese-Ansicht -> Klick auf den Verweis
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await page.locator("table.files .note-open").filter({ hasText: "Verweise" }).click();
    await expect(page.locator("#dlg-note")).toBeVisible();
    await page.locator("#note-preview-body a.doc-link").click();

    // Derselbe Dialog zeigt jetzt die Zielnotiz — mit den Rechten des Ziels:
    // sie gehoert mir, also darf ich sie loeschen (abgeleitet aus den
    // Metadaten, der Verweis selbst traegt keine Rechte).
    await expect(page.locator("#dlg-note-title")).toHaveText(notiz);
    await expect(page.locator("#note-delete")).toBeVisible();
  });

  test("ein handgeschriebener Verweis auf eine fremde Notiz oeffnet nichts",
    async ({ page, browser }) => {
      // Sicherheitsfall: der Verweis ist nur Text in einer Datei — wer ihn
      // faelscht, darf damit nichts sehen, was ihm nicht freigegeben ist.
      await setup(page);
      await page.goto("/?p=Notizen");
      await waitAppReady(page);
      const fremdePfad = await page.locator("table.files .note-open")
        .first().getAttribute("data-rel");

      const zweiter = await (async () => {
        await logout(page);
        await loginAsAdmin(page);
        const u = await createUser(page);
        await logout(page);
        return u;
      })();

      const ctx = await browser.newContext({ baseURL: page.url().split("/?")[0] });
      const p = await ctx.newPage();
      await login(p, zweiter.username, zweiter.password);
      const ziel = "relay/" + user.username + "/" +
        fremdePfad.split("/").map(encodeURIComponent).join("/");
      await neueNotizTippen(p, "# Neugier\n\n[Fremd](" + ziel + ")");
      await Promise.all([p.waitForNavigation(), p.click("#note-save")]);

      await p.goto("/?p=Notizen");
      await waitAppReady(p);
      await p.locator("table.files .note-open").filter({ hasText: "Neugier" }).click();
      await p.locator("#note-preview-body a.doc-link").click();

      // Der Server liefert 404 (kein Zugriff) -> Fehlermeldung statt Inhalt
      await expect(p.locator("#dlg-notice")).toBeVisible();
      await expect(p.locator("#dlg-notice-text")).toContainText("nicht geladen");
      await expect(p.locator("#dlg-note-title")).toHaveText("Neugier");
      await ctx.close();
    });
});

test.describe("Hover-Kaertchen an einem Verweis", () => {
  // Ein Verweis soll das Wichtigste zeigen, ohne dass man ihn oeffnet: bei
  // Notizen die gewohnte Inhaltsvorschau, bei Dokumenten Groesse, letzte
  // Aenderung und die Freigabe-Lage.
  let besitzer, empfaenger, datei;

  // Notiz anlegen, die per @ auf `suchwort` verweist, und sie lesend oeffnen.
  async function notizMitVerweis(page, titel, suchwort) {
    await waitAppReady(page);
    await page.click("#app-menu-btn");
    await page.click("#app-panel .note-new");
    await expect(page.locator("#dlg-note")).toBeVisible();
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+A");
    await page.keyboard.type(`# ${titel}\n\nDazu @${suchwort}`);
    await expect(treffer(page).first()).toBeVisible();
    await page.click(".mention-panel .app-hit");
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);

    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await page.locator("table.files .note-open").filter({ hasText: titel }).click();
    await expect(page.locator("#dlg-note")).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    besitzer = await createUser(page);
    empfaenger = await createUser(page);
    await logout(page);
    await login(page, besitzer.username, besitzer.password);
    datei = uniqueName("Vertrag") + ".docx";
    await uploadFile(page, datei, "x".repeat(4096));
    await shareFile(page, datei, empfaenger.username, "view");
  });

  test("beim Besitzer nennt es Groesse, Aenderung und die Empfaenger",
    async ({ page }) => {
      await notizMitVerweis(page, "Sammlung", datei.slice(0, 8));
      await page.locator("#note-preview-body a.doc-link").hover();

      const karte = page.locator("#doc-tip");
      await expect(karte).toHaveClass(/open/);
      await expect(karte).toContainText(datei);
      await expect(karte).toContainText("4 KB");
      await expect(karte).toContainText("Geteilt mit");
      await expect(karte).toContainText(empfaenger.display);
      await expect(karte).toContainText("Nur lesen");

      // Der Grund, warum die Karte umgehaengt wird: ein modaler Dialog liegt
      // in der "top layer" und wuerde ein Kaertchen am <body> verdecken.
      expect(await page.evaluate(
        () => !!document.getElementById("doc-tip").closest("dialog"))).toBe(true);
    });

  test("der Empfaenger sieht den Absender — nicht die uebrigen Empfaenger",
    async ({ page, browser }) => {
      // Wer eine Datei nur bekommen hat, darf nicht erfahren, wem sie sonst
      // noch freigegeben wurde. Dieselbe Aufteilung wie bei den Badges der
      // Dateiliste, entschieden in GET /fileinfo.
      const dritter = await (async () => {
        await logout(page);
        await loginAsAdmin(page);
        const u = await createUser(page);
        await logout(page);
        await login(page, besitzer.username, besitzer.password);
        await shareFile(page, datei, u.username, "edit");
        return u;
      })();

      const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
      const p = await ctx.newPage();
      await login(p, empfaenger.username, empfaenger.password);
      await notizMitVerweis(p, "Meins", datei.slice(0, 8));
      await p.locator("#note-preview-body a.doc-link").hover();

      const karte = p.locator("#doc-tip");
      await expect(karte).toHaveClass(/open/);
      await expect(karte).toContainText("Freigegeben von");
      await expect(karte).toContainText(besitzer.display);
      await expect(karte).not.toContainText("Geteilt mit");
      await expect(karte).not.toContainText(dritter.display);
      await ctx.close();
    });

  test("ein Notiz-Verweis zeigt die gewohnte Inhaltsvorschau", async ({ page }) => {
    const notiz = "Reiseziele " + uniqueName("n");
    await createNote(page, notiz);
    await notizMitVerweis(page, "Sammlung", notiz.split(" ")[0]);
    await page.locator("#note-preview-body a.doc-link").hover();

    // dasselbe Kaertchen wie an Listenzeilen und Desktop-Icons
    await expect(page.locator("#note-tip")).toHaveClass(/open/);
    await expect(page.locator("#note-tip")).toContainText("Inhalt.");
    expect(await page.evaluate(
      () => !!document.getElementById("note-tip").closest("dialog"))).toBe(true);
  });

  test("die Kurzinfo gibt es nur mit Zugriff", async ({ page, browser }) => {
    const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const p = await ctx.newPage();
    const fremder = await (async () => {
      await logout(page);
      await loginAsAdmin(page);
      const u = await createUser(page);
      await logout(page);
      return u;
    })();
    await login(p, fremder.username, fremder.password);
    await expectStatus(p, "get",
      `/fileinfo/${besitzer.username}/${encodeURIComponent(datei)}`, 404);
    await ctx.close();
  });
});

test.describe("Bilder verlinken oder einbetten", () => {
  // Markdown unterscheidet beides selbst — mit dem Ausrufezeichen. Die Auswahl
  // setzt es bei Bildern von sich aus (das ist der haeufige Wunsch), Umschalt
  // dreht es um. Ausgeliefert wird ueber /image, das an Anmeldung und Freigabe
  // haengt (dessen Schutz prueft images.spec.js).
  let bild;

  // 8x8-PNG — klein, aber ein echtes Bild: die Vorschau soll es wirklich laden
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD///9BHTQRAAAADUlE" +
    "QVQI12P4z8AAAAMBAQDcJqUjAAAAAElFTkSuQmCC", "base64");

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);
    await login(page, u.username, u.password);
    bild = uniqueName("Foto") + ".png";
    await waitAppReady(page);
    await Promise.all([
      page.waitForNavigation(),
      page.locator(".upload-form input[type=file]").setInputFiles({
        name: bild, mimeType: "image/png", buffer: PNG,
      }),
    ]);
  });

  test("die Auswahl bettet ein Bild ein, Umschalt macht einen Verweis daraus",
    async ({ page }) => {
      await neueNotizTippen(page, "# Bilder\n\nHier: @" + bild.slice(0, 8));
      await expect(treffer(page).first()).toBeVisible();
      // Die Wahl steht nur bei Bildern da — sonst gibt es nichts zu waehlen
      await expect(page.locator(".mention-foot")).toBeVisible();
      await page.keyboard.press("Enter");
      expect(await editorText(page)).toContain("![" + bild + "](relay/");

      // Das eingebettete Bild wird wirklich geladen (nicht nur ein <img> im DOM)
      const img = page.locator("#note-preview-body img.doc-img");
      await expect(img).toHaveAttribute("src", new RegExp("/image/[^/]+/" + bild));
      await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth > 0))
        .toBe(true);

      // Zweiter Anlauf mit Umschalt: derselbe Treffer, aber als Verweis
      await page.keyboard.type("\n\nOder: @" + bild.slice(0, 8));
      await expect(treffer(page).first()).toBeVisible();
      await page.keyboard.press("Shift+Enter");
      expect(await editorText(page)).toContain("\n\nOder: [" + bild + "](relay/");
      await expect(page.locator("#note-preview-body a.doc-link")).toHaveCount(1);
    });

  test("ein eingebettetes Bild oeffnet die grosse Vorschau", async ({ page }) => {
    await neueNotizTippen(page, "# Bilder\n\n@" + bild.slice(0, 8));
    await expect(treffer(page).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);

    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await page.locator("table.files .note-open").filter({ hasText: "Bilder" }).click();
    await page.locator("#note-preview-body img.doc-img").click();
    await expect(page.locator("#dlg-image")).toBeVisible();
    await expect(page.locator("#dlg-image-title")).toHaveText(bild);
  });

  test("ein Ausrufezeichen vor einer Nicht-Bilddatei bleibt Text", async ({ page }) => {
    // Vertipper: statt eines kaputten Bildsymbols (und einer 404-Anfrage)
    // bleibt der Titel stehen.
    await neueNotizTippen(page, "# Bilder\n\n![Kein Bild](relay/wer/auch/immer.docx)");
    const img = page.locator("#note-preview-body img[alt='Kein Bild']");
    await expect(img).toHaveCount(1);
    expect(await img.evaluate((i) => i.getAttribute("src"))).toBe(null);
  });
});
