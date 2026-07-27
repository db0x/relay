// Bilder in "Meine Dateien": hochladen, als Vorschaubild in der Liste sehen,
// im Vorschau-Dialog ansehen — und nichts davon an OnlyOffice geben.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, uploadFile,
  fileRow, shareFile, waitAppReady, expectFlash,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");
const { makePng } = require("./helpers/png");

test.describe("Bilder", () => {
  let user, name;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
    name = uniqueName("bild") + ".png";
  });

  // Bild hochladen (uploadFile schickt beliebige Bytes; hier ein echtes PNG,
  // damit der Server auch ein Vorschaubild daraus rechnen kann)
  async function uploadImage(page, filename = name) {
    await uploadFile(page, filename, makePng(120, 80));
    await waitAppReady(page);
  }

  test("die Dateiauswahl bietet Bildformate an", async ({ page }) => {
    const accept = await page.locator(".upload-form input[type=file]").getAttribute("accept");
    for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp"]) expect(accept).toContain(ext);
    // SVG bewusst NICHT: XML mit moeglichem Skriptinhalt (siehe routes/images.js)
    expect(accept).not.toContain(".svg");
  });

  test("ein hochgeladenes Bild erscheint mit Vorschaubild in der Liste", async ({ page }) => {
    await uploadImage(page);
    const row = fileRow(page, name);
    await expect(row).toBeVisible();
    const thumb = row.locator(".ficon-thumb");
    await expect(thumb).toBeVisible();
    // wirklich geladen — nicht nur ein leerer Rahmen
    await expect.poll(() => thumb.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  });

  test("Klick auf den Namen oeffnet die Vorschau statt des Editors", async ({ page }) => {
    await uploadImage(page);
    await fileRow(page, name).locator(".image-open").click();
    const dlg = page.locator("#dlg-image");
    await expect(dlg).toBeVisible();
    await expect(page.locator("#dlg-image-title")).toHaveText(name);
    await expect.poll(() =>
      page.locator("#dlg-image-img").evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    // kein Sprung in den OnlyOffice-Editor
    expect(page.url()).not.toContain("/edit/");
    // Herunterladen-Knopf zeigt auf die Datei
    await expect(page.locator("#dlg-image-download")).toHaveAttribute("href", /\/download\//);
  });

  test("Bilder werden mit festem Typ und nosniff ausgeliefert", async ({ page }) => {
    await uploadImage(page);
    const url = await fileRow(page, name).locator(".image-open").getAttribute("data-src");
    const res = await page.request.get(url);
    expect(res.status()).toBe(200);
    // Content-Type kommt aus der Whitelist, nicht aus der Datei …
    expect(res.headers()["content-type"]).toContain("image/png");
    // … und der Browser darf nicht selbst raten (sonst liesse sich eine als
    // .png getarnte HTML-Datei als Seite ausfuehren)
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("fremde Bilder sind ohne Freigabe nicht abrufbar", async ({ page, browser }) => {
    await uploadImage(page);
    const src = await fileRow(page, name).locator(".image-open").getAttribute("data-src");
    const thumbUrl = src.replace("/image/", "/thumb/");

    const ctx0 = await browser.newContext({ baseURL: BASE_URL });
    const admin = await ctx0.newPage();
    await loginAsAdmin(admin);
    const other = await createUser(admin);
    await ctx0.close();

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const stranger = await ctx.newPage();
    await login(stranger, other.username, other.password);
    // 404 statt 403: verraet nicht einmal, dass es die Datei gibt
    expect((await stranger.request.get(src, { maxRedirects: 0 })).status()).toBe(404);
    expect((await stranger.request.get(thumbUrl, { maxRedirects: 0 })).status()).toBe(404);
    await ctx.close();
  });

  test("ohne Anmeldung kommt niemand an ein Bild", async ({ page, browser }) => {
    await uploadImage(page);
    const src = await fileRow(page, name).locator(".image-open").getAttribute("data-src");
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const anon = await ctx.newPage();
    const res = await anon.request.get(src, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toContain("/login");
    await ctx.close();
  });

  test("ein freigegebenes Bild ist beim Empfaenger sichtbar", async ({ page, browser }) => {
    await uploadImage(page);
    const ctx0 = await browser.newContext({ baseURL: BASE_URL });
    const admin = await ctx0.newPage();
    await loginAsAdmin(admin);
    const friend = await createUser(admin);
    await ctx0.close();
    await page.reload();
    await waitAppReady(page);
    await shareFile(page, name, friend.username, "view");
    await expectFlash(page, "freigegeben");

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const other = await ctx.newPage();
    await login(other, friend.username, friend.password);
    await waitAppReady(other);
    await expect(fileRow(other, name).locator(".ficon-thumb")).toBeVisible();
    await fileRow(other, name).locator(".image-open").click();
    await expect(other.locator("#dlg-image")).toBeVisible();
    await ctx.close();
  });

  test("eine kaputte Bilddatei faellt auf das Bild-Icon zurueck", async ({ page }) => {
    // Endung .png, aber kein PNG -> der Server kann kein Vorschaubild rechnen
    const broken = uniqueName("kaputt") + ".png";
    await uploadFile(page, broken, "kein echtes Bild");
    await waitAppReady(page);
    const icon = fileRow(page, broken).locator("img.ficon");
    // js/files/image-view.js tauscht die Quelle nach dem Fehler
    await expect.poll(() => icon.getAttribute("src")).toContain("image.svg");
  });
});
