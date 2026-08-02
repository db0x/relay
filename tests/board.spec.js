// Notiz-Board: zweites Fenster des Desktops mit drei Status-Spalten.
// Ziehen einer Notiz in eine andere Spalte setzt ihren Bearbeitungsstand.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, createNote,
  deskIcon, shareFile, waitAppReady, expectFlash,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

const BOARD = "#board";
const TOGGLE = "#board-toggle";
const col = (status) => `.board-col[data-status="${status}"]`;
const card = (title) => `.board-card[data-label="${title}"]`;

// Karte in eine andere Spalte ziehen (Pointer-Events, wie im echten Gebrauch)
async function dragCardTo(page, title, status) {
  const from = await page.locator(card(title)).boundingBox();
  const to = await page.locator(`${col(status)} .board-drop`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // in Schritten, damit die Bewegung als Ziehen erkannt wird (Schwelle 4px)
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await page.mouse.up();
}

// Board oeffnen, falls es zugeklappt ist (Vorgabe) — idempotent, damit die
// Tests nicht von der Startvorgabe abhaengen.
async function openBoard(page) {
  if (await page.locator("#board.page-min").count()) await page.click(TOGGLE);
  await expect(page.locator(BOARD)).toBeVisible();
}

// In welcher Spalte liegt die Karte gerade?
function columnOf(page, title) {
  return page.locator(card(title)).evaluate((el) => el.closest(".board-col").dataset.status);
}

test.describe("Notiz-Board", () => {
  let user;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
  });

  test("startet eingeklappt und laesst sich ueber die Topbar oeffnen", async ({ page }) => {
    // Offen wuerde es die Dateiliste verdecken -> Zweitansicht startet zu
    await expect(page.locator(BOARD)).toBeHidden();
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");

    await page.click(TOGGLE);
    await expect(page.locator(BOARD)).toBeVisible();
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
    // "Neue Notiz" ist ins Anwendungs-Menue am Logo umgezogen — im
    // Board-Kopf steht sie nicht mehr (siehe topbar-appmenu.spec.js)
    await expect(page.locator("#board #note-new")).toHaveCount(0);
    await page.click(TOGGLE);
    await expect(page.locator(BOARD)).toBeHidden();
    await page.click(TOGGLE);
    // drei Spalten in der erwarteten Reihenfolge
    await expect(page.locator(".board-col")).toHaveCount(3);
    await expect(page.locator(".board-col-title")).toHaveText(["Offen", "In Arbeit", "Erledigt"]);
  });

  test("neue Notizen landen in der Spalte „Offen“", async ({ page }) => {
    const title = "Brd " + uniqueName("n");
    await createNote(page, title);
    await openBoard(page);
    await expect(page.locator(card(title))).toBeVisible();
    expect(await columnOf(page, title)).toBe("open");
  });

  test("auch Notizen OHNE ToDo stehen auf dem Board", async ({ page }) => {
    // genau die Luecke, die das Board schliesst: ohne ToDo gibt es kein
    // Desktop-Icon und damit sonst keinen Weg zum Statuswechsel
    const title = "Ohne ToDo " + uniqueName("n");
    await createNote(page, title, { todo: false });
    await openBoard(page);
    await expect(page.locator(card(title))).toBeVisible();
    await expect(deskIcon(page, title)).toHaveCount(0);
  });

  test("Ziehen in eine andere Spalte aendert den Status dauerhaft", async ({ page }) => {
    const title = "Zieh " + uniqueName("n");
    await createNote(page, title);
    await openBoard(page);
    expect(await columnOf(page, title)).toBe("open");

    await dragCardTo(page, title, "wip");
    expect(await columnOf(page, title)).toBe("wip");
    await expect(page.locator(card(title))).toHaveAttribute("data-status", "wip");

    // wirklich gespeichert, nicht nur verschoben
    await page.reload();
    await waitAppReady(page);
    expect(await columnOf(page, title)).toBe("wip");
  });

  test("Ziehen nach „Erledigt“ daempft die Karte", async ({ page }) => {
    const title = "Fertig " + uniqueName("n");
    await createNote(page, title);
    await openBoard(page);
    await dragCardTo(page, title, "closed");
    expect(await columnOf(page, title)).toBe("closed");
    await expect(page.locator(card(title))).toHaveClass(/note-desk-done/);
  });

  test("die Spaltenzaehler stimmen nach dem Ziehen", async ({ page }) => {
    const title = "Zaehl " + uniqueName("n");
    await createNote(page, title);
    await openBoard(page);
    const openCount = page.locator(`${col("open")} .board-col-count`);
    const wipCount = page.locator(`${col("wip")} .board-col-count`);
    await expect(openCount).toHaveText("1");
    await expect(wipCount).toHaveText("0");

    await dragCardTo(page, title, "wip");
    await expect(openCount).toHaveText("0");
    await expect(wipCount).toHaveText("1");
  });

  test("Board und Desktop-Icon zeigen denselben Stand", async ({ page }) => {
    // Eine ToDo-Notiz ist BEIDES: Karte auf dem Board und Icon auf dem Desktop.
    // Ein Wechsel per Kontextmenue muss auf dem Board ankommen — und umgekehrt.
    const title = "Sync " + uniqueName("n");
    await createNote(page, title, { todo: true });
    await openBoard(page);
    const icon = deskIcon(page, title);

    // Kontextmenue am Desktop-Icon -> Board sortiert um
    await icon.click({ button: "right" });
    await page.locator('#note-status-menu [data-status="wip"]').click();
    await expect(icon).toHaveAttribute("data-status", "wip");
    expect(await columnOf(page, title)).toBe("wip");

    // Ziehen auf dem Board -> Desktop-Icon zieht nach
    await dragCardTo(page, title, "closed");
    await expect(icon).toHaveAttribute("data-status", "closed");
    await expect(icon).toHaveClass(/note-desk-done/);
  });

  test("Klick auf eine Karte oeffnet die Notiz", async ({ page }) => {
    const title = "Oeffne " + uniqueName("n");
    await createNote(page, title);
    await openBoard(page);
    await page.locator(card(title)).click();
    await expect(page.locator("#dlg-note")).toBeVisible();
    await expect(page.locator("#dlg-note-title")).toHaveText(title);
  });

  test("Fensterlage und Zustand werden gemerkt", async ({ page }) => {
    await openBoard(page);
    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(BOARD)).toBeVisible();

    await page.click("#board-minimize");
    await expect(page.locator(BOARD)).toBeHidden();
    await page.reload();
    await waitAppReady(page);
    await expect(page.locator(BOARD)).toBeHidden();
  });

  test("Fenster liegen ueber den Desktop-Icons, angeklicktes nach vorn", async ({ page }) => {
    await openBoard(page);
    const layers = await page.evaluate(() => ({
      icons: +getComputedStyle(document.querySelector(".note-desktop")).zIndex,
      page: +document.querySelector("#page").style.zIndex,
      board: +document.querySelector("#board").style.zIndex,
    }));
    // Icons gehoeren auf den Desktop — unter JEDES Fenster
    expect(layers.icons).toBeLessThan(layers.page);
    expect(layers.icons).toBeLessThan(layers.board);
    // zuletzt geoeffnetes Fenster liegt oben
    expect(layers.board).toBeGreaterThan(layers.page);

    // Klick auf die Dateiliste holt sie nach vorn. Der Punkt liegt bewusst
    // oben links: das Board startet versetzt (cascade), dieser Streifen der
    // Dateiliste bleibt also frei — und er ist da, egal wie kurz die Liste ist.
    await page.locator("#page").click({ position: { x: 20, y: 30 } });
    const after = await page.evaluate(() => ({
      page: +document.querySelector("#page").style.zIndex,
      board: +document.querySelector("#board").style.zIndex,
    }));
    expect(after.page).toBeGreaterThan(after.board);
  });

  test("nur-lesend freigegebene Notizen sind nicht ziehbar", async ({ page, browser }) => {
    const title = "Fremd " + uniqueName("n");
    await createNote(page, title);

    // zweiten Nutzer anlegen und die Notiz NUR ZUM LESEN freigeben
    const ctx0 = await browser.newContext({ baseURL: BASE_URL });
    const admin = await ctx0.newPage();
    await loginAsAdmin(admin);
    const reader = await createUser(admin);
    await ctx0.close();
    await page.reload(); // Empfaenger steht erst nach dem Neuladen zur Auswahl
    await waitAppReady(page);
    await shareFile(page, title, reader.username, "view");
    await expectFlash(page, "freigegeben");

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const other = await ctx.newPage();
    await login(other, reader.username, reader.password);
    await waitAppReady(other);

    await openBoard(other);
    const foreign = other.locator(card(title));
    await expect(foreign).toBeVisible();               // sichtbar …
    await expect(foreign).toHaveClass(/board-card-fixed/); // … aber festgesetzt
    await dragCardTo(other, title, "wip");
    expect(await columnOf(other, title)).toBe("open"); // unveraendert
    await ctx.close();
  });

  test("„Nur eigene Notizen“ blendet Fremdes aus und zaehlt richtig", async ({ page, browser }) => {
    const mine = "Meins " + uniqueName("n");
    await createNote(page, mine);
    await openBoard(page);
    // ohne Freigaben haette der Filter nichts zu tun -> er wird gar nicht erst
    // gerendert (dieselbe Regel wie unter der Dateiliste)
    await expect(page.locator("#board .list-footer")).toHaveCount(0);

    // der Admin gibt uns eine seiner Notizen frei
    const ctx0 = await browser.newContext({ baseURL: BASE_URL });
    const admin = await ctx0.newPage();
    await loginAsAdmin(admin);
    const shared = "Geteilt " + uniqueName("n");
    await createNote(admin, shared);
    await admin.reload(); // Empfaenger steht erst nach dem Neuladen zur Auswahl
    await waitAppReady(admin);
    await shareFile(admin, shared, user.username);
    await expectFlash(admin, "freigegeben");
    await ctx0.close();

    await page.reload();
    await waitAppReady(page);
    await openBoard(page);
    const openCount = page.locator(`${col("open")} .board-col-count`);
    await expect(page.locator(card(shared))).toBeVisible();
    await expect(openCount).toHaveText("2");

    // Filter an: die fremde Karte verschwindet, der Zaehler zieht nach
    await page.locator("#board .switch-label").click();
    await expect(page.locator(card(shared))).toBeHidden();
    await expect(page.locator(card(mine))).toBeVisible();
    await expect(openCount).toHaveText("1");

    // Zustand ueberlebt das Neuladen (localStorage, eigener Schluessel)
    await page.reload();
    await waitAppReady(page);
    await openBoard(page);
    await expect(page.locator("#board-own-only")).toBeChecked();
    await expect(page.locator(card(shared))).toBeHidden();
    await expect(openCount).toHaveText("1");

    // Und der Grenzfall: zieht man die eigene Karte weg, ist „Offen“ SICHTBAR
    // leer, obwohl dort noch eine ausgeblendete fremde Karte liegt — der
    // Platzhalter muss trotzdem erscheinen.
    await dragCardTo(page, mine, "wip");
    await expect(openCount).toHaveText("0");
    await expect(page.locator(`${col("open")} .board-empty`)).toBeVisible();
  });
});
