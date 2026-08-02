// Benachrichtigungen bei Freigaben: Glocke am Avatar, Uebersicht, Sprung zur
// Datei. "Gelesen" heisst geloescht — in der Anzeige UND in der Datenbank.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, uploadFile,
  fileRow, shareFile, unshareFile, deleteFile, waitAppReady, expectFlash,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

const BELL = "#notif-badge";
const COUNT = "#notif-count";

// Als `owner` eine Datei anlegen und fuer `target` freigeben
async function shareTo(page, filename, target, perm = "edit") {
  await uploadFile(page, filename);
  await waitAppReady(page);
  await page.reload(); // Empfaenger steht erst nach dem Neuladen zur Auswahl
  await waitAppReady(page);
  await shareFile(page, filename, target, perm);
  await expectFlash(page, "freigegeben");
}

test.describe("Benachrichtigungen", () => {
  let owner, recipient, filename;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    owner = await createUser(page);
    recipient = await createUser(page);
    await logout(page);
    await login(page, owner.username, owner.password);
    await waitAppReady(page);
    filename = uniqueName("dok") + ".docx";
  });

  // Sitzung des Empfaengers
  async function asRecipient(browser) {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const p = await ctx.newPage();
    await login(p, recipient.username, recipient.password);
    await waitAppReady(p);
    return { ctx, page: p };
  }

  test("ohne Nachrichten gibt es keine Glocke", async ({ page }) => {
    await expect(page.locator(BELL)).toBeHidden();
  });

  test("eine Freigabe erzeugt beim Empfaenger eine Nachricht", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);

    const { ctx, page: rec } = await asRecipient(browser);
    await expect(rec.locator(BELL)).toBeVisible();
    await expect(rec.locator(COUNT)).toHaveText("1");

    await rec.click("#notif-btn");
    // Die Uebersicht ist ein Menue wie der Kebab daneben, kein Dialog
    await expect(rec.locator("#notif-panel")).toBeVisible();
    await expect(rec.locator("#notif-btn")).toHaveAttribute("aria-expanded", "true");
    const item = rec.locator(".notif-item").first();
    // wer / was
    await expect(item).toContainText(owner.display);
    await expect(item).toContainText(filename);
    // wann — Datum in deutscher Schreibweise
    await expect(item.locator(".notif-when")).toHaveText(/\d{2}\.\d{2}\.\d{4}/);
    await ctx.close();
  });

  test("die Uebersicht schliesst wie ein Menue (Escape, Klick daneben)", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    const { ctx, page: rec } = await asRecipient(browser);

    await rec.click("#notif-btn");
    await expect(rec.locator("#notif-panel")).toBeVisible();
    await rec.keyboard.press("Escape");
    await expect(rec.locator("#notif-panel")).toBeHidden();

    await rec.click("#notif-btn");
    await expect(rec.locator("#notif-panel")).toBeVisible();
    await rec.mouse.click(400, 700); // irgendwo daneben
    await expect(rec.locator("#notif-panel")).toBeHidden();
    await ctx.close();
  });

  test("beim Freigebenden selbst entsteht keine Nachricht", async ({ page }) => {
    await shareTo(page, filename, recipient.username);
    await expect(page.locator(BELL)).toBeHidden();
  });

  test("Klick auf eine Nachricht springt zur Datei und entfernt sie", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    const { ctx, page: rec } = await asRecipient(browser);

    await rec.click("#notif-btn");
    await rec.locator(".notif-item").first().click();

    // Zeile ist hervorgehoben …
    await expect(rec.locator("tr.row-highlight")).toHaveCount(1);
    await expect(fileRow(rec, filename)).toHaveClass(/row-highlight/);
    // … die Nachricht weg, die Glocke auch
    await expect(rec.locator(BELL)).toBeHidden();
    // und das bleibt auch nach dem Neuladen so (in der DB geloescht)
    await rec.reload();
    await waitAppReady(rec);
    await expect(rec.locator(BELL)).toBeHidden();
    await ctx.close();
  });

  test("der Sprung klappt die Dateiliste auf, wenn sie zu ist", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    const { ctx, page: rec } = await asRecipient(browser);

    await rec.click("#page-minimize");
    await expect(rec.locator("#page")).toBeHidden();

    await rec.click("#notif-btn");
    await rec.locator(".notif-item").first().click();
    await expect(rec.locator("#page")).toBeVisible();
    await expect(fileRow(rec, filename)).toBeVisible();
    await ctx.close();
  });

  test("mehr als neun Nachrichten zeigen 9+", async ({ page, browser }) => {
    // Zehn Uploads plus zehn Freigaben, jedes mit eigener Navigation — das
    // sprengt die 30s-Vorgabe, sobald die Maschine etwas zu tun hat.
    test.slow();
    // zehn Freigaben -> der Zaehler darf nicht zweistellig werden
    for (let i = 0; i < 10; i++) {
      await uploadFile(page, `${uniqueName("m")}.docx`);
      await waitAppReady(page);
    }
    await page.reload();
    await waitAppReady(page);
    const rows = page.locator("table.files tbody tr");
    const names = [];
    for (let i = 0; i < 10; i++) {
      names.push(await rows.nth(i).locator(".fname").innerText());
    }
    for (const n of names) await shareFile(page, n, recipient.username);

    const { ctx, page: rec } = await asRecipient(browser);
    await expect(rec.locator(COUNT)).toHaveText("9+");
    await ctx.close();
  });

  test("„Alle als gelesen“ raeumt alles weg", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    const second = uniqueName("dok") + ".docx";
    await uploadFile(page, second);
    await waitAppReady(page);
    await shareFile(page, second, recipient.username);

    const { ctx, page: rec } = await asRecipient(browser);
    await expect(rec.locator(COUNT)).toHaveText("2");

    // "Alle als gelesen" sitzt in der Nachrichten-Uebersicht selbst,
    // nicht im Hauptmenue daneben
    await rec.click("#notif-btn");
    await rec.click("#notif-read-all");
    await expect(rec.locator("#dlg-confirm")).toBeVisible();
    await Promise.all([rec.waitForNavigation(), rec.click("#dlg-confirm-ok")]);
    await waitAppReady(rec);
    await expect(rec.locator(BELL)).toBeHidden();
    await ctx.close();
  });

  test("wird die Freigabe entzogen, verschwindet die Nachricht", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    await unshareFile(page, filename, recipient.display);
    await expectFlash(page, "entzogen");

    const { ctx, page: rec } = await asRecipient(browser);
    await expect(rec.locator(BELL)).toBeHidden();
    await ctx.close();
  });

  test("wird die Datei geloescht, verschwindet die Nachricht", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    await deleteFile(page, filename);
    await expectFlash(page, "gelöscht");

    const { ctx, page: rec } = await asRecipient(browser);
    await expect(rec.locator(BELL)).toBeHidden();
    await ctx.close();
  });

  test("fremde Nachrichten lassen sich nicht wegraeumen", async ({ page, browser }) => {
    await shareTo(page, filename, recipient.username);
    const { ctx, page: rec } = await asRecipient(browser);
    await rec.click("#notif-btn");
    const id = await rec.locator(".notif-item").first().getAttribute("data-id");
    await ctx.close();

    // Der Besitzer versucht, die Nachricht des Empfaengers zu loeschen
    const res = await page.request.post("/notifications/read", {
      data: { id: Number(id) }, maxRedirects: 0,
    });
    expect(res.status()).toBe(204); // Route antwortet freundlich …

    const again = await asRecipient(browser);
    // … aber die Nachricht steht noch: notifications.js filtert nach Empfaenger
    await expect(again.page.locator(BELL)).toBeVisible();
    await again.ctx.close();
  });
});
