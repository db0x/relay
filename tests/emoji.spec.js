// Emojis im Notiz-Editor: Kuerzel wie :) werden beim Tippen ersetzt, und die
// Auswahl in der Werkzeugleiste fuegt eines an der Schreibmarke ein.
//
// Die Ersetzung passiert BEIM TIPPEN, das Emoji steht also wirklich im Text —
// darum taucht es auch im Titel, in der Liste und auf dem Board auf.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, fileRow, waitAppReady,
} = require("./helpers/relay");

// Inhalt des Editors auslesen (CodeMirror haelt ihn, nicht die Textarea)
function editorText(page) {
  return page.evaluate(() => document.querySelector(".CodeMirror").CodeMirror.getValue());
}

// Notiz-Dialog oeffnen und den Editor leeren
async function openEmptyEditor(page) {
  if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
  await page.click("#note-new");
  await expect(page.locator("#dlg-note")).toBeVisible();
  await page.click(".CodeMirror");
  await page.keyboard.press("Control+A");
}

test.describe("Emojis in Notizen", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
  });

  test("Kuerzel werden beim Tippen ersetzt", async ({ page }) => {
    await openEmptyEditor(page);
    await page.keyboard.type("Hallo :) und ;) und <3 ");
    expect(await editorText(page)).toBe("Hallo 🙂 und 😉 und ❤️ ");
  });

  test("Ersetzt wird erst mit dem Leerzeichen danach", async ({ page }) => {
    await openEmptyEditor(page);
    await page.keyboard.type("Noch nicht :)");
    // ohne abschliessendes Leerzeichen bleibt das Kuerzel stehen
    expect(await editorText(page)).toBe("Noch nicht :)");
    await page.keyboard.type(" ");
    expect(await editorText(page)).toBe("Noch nicht 🙂 ");
  });

  test("in einer URL wird nichts ersetzt", async ({ page }) => {
    // "://" enthaelt das Kuerzel ":/" — davor steht aber ein Buchstabe,
    // und nur am Wortanfang wird ersetzt
    await openEmptyEditor(page);
    await page.keyboard.type("Siehe https://beispiel.de/x hier ");
    expect(await editorText(page)).toContain("https://beispiel.de/x");
  });

  test("in Code bleibt das Kuerzel stehen", async ({ page }) => {
    await openEmptyEditor(page);
    await page.keyboard.type("Text `Code :) bleibt` fertig ");
    const text = await editorText(page);
    expect(text).toContain("`Code :) bleibt`");
  });

  test("die Auswahl fuegt ein Emoji an der Schreibmarke ein", async ({ page }) => {
    await openEmptyEditor(page);
    await page.keyboard.type("Kuchen ");
    await page.click("#emoji-btn");
    const panel = page.locator("#emoji-panel");
    await expect(panel).toBeVisible();
    // erstes Emoji der ersten Gruppe
    const first = panel.locator(".emoji-btn").first();
    const ch = await first.textContent();
    await first.click();
    expect(await editorText(page)).toBe("Kuchen " + ch);
    // nach der Wahl schliesst sich die Auswahl wieder
    await expect(panel).toBeHidden();
  });

  test("Escape schliesst die Auswahl ohne einzufuegen", async ({ page }) => {
    await openEmptyEditor(page);
    await page.keyboard.type("Text ");
    await page.click("#emoji-btn");
    await expect(page.locator("#emoji-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#emoji-panel")).toBeHidden();
    expect(await editorText(page)).toBe("Text ");
  });

  test("ein Emoji im Titel steht auch in der Dateiliste", async ({ page }) => {
    const title = "Feier " + uniqueName("n");
    await openEmptyEditor(page);
    // Titelzeile mit Kuerzel — nach dem Leerzeichen wird ersetzt
    await page.keyboard.type(`# :D ${title}\n\nInhalt.`);
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await expect(fileRow(page, "😀 " + title)).toBeVisible();
  });
});
