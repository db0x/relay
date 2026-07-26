// Bearbeitungsstand einer Notiz: Offen / In Arbeit / Erledigt.
//
// Unabhaengig vom ToDo-Schalter. Gesetzt wird er entweder im Notiz-Dialog
// (Auswahlbox, ueber den normalen Speichern-Weg) oder per Rechtsklick auf ein
// Desktop-Icon. Beide Wege werden hier abgedeckt — plus der Sicherheitsfall,
// dass eine nur-lesende Freigabe den Status NICHT umstellen darf.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, createNote, openNote,
  deskIcon, shareFile, fileRow, expectFlash, postForm,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

// Notizen liegen immer im Ordner "Notizen" — nach dem Speichern landet man
// dort; die Desktop-Icons sind ordnerunabhaengig immer sichtbar.
const NOTE_STATUS_BADGE = "#note-view-summary .note-summary-badge";

test.describe("Notiz-Status", () => {
  let user, title;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    title = "Status " + uniqueName("n");
  });

  test("eine neue Notiz startet auf „Offen“", async ({ page }) => {
    await createNote(page, title);
    await openNote(page, title);
    await expect(page.locator(NOTE_STATUS_BADGE).first()).toHaveText("Offen");
  });

  test("der Dialog bietet keine Moeglichkeit, den Status zu aendern", async ({ page }) => {
    // Bewusste Entscheidung: der Bearbeitungsstand laeuft ausschliesslich
    // ueber das Kontextmenue der Notiz-Icons. Der Dialog ZEIGT ihn nur.
    await createNote(page, title, { todo: true });
    await openNote(page, title);
    await expect(page.locator(NOTE_STATUS_BADGE).first()).toBeVisible();
    await page.click("#note-edit");
    await expect(page.locator("#note-details select[name=status]")).toHaveCount(0);
  });

  test("Speichern der Notiz laesst den Status unangetastet", async ({ page }) => {
    // Regression: das Formular schickt kein status-Feld mehr mit — wuerde der
    // Server ihn trotzdem daraus lesen, setzte jedes Speichern ihn auf "open".
    await createNote(page, title, { todo: true });
    const icon = deskIcon(page, title);
    await icon.click({ button: "right" });
    await page.locator('#note-status-menu [data-status="wip"]').click();
    await expect(icon).toHaveAttribute("data-status", "wip");

    // Notiz oeffnen, Text aendern, speichern
    await openNote(page, title);
    await page.click("#note-edit");
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nNachtrag.");
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);
    await expectFlash(page, "Notiz gespeichert");

    // Status hat ueberlebt — im Badge wie am Desktop-Icon
    await openNote(page, title);
    await expect(page.locator(NOTE_STATUS_BADGE).first()).toHaveText("In Arbeit");
    await page.locator("#dlg-note .dialog-x").click();
    await expect(deskIcon(page, title)).toHaveAttribute("data-status", "wip");
  });

  test("Status ueberlebt auch das Abwaehlen des ToDo-Schalters", async ({ page }) => {
    // Beweist die Unabhaengigkeit der beiden Eigenschaften: ohne ToDo
    // verschwindet zwar das Desktop-Icon, der Status bleibt aber bestehen.
    await createNote(page, title, { todo: true });
    const icon = deskIcon(page, title);
    await icon.click({ button: "right" });
    await page.locator('#note-status-menu [data-status="closed"]').click();
    await expect(icon).toHaveAttribute("data-status", "closed");

    await openNote(page, title);
    await page.click("#note-edit");
    await page.locator("#note-details .switch-label").click(); // ToDo aus
    await Promise.all([page.waitForNavigation(), page.click("#note-save")]);

    await expect(deskIcon(page, title)).toHaveCount(0); // kein Icon mehr …
    await openNote(page, title);
    // … aber der Status steht weiterhin
    await expect(page.locator(NOTE_STATUS_BADGE).first()).toHaveText("Erledigt");
  });

  test("Rechtsklick auf das Desktop-Icon wechselt den Status", async ({ page }) => {
    await createNote(page, title, { todo: true });
    const icon = deskIcon(page, title);
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("data-status", "open");

    await icon.click({ button: "right" });
    const menu = page.locator("#note-status-menu");
    await expect(menu).toBeVisible();
    // der aktuelle Stand ist markiert
    await expect(menu.locator('[data-status="open"]')).toHaveClass(/menu-item-active/);

    await menu.locator('[data-status="closed"]').click();
    // ohne Neuladen: das Icon aktualisiert sich an Ort und Stelle
    await expect(icon).toHaveAttribute("data-status", "closed");
    await expect(icon).toHaveClass(/note-desk-done/);
    await expect(menu).toBeHidden();

    // und es haelt auch nach einem Reload
    await page.reload();
    await expect(deskIcon(page, title)).toHaveClass(/note-desk-done/);
  });

  test("die Hover-Vorschau zeigt nach einem Statuswechsel den neuen Stand", async ({ page }) => {
    // Regression: die Vorschau cacht Inhalt UND Metadaten je Notiz. Das war
    // sicher, solange jede Aenderung ueber einen Formular-Post mit Reload lief
    // — das Kontextmenue aendert den Status aber bewusst OHNE Neuladen.
    await createNote(page, title, { todo: true });
    const icon = deskIcon(page, title);
    const tip = page.locator("#note-tip");

    await icon.hover();
    await expect(tip).toHaveClass(/open/);
    await expect(tip).toContainText("Offen");

    await icon.click({ button: "right" });
    await page.locator('#note-status-menu [data-status="wip"]').click();
    await expect(icon).toHaveAttribute("data-status", "wip");

    // Maus weg und wieder drauf -> die Vorschau muss den neuen Stand zeigen
    await page.mouse.move(5, 5);
    await expect(tip).not.toHaveClass(/open/);
    await icon.hover();
    await expect(tip).toHaveClass(/open/);
    await expect(tip).toContainText("In Arbeit");
    await expect(tip).not.toContainText("Offen");
  });

  test("Escape schliesst das Kontextmenue ohne Aenderung", async ({ page }) => {
    await createNote(page, title, { todo: true });
    const icon = deskIcon(page, title);
    await icon.click({ button: "right" });
    await expect(page.locator("#note-status-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#note-status-menu")).toBeHidden();
    await expect(icon).toHaveAttribute("data-status", "open");
  });

  test("nur-lesende Freigabe darf den Status nicht aendern", async ({ page, browser }) => {
    // Der Besitzer legt eine ToDo-Notiz an und gibt sie NUR ZUM LESEN frei.
    await createNote(page, title, { todo: true });
    const other = await (async () => {
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const p = await ctx.newPage();
      await loginAsAdmin(p);
      const u = await createUser(p);
      await ctx.close();
      return u;
    })();
    // Die Auswahl "Freigeben fuer" wird serverseitig beim Seitenaufbau
    // gefuellt -> nach dem Anlegen des Empfaengers neu laden, sonst steht er
    // noch nicht drin.
    await page.reload();
    const noteFile = await page.locator(".note-open").filter({ hasText: title })
      .first().getAttribute("data-rel");
    await shareFile(page, title, other.username, "view");

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const readerPage = await ctx.newPage();
    await login(readerPage, other.username, other.password);

    // Die Notiz ist sichtbar …
    await expect(fileRow(readerPage, title)).toBeVisible();
    // … das Desktop-Icon bietet gar kein Kontextmenue an (data-canedit=0) …
    await expect(deskIcon(readerPage, title)).toHaveAttribute("data-canedit", "0");
    // … und der direkte Weg am Menue vorbei wird serverseitig abgewiesen.
    const res = await readerPage.request.post("/notes/status", {
      data: { owner: user.username, filename: noteFile, status: "closed" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);

    // beim Besitzer unveraendert
    await page.reload();
    await expect(deskIcon(page, title)).toHaveAttribute("data-status", "open");
    await ctx.close();
  });

  test("ein unbekannter Statuswert wird abgewiesen", async ({ page }) => {
    await createNote(page, title, { todo: true });
    const noteFile = await deskIcon(page, title).getAttribute("data-rel");
    const res = await page.request.post("/notes/status", {
      data: { owner: user.username, filename: noteFile, status: "erledigt-vielleicht" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
  });
});
