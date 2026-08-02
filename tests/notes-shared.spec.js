// Mir freigegebene Notizen als solche erkennen.
//
// Anlass: eigene und freigegebene Notizen liegen auf Desktop und Board
// nebeneinander und sahen bis dahin gleich aus. Zwei Kennzeichen:
//   - ein share.svg-Overlay am Icon (Desktop UND Board)
//   - ein Badge "Freigegeben von <Name>" in der Hover-Vorschau und in der
//     Lese-Ansicht des Notiz-Dialogs (bei nur-lesenden Freigaben mit Zusatz)
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, createNote,
  deskIcon, shareFile, waitAppReady, expectFlash,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

const boardCard = (page, title) => page.locator(`.board-card[data-label="${title}"]`);

// Ob am Icon des Knopfes wirklich ein Overlay gezeichnet wird — die Klasse
// allein sagt noch nicht, dass die CSS-Regel greift.
function hasOverlay(locator) {
  return locator.evaluate((el) =>
    getComputedStyle(el.querySelector(".note-ico-wrap"), "::after").content !== "none");
}

test.describe("Freigegebene Notizen kennzeichnen", () => {
  let owner, reader, mine, shared;

  // Der Besitzer legt zwei ToDo-Notizen an (ToDo -> sie liegen auch auf dem
  // Desktop) und gibt eine davon frei; getestet wird aus Sicht des Empfaengers.
  async function setup(page, browser, perm) {
    await loginAsAdmin(page);
    owner = await createUser(page);
    reader = await createUser(page);
    await logout(page);
    await login(page, owner.username, owner.password);
    await waitAppReady(page);

    shared = "Geteilt " + uniqueName("n");
    await createNote(page, shared, { todo: true });
    await page.reload();
    await waitAppReady(page);
    await shareFile(page, shared, reader.username, perm);
    await expectFlash(page, "freigegeben");

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const p = await ctx.newPage();
    await login(p, reader.username, reader.password);
    await waitAppReady(p);
    // eine eigene Notiz des Empfaengers als Gegenprobe
    mine = "Eigen " + uniqueName("n");
    await createNote(p, mine, { todo: true });
    return { ctx, page: p };
  }

  test("das Desktop-Icon bekommt ein Freigabe-Overlay, das eigene nicht",
    async ({ page, browser }) => {
      const { ctx, page: p } = await setup(page, browser, "edit");
      await expect(deskIcon(p, shared)).toHaveClass(/note-shared/);
      await expect(deskIcon(p, mine)).not.toHaveClass(/note-shared/);
      expect(await hasOverlay(deskIcon(p, shared))).toBe(true);
      expect(await hasOverlay(deskIcon(p, mine))).toBe(false);
      await ctx.close();
    });

  test("auch die Board-Karte bekommt das Overlay", async ({ page, browser }) => {
    const { ctx, page: p } = await setup(page, browser, "edit");
    if (await p.locator("#board.page-min").count()) await p.click("#board-toggle");
    await expect(boardCard(p, shared)).toHaveClass(/note-shared/);
    await expect(boardCard(p, mine)).not.toHaveClass(/note-shared/);
    expect(await hasOverlay(boardCard(p, shared))).toBe(true);
    await ctx.close();
  });

  test("die Hover-Vorschau nennt, wer die Notiz freigegeben hat",
    async ({ page, browser }) => {
      const { ctx, page: p } = await setup(page, browser, "edit");
      const tip = p.locator("#note-tip");

      await deskIcon(p, shared).hover();
      await expect(tip).toHaveClass(/open/);
      await expect(tip).toContainText(`Freigegeben von ${owner.display}`);
      // Bearbeiten erlaubt -> kein Lese-Zusatz
      await expect(tip).not.toContainText("nur lesen");

      // eigene Notiz: kein Freigabe-Badge
      await p.mouse.move(5, 5);
      await expect(tip).not.toHaveClass(/open/);
      await deskIcon(p, mine).hover();
      await expect(tip).toHaveClass(/open/);
      await expect(tip).not.toContainText("Freigegeben von");
      await ctx.close();
    });

  test("nur-lesende Freigaben stehen als solche im Badge", async ({ page, browser }) => {
    const { ctx, page: p } = await setup(page, browser, "view");
    await deskIcon(p, shared).hover();
    await expect(p.locator("#note-tip")).toContainText(
      `Freigegeben von ${owner.display} · nur lesen`);

    // dasselbe Badge in der Lese-Ansicht des geoeffneten Dialogs
    await deskIcon(p, shared).click();
    await expect(p.locator("#dlg-note")).toBeVisible();
    await expect(p.locator("#note-view-summary")).toContainText(
      `Freigegeben von ${owner.display} · nur lesen`);
    await ctx.close();
  });

  test("der Besitzer selbst sieht kein Freigabe-Badge an seiner Notiz",
    async ({ page, browser }) => {
      // Gegenprobe zur Datenquelle: sharedBy haengt am Betrachter, nicht an
      // der Notiz — beim Besitzer darf es gar nicht erst mitkommen.
      const { ctx } = await setup(page, browser, "edit");
      await ctx.close();
      await page.reload();
      await waitAppReady(page);
      await deskIcon(page, shared).hover();
      await expect(page.locator("#note-tip")).toHaveClass(/open/);
      await expect(page.locator("#note-tip")).not.toContainText("Freigegeben von");
    });
});
