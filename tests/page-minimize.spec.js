// Dateiliste minimieren und wiederherstellen.
//
// Die Karte bekommt eine Titelleiste mit Minimieren-Knopf; eingeklappt wird
// sie durch eine Schaltflaeche unten links vertreten. Der Zustand wird
// serverseitig gemerkt (desktop_layout.minimized) und ist damit auch nach
// einem Reload und in einer neuen Sitzung noch da.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uploadFile, uniqueName,
  fileRow, waitAppReady,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

const PAGE = "#page";
const MIN_BTN = "#page-minimize";   // Knopf IN der Titelleiste des Fensters
const TOGGLE = "#page-toggle";      // Umschalter in der Topbar (immer sichtbar)

test.describe("Dateiliste minimieren", () => {
  let user;

  test.beforeEach(async ({ page }) => {
    // eigener Nutzer je Test: der gemerkte Zustand haengt am Nutzer
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
  });

  test("die Titelleiste zeigt Titel und Minimieren-Knopf", async ({ page }) => {
    // auf #page eingegrenzt: seit dem Notiz-Board gibt es mehr als ein Fenster
    await expect(page.locator("#page .page-head .page-title")).toHaveText("Meine Dateien");
    await expect(page.locator(MIN_BTN)).toBeVisible();
  });

  test("der Umschalter in der Topbar ist immer da und zeigt den Zustand", async ({ page }) => {
    const toggle = page.locator(TOGGLE);
    await expect(toggle).toBeVisible();
    // reines Icon mit Tooltip statt Beschriftung
    await expect(toggle).toHaveAttribute("data-tip", "Meine Dateien");
    await expect(toggle).toHaveText("");
    // Fenster offen -> gedrueckt
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await page.click(MIN_BTN);
    await expect(toggle).toBeVisible(); // bleibt sichtbar, anders als frueher das Dock
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("Minimieren blendet die Karte aus", async ({ page }) => {
    await expect(page.locator(PAGE)).toBeVisible();
    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();
  });

  test("der Umschalter schaltet in beide Richtungen", async ({ page }) => {
    const toggle = page.locator(TOGGLE);
    // zu …
    await toggle.click();
    await expect(page.locator(PAGE)).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // … und wieder auf
    await toggle.click();
    await expect(page.locator(PAGE)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("der minimierte Zustand ueberlebt einen Reload", async ({ page }) => {
    await page.click(MIN_BTN);
    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(PAGE)).toBeHidden();
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");

    // und das Wiederherstellen wird ebenso gemerkt
    await page.click(TOGGLE);
    await expect(page.locator(PAGE)).toBeVisible();
    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(PAGE)).toBeVisible();
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
  });

  test("der Zustand haengt am Nutzer, nicht am Browser", async ({ page, browser }) => {
    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();

    // frischer Browser-Kontext, gleicher Nutzer -> weiterhin eingeklappt
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const other = await ctx.newPage();
    await login(other, user.username, user.password);
    await waitAppReady(other);
    await expect(other.locator(PAGE)).toBeHidden();
    await expect(other.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
    await ctx.close();
  });

  test("Dateien bleiben nach dem Wiederherstellen sichtbar", async ({ page }) => {
    const filename = uniqueName("dok") + ".docx";
    await uploadFile(page, filename);
    await expect(fileRow(page, filename)).toBeVisible();

    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();
    await page.click(TOGGLE);
    await expect(fileRow(page, filename)).toBeVisible();
  });

  test("nach einem Ordnerwechsel funktioniert der Knopf weiterhin", async ({ page }) => {
    // Der Minimieren-Knopf sitzt IN der Karte und wird beim (AJAX-)
    // Ordnerwechsel mitgetauscht — der Handler haengt deshalb delegiert am
    // bleibenden #page. Diese Regression faengt der Test ab.
    await page.locator("[data-dialog=\"dlg-mkdir\"]").click();
    await page.fill("#dlg-mkdir input[name=name]", "Unterordner");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/mkdir")),
      page.click("#dlg-mkdir .dialog-submit"),
    ]);
    await waitAppReady(page);

    // per AJAX in den Ordner navigieren (kein Vollreload)
    await page.locator('a.fname[href*="Unterordner"]').click();
    await expect(page).toHaveURL(/Unterordner/);

    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  });
});
