// Notiz-Titel mit Emojis, Umlauten, ß und nicht-lateinischer Schrift.
//
// Hintergrund: Der Dateiname wird aus der Titelzeile gebaut und ist bewusst
// auf ASCII beschraenkt (secureFilename wehrt Pfad-Tricks ab). Der ANGEZEIGTE
// Titel steht darum getrennt in note_meta.title — sonst wuerde aus
// "🎉 Geburtstag" auf dem Bildschirm "Geburtstag".
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, createNote, openNote,
  deskIcon, fileRow, waitAppReady,
} = require("./helpers/relay");

// Board-Karte zu einem Titel
const card = (title) => `.board-card[data-label="${title}"]`;

test.describe("Notiz-Titel mit Sonderzeichen", () => {
  let user;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
  });

  test("Emojis im Titel bleiben in der Liste erhalten", async ({ page }) => {
    const title = "🎉 Geburtstag " + uniqueName("n");
    await createNote(page, title);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await expect(fileRow(page, title).locator(".note-open")).toHaveAttribute("data-label", title);
  });

  test("Umlaute, ß und Sonderzeichen bleiben erhalten", async ({ page }) => {
    const title = "Straße & Müll ♻️ " + uniqueName("n");
    await createNote(page, title);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await expect(fileRow(page, title).locator(".note-open")).toHaveAttribute("data-label", title);
  });

  test("nicht-lateinische Schrift geht nicht verloren", async ({ page }) => {
    // Frueher blieb hier gar nichts uebrig -> die Notiz hiess schlicht "Notiz"
    const title = "Урок " + uniqueName("n");
    await createNote(page, title);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await expect(fileRow(page, title).locator(".note-open")).toHaveAttribute("data-label", title);
  });

  test("der Titel steht auch am Desktop-Icon und auf der Board-Karte", async ({ page }) => {
    const title = "🐣 Ostern " + uniqueName("n");
    await createNote(page, title, { todo: true });
    await expect(deskIcon(page, title)).toBeVisible();
    await page.click("#board-toggle");
    await expect(page.locator(card(title))).toBeVisible();
  });

  test("der Dialog zeigt den vollen Titel", async ({ page }) => {
    const title = "🎂 Kuchen " + uniqueName("n");
    await createNote(page, title);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await openNote(page, title);
    await expect(page.locator("#dlg-note-title")).toHaveText(title);
  });

  test("ein geaenderter Titel zieht ueberall nach", async ({ page }) => {
    const before = "Alt " + uniqueName("n");
    const after = "✨ Neu " + uniqueName("n");
    await createNote(page, before, { todo: true });
    await page.goto("/?p=Notizen");
    await waitAppReady(page);

    await openNote(page, before);
    await page.click("#note-edit");
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+A");
    await page.keyboard.type(`# ${after}\n\nInhalt.`);
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);
    await waitAppReady(page);

    await expect(deskIcon(page, after)).toBeVisible();
    await expect(deskIcon(page, before)).toHaveCount(0);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await expect(fileRow(page, after)).toBeVisible();
  });

  test("die Datei auf der Platte bleibt ASCII", async ({ page }) => {
    // Der Dateiname ist die Sicherheitsgrenze (secureFilename) und traegt
    // weiterhin nur ASCII — sichtbar an der Download-URL der Zeile.
    const title = "🎉 Ünïcödé " + uniqueName("n");
    await createNote(page, title);
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await fileRow(page, title).locator(".row-menu-btn").click();
    const href = await fileRow(page, title).locator('a[href*="/download/"]').getAttribute("href");
    const decoded = decodeURIComponent(href);
    expect(decoded).not.toMatch(/[^\x00-\x7F]/); // keine Nicht-ASCII-Zeichen
    expect(decoded).toContain(".md");
  });
});
