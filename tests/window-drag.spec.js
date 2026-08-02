// Fenster verschieben: NUR an der Titelleiste.
//
// Frueher war die ganze Karte Greif-Flaeche — ein Griff daneben verschob das
// Fenster ungewollt. Jetzt zieht nur .page-head, wie beim Notiz-Dialog und wie
// bei einem echten Fenster. Gilt fuer alle ueber createWindow erzeugten
// Ansichten, hier geprueft an Dateiliste und Notiz-Board.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, uploadFile, uniqueName, waitAppReady,
} = require("./helpers/relay");

// Lage des Fensters, wie sie createWindow setzt (Inline-Stil)
function lage(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return { left: el.style.left, top: el.style.top };
  }, sel);
}

async function ziehen(page, box, dx, dy) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // in Schritten, sonst erkennt der Handler die Bewegung nicht als Zug
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe("Fenster verschieben", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitAppReady(page);
    // Ein offenes Board liegt ueber der Titelleiste der Dateiliste und finge
    // den Zug ab. Der Zustand wird serverseitig gemerkt, kann also aus einem
    // frueheren Test offen sein -> hier zuklappen.
    if (!(await page.locator("#board.page-min").count())) {
      await page.click("#board-toggle");
      await expect(page.locator("#board")).toBeHidden();
    }
  });

  test("der Zug an der Titelleiste verschiebt das Fenster", async ({ page }) => {
    const vorher = await lage(page, "#page");
    await ziehen(page, await page.locator("#page .page-title").boundingBox(), 90, 70);
    const nachher = await lage(page, "#page");
    expect(nachher.left).not.toBe(vorher.left);
    expect(nachher.top).not.toBe(vorher.top);
  });

  test("auch der Rahmenstreifen ueber der Leiste zieht", async ({ page }) => {
    // Die Titelleiste reicht per negativem Rand bis an die Fensterkante hoch:
    // der Streifen darueber (--page-pad) gehoert optisch zu ihr.
    const w = await page.locator("#page").boundingBox();
    const vorher = await lage(page, "#page");
    await ziehen(page, { x: w.x + w.width / 2 - 4, y: w.y + 2, width: 8, height: 6 }, 70, 60);
    expect(await lage(page, "#page")).not.toEqual(vorher);

    // und er zeigt denselben Zeiger wie die Leiste
    const treffer = await page.evaluate(() => {
      const r = document.querySelector("#page").getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
      return { klasse: el.className, cursor: getComputedStyle(el).cursor };
    });
    expect(treffer.klasse).toContain("page-head");
    expect(treffer.cursor).toBe("move");
  });

  test("der Zug am Inhalt verschiebt NICHTS", async ({ page }) => {
    await uploadFile(page, `${uniqueName("zieh")}.docx`);
    await waitAppReady(page);
    const vorher = await lage(page, "#page");

    // eine Tabellenzelle ohne Bedienelement
    await ziehen(page, await page.locator("#page td.col-size").first().boundingBox(), 120, 90);
    expect(await lage(page, "#page")).toEqual(vorher);

    // und der Leerraum unten im Fenster ebenfalls nicht
    const f = await page.locator("#page").boundingBox();
    await ziehen(page, { x: f.x + 40, y: f.y + f.height - 30, width: 8, height: 8 }, 100, 60);
    expect(await lage(page, "#page")).toEqual(vorher);
  });

  test("die Titelleiste zeigt den Verschiebe-Zeiger, das Fenster nicht",
    async ({ page }) => {
      const cursor = (sel) => page.evaluate((s) =>
        getComputedStyle(document.querySelector(s)).cursor, sel);
      expect(await cursor("#page .page-head")).toBe("move");
      expect(await cursor("#page")).not.toBe("move");
      // Knoepfe IN der Leiste behalten ihren Zeiger (ein <button> haette sonst
      // gar keinen — die Regel dafuer steht bewusst auf .page, nicht .page-head)
      expect(await cursor("#page-minimize")).toBe("pointer");
    });

  test("ein Zug am Knopf in der Leiste bewegt das Fenster nicht", async ({ page }) => {
    const vorher = await lage(page, "#page");
    await ziehen(page, await page.locator("#page-minimize").boundingBox(), 70, 50);
    expect(await lage(page, "#page")).toEqual(vorher);
  });

  test("dasselbe gilt fuer das Notiz-Board", async ({ page }) => {
    if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
    await expect(page.locator("#board")).toBeVisible();
    const vorher = await lage(page, "#board");

    // Inhalt (eine Statusspalte) bewegt nichts …
    await ziehen(page, await page.locator("#board .board-col").first().boundingBox(), 80, 60);
    expect(await lage(page, "#board")).toEqual(vorher);

    // … die Titelleiste schon
    await ziehen(page, await page.locator("#board .page-title").boundingBox(), 60, 40);
    expect(await lage(page, "#board")).not.toEqual(vorher);
  });

  test("die verschobene Lage wird gemerkt", async ({ page }) => {
    await ziehen(page, await page.locator("#page .page-title").boundingBox(), 80, 60);
    const nachZug = await lage(page, "#page");
    await page.reload();
    await waitAppReady(page);
    expect(await lage(page, "#page")).toEqual(nachZug);
  });
});
