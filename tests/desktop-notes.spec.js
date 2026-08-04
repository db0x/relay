// Schalter "ToDo-Notizen auf dem Desktop zeigen" (Mein Konto).
//
// Er haengt am NUTZER (users.desk_notes), nicht am Browser — und er blendet
// nur die Icons aus. Die Notizen selbst bleiben unberuehrt: Board und
// Dateiliste zeigen sie weiter, und die gemerkten Icon-Positionen ueberstehen
// das Aus- und Wiedereinschalten.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, createNote,
  openMenuDialog, waitAppReady, expectFlash,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

const SCHALTER = "#dlg-account input[name=deskNotes]";

// Konto-Dialog oeffnen, Schalter umlegen, speichern.
async function schalte(page) {
  await openMenuDialog(page, "dlg-account");
  await page.locator("#dlg-account .account-switch").click();
  await Promise.all([
    page.waitForNavigation(),
    page.locator("#dlg-account form[action$='/profile'] button").click(),
  ]);
  await waitAppReady(page);
}

test.describe("Notizen auf dem Desktop", () => {
  let user;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
    await createNote(page, "Desk " + uniqueName("n"), { todo: true });
    await waitAppReady(page);
  });

  test("ist ab Werk an und der Schalter zeigt das", async ({ page }) => {
    await expect(page.locator(".note-desk")).toHaveCount(1);
    await openMenuDialog(page, "dlg-account");
    await expect(page.locator(SCHALTER)).toBeChecked();
  });

  test("ausschalten nimmt die Icons weg — und nur die", async ({ page }) => {
    await schalte(page);
    await expectFlash(page, "Profil gespeichert");
    await expect(page.locator(".note-desk")).toHaveCount(0);

    // Board und Liste zeigen die Notiz weiter
    if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
    await expect(page.locator(".board-card")).toHaveCount(1);
    // Die Liste zeigt sie im Ordner "Notizen" — dort liegen alle Notizen
    // (routes/notes.js). Das Speichern des Profils hat uns in die Wurzel
    // zurueckgebracht, also nochmal hin.
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await expect(page.locator("table.files .note-open")).toHaveCount(1);
  });

  test("die Einstellung ueberlebt einen Reload", async ({ page }) => {
    await schalte(page);
    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(".note-desk")).toHaveCount(0);
    await openMenuDialog(page, "dlg-account");
    await expect(page.locator(SCHALTER)).not.toBeChecked();
  });

  test("wieder einschalten bringt die Icons zurueck", async ({ page }) => {
    await schalte(page);
    await expect(page.locator(".note-desk")).toHaveCount(0);
    await schalte(page);
    await expect(page.locator(".note-desk")).toHaveCount(1);
  });

  test("der Schalter haengt am Nutzer, nicht am Browser", async ({ page, browser }) => {
    await schalte(page);
    await expect(page.locator(".note-desk")).toHaveCount(0);

    // andere Sitzung, gleicher Nutzer -> ebenfalls aus
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const p2 = await ctx.newPage();
    await login(p2, user.username, user.password);
    await waitAppReady(p2);
    await expect(p2.locator(".note-desk")).toHaveCount(0);
    await ctx.close();

    // anderer Nutzer -> unberuehrt (er hat eigene Notizen, aber den Standard an)
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    const p3 = await ctx2.newPage();
    await loginAsAdmin(p3);
    await waitAppReady(p3);
    await openMenuDialog(p3, "dlg-account");
    await expect(p3.locator(SCHALTER)).toBeChecked();
    await ctx2.close();
  });
});
