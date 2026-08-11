// Eigene Bildlaufleisten (OverlayScrollbars, js/core/scrollbars.js).
//
// Warum das ueberhaupt getestet werden KANN: die nativen Leisten des Systems
// zeichnet ein Headless-Browser gar nicht — genau deshalb liess sich der
// urspruengliche Fehler ("Fenster laeuft ueber, aber keine Leiste") hier nie
// nachstellen. Diese Leisten sind echte Elemente und damit pruefbar.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, uniqueName, uploadFile, waitAppReady, openApp,
  createUser, login, logout, shareFile,
} = require("./helpers/relay");

const VBAR = "#page .os-scrollbar-vertical";
const HANDLE = `${VBAR} .os-scrollbar-handle`;

// Instanz-Zustand aus der Bibliothek holen (sie liegt global, wie marked)
function osState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const os = window.OverlayScrollbarsGlobal.OverlayScrollbars(el);
    if (!os) return null;
    return { zerstoert: os.state().destroyed, scrollTop: os.elements().viewport.scrollTop };
  }, selector);
}

// Zeiger ins Dateifenster stellen. Seit autoHide:"leave" (js/core/scrollbars.js)
// zeigt sich die Leiste nur, solange der Zeiger im Bereich ist. Bewusst ueber
// feste Koordinaten statt locator.hover(): das zielt auf die MITTE von #page,
// und die liegt je nach Listenlaenge unter einer Zeile, die sich beim Tausch
// gerade neu aufbaut — der Klick-Vorbehalt laesst hover() dann warten.
async function zeigerInsFenster(page) {
  // Erst die Dateiliste nach vorn holen: im schmalen Testfenster ueberlappt
  // das Notiz-Board sie, und ein verdecktes Ziel nimmt keine Zeigerereignisse
  // an (core/window.js stapelt beim pointerdown).
  await vorHolen(page);
  // Bewusst ein KLEINES Ziel IM Rumpf: #page selbst kann bei langer Liste
  // hoeher als das Sichtfenster sein, und hover() zielt auf die Mitte — die
  // liegt dann ausserhalb und die Aktion laeuft in den Zeitablauf. Ausserdem
  // haengt die Leiste seit dem stehenden Rahmen am Rumpf, nicht am Fenster:
  // ein Zeiger auf der Titelleiste holt sie nicht mehr hervor.
  await page.locator("table.files thead").hover();
  await page.waitForTimeout(120);
}

// Fenster nach vorn stapeln, ohne es zu verschieben (Ziehen beginnt erst bei
// Bewegung). Der Titel ist die einzige Flaeche im Kopf ohne Bedienelement.
async function vorHolen(page) {
  await page.locator("#page .page-title").click();
  await page.waitForTimeout(80);
}

test.describe("Bildlaufleisten", () => {
  // Bewusst NICHT als Admin: diese Tests verkleinern das Sichtfenster, und die
  // Fensterlagen werden je Nutzer gemerkt. Ein bei 1000x420 zurechtgerueckter
  // Schreibtisch liess spaeter (bei voller Groesse) das Notiz-Board ueber der
  // Dateiliste liegen — und ein verdecktes Fenster nimmt keine Klicks an.
  // Das traf dann Tests in ANDEREN Dateien, die als Admin arbeiten
  // (search.spec.js). Ein Wegwerf-Nutzer haelt den Schaden bei sich.
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);
    await login(page, u.username, u.password);
    await waitAppReady(page);
  });

  // Fenster klein machen und so viele Dateien anlegen, dass die Liste
  // sicher ueberlaeuft — ohne 25 Uploads zu brauchen.
  async function overflowingList(page, count = 6) {
    await page.setViewportSize({ width: 1000, height: 420 });
    for (let i = 0; i < count; i++) {
      await uploadFile(page, `${uniqueName("sb")}.docx`);
      await waitAppReady(page);
    }
    await page.waitForTimeout(300); // Leiste nach dem letzten Neuaufbau setzen
  }

  test("das Dateifenster bekommt eine sichtbare Leiste, wenn es ueberlaeuft",
    async ({ page }) => {
      await overflowingList(page);
      // Zeiger ins Fenster: seit autoHide:"leave" zeigt sich die Leiste erst
      // dann (dass sie sich danach wieder zurueckzieht, prueft der Test darunter)
      await zeigerInsFenster(page);
      await expect(page.locator(VBAR)).toBeVisible();
      // Der Griff ist kuerzer als die Bahn -> es gibt wirklich etwas zu scrollen
      const mass = await page.evaluate((h) => {
        const handle = document.querySelector(h);
        const track = handle.closest(".os-scrollbar").querySelector(".os-scrollbar-track");
        return {
          griff: handle.getBoundingClientRect().height,
          bahn: track.getBoundingClientRect().height,
          breite: handle.getBoundingClientRect().width,
        };
      }, HANDLE);
      expect(mass.griff).toBeGreaterThan(0);
      expect(mass.griff).toBeLessThan(mass.bahn);
      expect(mass.breite).toBeGreaterThan(3);
    });

  test("sie kommt beim Hineinfahren und geht beim Verlassen wieder",
    async ({ page }) => {
      // autoHide:"leave" (js/core/scrollbars.js). Der Kern des Ausgangsproblems
      // war NICHT das Ausblenden an sich, sondern dass die native Leiste auf
      // vielen Systemen 0px breit war — man sah sie auch beim Hineinfahren
      // nicht. Geprueft wird darum beides: weg ohne Zeiger, DA mit Zeiger.
      await overflowingList(page);
      await page.mouse.move(5, 5); // weit weg vom Fenster
      await page.waitForTimeout(1200); // Nachlauf (autoHideDelay) abwarten
      await expect(page.locator(VBAR)).toHaveClass(/os-scrollbar-auto-hide-hidden/);

      await zeigerInsFenster(page);
      await expect(page.locator(VBAR)).not.toHaveClass(/os-scrollbar-auto-hide-hidden/);
      await expect(page.locator(VBAR)).toBeVisible();
      // und sie ist dann auch wirklich greifbar breit
      expect(await page.locator(HANDLE).evaluate((h) => h.getBoundingClientRect().width))
        .toBeGreaterThan(3);
    });

  test("das Notiz-Board bekommt sie automatisch ueber createWindow",
    async ({ page }) => {
      // Kein eigener Aufruf im Board-Code: createWindow versorgt JEDES Fenster.
      if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
      await expect(page.locator("#board")).toBeVisible();
      await expect(page.locator("#board .os-scrollbar-vertical")).toHaveCount(1);
      expect((await osState(page, "#board .page-body")).zerstoert).toBe(false);
    });

  test("ein Listentausch laesst keine tote Instanz zurueck", async ({ page }) => {
    // Regression: folder-nav.js ersetzt #page.innerHTML. Ohne das Aufloesen
    // vorher blieb eine Instanz uebrig, die sich fuer lebendig hielt
    // (state().destroyed === false), aber nie wieder etwas zeichnete.
    await overflowingList(page);
    await zeigerInsFenster(page);
    await expect(page.locator(VBAR)).toBeVisible();

    // Sortierwechsel laeuft durch denselben swapFolder wie ein Ordnerwechsel.
    // Der Zeiger bleibt danach STEHEN (auf dem Sortierknopf, also im Fenster) —
    // und genau dann muss die neu aufgebaute Leiste trotzdem da sein. Ohne
    // Nachhilfe in core/scrollbars.js bliebe sie versteckt, bis man die Maus
    // bewegt: eine frische Instanz bekommt von einem stillstehenden Zeiger
    // kein pointerenter.
    await page.locator("table.files th .sort").first().click();
    await page.waitForTimeout(600);

    await expect(page.locator(VBAR)).toBeVisible();
    await expect(page.locator(VBAR)).toHaveCount(1); // keine zweite Leiste
    expect((await osState(page, "#page .page-body")).zerstoert).toBe(false);
  });

  test("der Griff scrollt, ohne das Fenster zu verschieben", async ({ page }) => {
    // .os-scrollbar steht in DRAG_SKIP (js/core/window.js) — ohne das wuerde
    // der Zug am Griff das ganze Fenster durch die Gegend schieben.
    await overflowingList(page);
    await vorHolen(page); // sonst faengt das ueberlappende Board den Zug ab
    const links = await page.evaluate(() => document.querySelector("#page").style.left);
    const h = await page.locator(HANDLE).boundingBox();

    await page.mouse.move(h.x + h.width / 2, h.y + 4);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(120);
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(h.x + h.width / 2, h.y + 4 + i * 12);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect((await osState(page, "#page .page-body")).scrollTop).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.querySelector("#page").style.left)).toBe(links);
  });

  test("auch Menues und Vorschauen haben sie", async ({ page }) => {
    for (const sel of [".notif-panel", ".note-preview"]) {
      expect((await osState(page, sel)), sel).not.toBeNull();
    }
  });

  test("der Notiz-Editor hat eine eigene, sichtbare Leiste", async ({ page }) => {
    // CodeMirror verwaltet sein Innenleben selbst — OverlayScrollbars kann dort
    // nicht hinein. Stattdessen sein eigenes Modell (Addon cm-scrollbars.js,
    // scrollbarStyle:"overlay"); die Optik gleicht index.css an.
    await openApp(page, ".note-new");
    await expect(page.locator("#dlg-note")).toBeVisible();
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+A");
    // Kurze Zeilen, aber genug davon: der Editorbereich ist nur rund 170px
    // hoch. Lange Zeilen zu tippen kostete nur Zeit (jeder Anschlag geht
    // einzeln durch CodeMirror) und brachte den Test an die 30s-Grenze.
    const zeilen = [];
    for (let i = 1; i <= 20; i++) zeilen.push(`Zeile ${i}`);
    await page.keyboard.type(zeilen.join("\n"));

    // das Addon-Modell ist aktiv (sonst waere es die unsichtbare native)
    await expect(page.locator(".CodeMirror")).toHaveClass(/CodeMirror-overlayscroll/);
    const bar = page.locator(".CodeMirror-overlayscroll-vertical");
    await expect(bar).toBeVisible();

    const mass = await bar.evaluate((el) => {
      const inner = el.firstElementChild;
      return {
        bahn: el.getBoundingClientRect().height,
        griff: inner.getBoundingClientRect().height,
        breite: inner.getBoundingClientRect().width,
      };
    });
    expect(mass.griff).toBeGreaterThan(0);
    expect(mass.griff).toBeLessThan(mass.bahn);
    // dieselbe Griffbreite wie bei den uebrigen Leisten
    expect(Math.round(mass.breite)).toBe(6);

    // und er scrollt: nach unten getippt -> Zug nach OBEN muss zurueckfuehren
    const inner = await page.locator(".CodeMirror-overlayscroll-vertical > div").boundingBox();
    const vorher = await page.evaluate(() => document.querySelector(".CodeMirror-scroll").scrollTop);
    expect(vorher).toBeGreaterThan(0);
    await page.mouse.move(inner.x + inner.width / 2, inner.y + inner.height / 2);
    await page.mouse.down();
    await page.mouse.move(inner.x + inner.width / 2, inner.y + inner.height / 2 - 100, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() =>
      page.evaluate(() => document.querySelector(".CodeMirror-scroll").scrollTop)).toBeLessThan(vorher);

    // … und sie zieht sich zurueck wie die uebrigen. Das Addon kennt kein
    // autoHide — es haengt hier an :hover der Editor-Spalte (index.css).
    // Geprueft wird die DECKKRAFT des Griffs: die Bahn bleibt im Layout stehen.
    const deckkraft = () => page.evaluate(() => getComputedStyle(
      document.querySelector(".CodeMirror-overlayscroll-vertical > div")).opacity);
    await page.mouse.move(5, 5);
    await expect.poll(deckkraft, { timeout: 3000 }).toBe("0");
    await page.locator(".CodeMirror").hover();
    await expect.poll(deckkraft).toBe("1");
  });

  test("die Notiz-Vorschau setzt ihre Bloecke UNTEREINANDER", async ({ page }) => {
    // Regression: OverlayScrollbars setzt seinen Behaelter auf
    // flex-direction:row. Schrieb note-dialog.js das gerenderte Markdown
    // direkt in diesen Behaelter, wurden Ueberschrift, Absatz und Liste zu
    // Flex-Kindern und standen NEBENEINANDER. Der Inhalt gehoert deshalb in
    // #note-preview-body, eine Ebene tiefer.
    await openApp(page, ".note-new");
    await expect(page.locator("#dlg-note")).toBeVisible();
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("# Ueberschrift\n\nEin Absatz.\n\n- Punkt eins\n- Punkt zwei");
    // Die Vorschau laeuft mit 200ms Verzoegerung nach -> auf den INHALT warten,
    // nicht nur auf ein <h1> (das gibt es schon in der leeren Vorlage)
    await expect(page.locator("#note-preview-body h1")).toHaveText("Ueberschrift");
    await expect(page.locator("#note-preview-body ul li")).toHaveCount(2);

    const lage = await page.evaluate(() => {
      const body = document.querySelector("#note-preview-body");
      const [h1, p, ul] = ["h1", "p", "ul"].map((s) => body.querySelector(s).getBoundingClientRect());
      return {
        absatzUnterUeberschrift: p.top >= h1.bottom - 1,
        listeUnterAbsatz: ul.top >= p.bottom - 1,
        // alle beginnen am gleichen linken Rand — Spalten taeten das nicht
        gleicheKante: Math.abs(h1.left - p.left) < 2 && Math.abs(p.left - ul.left) < 40,
      };
    });
    expect(lage.absatzUnterUeberschrift).toBe(true);
    expect(lage.listeUnterAbsatz).toBe(true);
    expect(lage.gleicheKante).toBe(true);
  });
});

test.describe("Fensterrahmen bleibt stehen", () => {
  // Titelleiste, Brotkrumen und Fusszeile eines Fensters sind Rahmen — beim
  // Rollen darf nur der Rumpf (.page-body) wandern. Vorher rollte die ganze
  // Karte, die Titelleiste verschwand also mit nach oben.
  const oben = (page, sel) => page.locator(sel).evaluate(
    (e) => Math.round(e.getBoundingClientRect().top));
  const unten = (page, sel) => page.locator(sel).evaluate(
    (e) => Math.round(e.getBoundingClientRect().bottom));

  async function rolle(page, px = 600) {
    await vorHolen(page); // das Board ueberlappt im schmalen Testfenster
    await page.locator("table.files thead").hover();
    await page.mouse.wheel(0, px);
    await page.waitForTimeout(350);
  }

  test("die Titelleiste der Dateiliste bleibt beim Rollen an ihrem Platz",
    async ({ page }) => {
      // Wegwerf-Nutzer aus demselben Grund wie oben: das kleine Sichtfenster
      // veraendert die gemerkten Fensterlagen, und die gehoeren dem Nutzer.
      await loginAsAdmin(page);
      const u = await createUser(page);
      await logout(page);
      await login(page, u.username, u.password);
      await page.setViewportSize({ width: 1000, height: 420 });
      for (let i = 0; i < 8; i++) {
        await uploadFile(page, `${uniqueName("rahmen")}.docx`);
        await waitAppReady(page);
      }
      await page.waitForTimeout(300);

      const kopfVor = await oben(page, "#page .page-head");
      const zeileVor = await oben(page, "table.files tbody tr:first-child");
      await rolle(page);

      // der Inhalt ist wirklich gewandert …
      expect(await oben(page, "table.files tbody tr:first-child")).toBeLessThan(zeileVor - 100);
      // … die Titelleiste nicht
      expect(await oben(page, "#page .page-head")).toBe(kopfVor);
      // und die Leiste haengt am Rumpf, nicht am Fenster
      await expect(page.locator("#page .page-body .os-scrollbar-vertical")).toHaveCount(1);
    });

  test("auch die Fusszeile bleibt stehen", async ({ page }) => {
    // Die Fusszeile ("Nur eigene Dateien") gibt es nur, wenn ueberhaupt etwas
    // freigegeben ist — also aus Sicht des Empfaengers, der selbst genug
    // eigene Dateien fuer einen Ueberlauf hat.
    //
    // Bewusst mit ZWEI frischen Nutzern statt mit dem Admin: dessen gemerkte
    // Fensterlagen sind im Laufe der Suite verschoben (offenes Board, andere
    // Sichtfenstergroessen) und koennen die Dateiliste verdecken. Ein neuer
    // Nutzer startet mit dem Standard-Schreibtisch.
    await loginAsAdmin(page);
    const besitzer = await createUser(page);
    const empfaenger = await createUser(page);
    await logout(page);

    await login(page, besitzer.username, besitzer.password);
    const geteilt = `${uniqueName("geteilt")}.docx`;
    await uploadFile(page, geteilt);
    await shareFile(page, geteilt, empfaenger.username, "view");
    await logout(page);

    await login(page, empfaenger.username, empfaenger.password);
    await page.setViewportSize({ width: 1000, height: 420 });
    for (let i = 0; i < 8; i++) {
      await uploadFile(page, `${uniqueName("eigen")}.docx`);
      await waitAppReady(page);
    }
    await page.waitForTimeout(300);
    await expect(page.locator("#page .list-footer")).toBeVisible();

    const fussVor = await unten(page, "#page .list-footer");
    const zeileVor = await oben(page, "table.files tbody tr:first-child");
    await rolle(page);
    expect(await oben(page, "table.files tbody tr:first-child")).toBeLessThan(zeileVor - 100);
    expect(await unten(page, "#page .list-footer")).toBe(fussVor);
  });

  test("das Notiz-Board ist genauso gebaut", async ({ page }) => {
    // Wegwerf-Nutzer, weil dieser Test das Board AUFKLAPPT und der Zustand
    // gemerkt wird: ein offenes Board liegt bei Standardlage ueber der
    // Dateiliste und faengt dort Klicks ab — das traf sonst spaetere Tests,
    // die als Admin arbeiten (search.spec.js).
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);
    await login(page, u.username, u.password);
    await waitAppReady(page);
    if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
    await expect(page.locator("#board .page-body")).toHaveCount(1);
    // Kopf und Fuss liegen AUSSERHALB des rollenden Rumpfs
    expect(await page.locator("#board .page-head").evaluate(
      (e) => !!e.closest(".page-body"))).toBe(false);
  });
});
