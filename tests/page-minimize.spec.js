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
const MIN_BTN = "#page-minimize";
const TASK_BTN = "#page-restore";

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
    await expect(page.locator(".page-head .page-title")).toHaveText("Meine Dateien");
    await expect(page.locator(MIN_BTN)).toBeVisible();
    // solange die Karte offen ist, gibt es keine Taskleisten-Schaltflaeche
    await expect(page.locator(TASK_BTN)).toBeHidden();
  });

  test("Minimieren blendet die Karte aus und zeigt das Icon unten links", async ({ page }) => {
    await expect(page.locator(PAGE)).toBeVisible();
    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();
    await expect(page.locator(TASK_BTN)).toBeVisible();
  });

  test("das Dock-Icon traegt seinen Namen als Tooltip, der nach oben klappt", async ({ page }) => {
    await page.click(MIN_BTN);
    const icon = page.locator(TASK_BTN);
    await expect(icon).toHaveAttribute("data-tip", "Meine Dateien");
    // kein sichtbarer Beschriftungstext am Icon selbst
    await expect(icon).toHaveText("");

    await icon.hover();
    // Regression: Tooltips sitzen normalerweise UNTER dem Element — am unteren
    // Bildschirmrand waere er ausserhalb des Sichtbereichs. core/tooltips.js
    // klappt ihn dort nach oben (--tip-shift).
    const shift = await icon.evaluate((el) => el.style.getPropertyValue("--tip-shift"));
    expect(shift).toBe("-100%");
    const tipY = await icon.evaluate((el) => parseFloat(el.style.getPropertyValue("--tip-y")));
    const box = await icon.boundingBox();
    expect(tipY).toBeLessThanOrEqual(box.y); // oberhalb des Icons verankert
  });

  test("Klick auf das Icon stellt die Karte wieder her", async ({ page }) => {
    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();

    await page.click(TASK_BTN);
    await expect(page.locator(PAGE)).toBeVisible();
    await expect(page.locator(TASK_BTN)).toBeHidden();
    // die Liste ist danach normal bedienbar
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("der minimierte Zustand ueberlebt einen Reload", async ({ page }) => {
    await page.click(MIN_BTN);
    await expect(page.locator(TASK_BTN)).toBeVisible();

    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(PAGE)).toBeHidden();
    await expect(page.locator(TASK_BTN)).toBeVisible();

    // und das Wiederherstellen wird ebenso gemerkt
    await page.click(TASK_BTN);
    await expect(page.locator(PAGE)).toBeVisible();
    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(PAGE)).toBeVisible();
    await expect(page.locator(TASK_BTN)).toBeHidden();
  });

  test("der Zustand haengt am Nutzer, nicht am Browser", async ({ page, browser }) => {
    await page.click(MIN_BTN);
    await expect(page.locator(TASK_BTN)).toBeVisible();

    // frischer Browser-Kontext, gleicher Nutzer -> weiterhin eingeklappt
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const other = await ctx.newPage();
    await login(other, user.username, user.password);
    await waitAppReady(other);
    await expect(other.locator(PAGE)).toBeHidden();
    await expect(other.locator(TASK_BTN)).toBeVisible();
    await ctx.close();
  });

  test("Dateien bleiben nach dem Wiederherstellen sichtbar", async ({ page }) => {
    const filename = uniqueName("dok") + ".docx";
    await uploadFile(page, filename);
    await expect(fileRow(page, filename)).toBeVisible();

    await page.click(MIN_BTN);
    await expect(page.locator(PAGE)).toBeHidden();
    await page.click(TASK_BTN);
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
    await expect(page.locator(TASK_BTN)).toBeVisible();
  });
});
