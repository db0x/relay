// Typ-Icons der Dateiliste.
//
// Bis dahin kannte Relay eine Handvoll Typen und zeigte fuer alles andere ein
// Fragezeichen — ein .zip sah aus wie ein .mp3. Seit mimeicons.js kommt das
// Icon aus dem mitgelieferten Symbolsatz: Endung -> MIME-Typ -> Dateiname.
//
// Zwei Dinge muessen dabei gleichzeitig stimmen, und genau die pruefen die
// Tests: die ZUORDNUNG (steht der richtige Name in der Adresse) und dass die
// Datei dahinter WIRKLICH existiert. Der Satz stammt aus einem Symbol-Thema
// und bringt Verweise ins Leere mit; ohne die Existenzpruefung beim Start
// lieferte die Liste Adressen, die mit 404 antworten.
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, uniqueName, waitAppReady, fileRow } = require("./helpers/relay");

// Icon-Adresse einer Zeile, gekuerzt auf den Teil hinter /img/
async function iconOf(page, filename) {
  const src = await fileRow(page, filename).locator("img.ficon").getAttribute("src");
  return src.split("/img/")[1];
}

test.describe("Datei-Icons", () => {
  test("Typen bekommen ihr eigenes Icon, Unbekanntes das Fragezeichen",
    async ({ page }) => {
      await loginAsAdmin(page);
      const stamm = uniqueName("ico");
      // Je Fall eine Datei: Archiv, Ton, Kalender — und eine Fantasie-Endung
      const dateien = {
        [`${stamm}.zip`]: /^mimetypes\//,
        [`${stamm}.mp3`]: /^mimetypes\/audio-/,
        [`${stamm}.ics`]: /^mimetypes\//,
        // Was wir nicht kennen, gibt sich auch nicht als etwas anderes aus
        [`${stamm}.xyzabc`]: /^unknown\.svg$/,
        // Die eigenen, ausgesuchten Icons behalten Vorrang vor dem Satz
        [`${stamm}.pdf`]: /^pdf\.svg$/,
        [`${stamm}.docx`]: /^docx\.svg$/,
      };
      await Promise.all([
        page.waitForNavigation(),
        page.locator(".upload-form input[type=file]").setInputFiles(
          Object.keys(dateien).map((name) => (
            { name, mimeType: "application/octet-stream", buffer: Buffer.from("x") }
          ))),
      ]);
      await waitAppReady(page);

      for (const [name, muster] of Object.entries(dateien)) {
        expect(await iconOf(page, name), `Icon fuer ${name}`).toMatch(muster);
      }

      // ... und alle Icons laden auch wirklich. Ein toter Verweis im
      // Symbolsatz waere sonst erst am kaputten Bild zu sehen.
      const kaputt = await page.$$eval("img.ficon", (imgs) => imgs
        .filter((i) => !i.complete || i.naturalWidth === 0)
        .map((i) => i.getAttribute("src")));
      expect(kaputt).toEqual([]);
    });

  test("/fileicon/:ext liefert dieselbe Zuordnung fuer den Browser", async ({ page }) => {
    // Verweise im Notiztext und der Upload-Dialog entstehen im Browser und
    // koennen die MIME-Zuordnung nicht kennen — sie fragen diese Route.
    // Frueher stand dort ein Zwilling der Tabelle, der auseinanderlief.
    await loginAsAdmin(page);
    await waitAppReady(page);
    const ziel = (ext) => page.evaluate(async (e) => {
      const r = await fetch(`/fileicon/${e}`, { credentials: "same-origin" });
      return { status: r.status, datei: r.url.split("/img/")[1] };
    }, ext);

    expect(await ziel("mp3")).toMatchObject(
      { status: 200, datei: expect.stringMatching(/^mimetypes\/audio-/) });
    expect(await ziel("pdf")).toMatchObject({ status: 200, datei: "pdf.svg" });
    expect(await ziel("xyzabc")).toMatchObject({ status: 200, datei: "unknown.svg" });
    // Der Wert landet in einem Pfad — Punkte und Schraegstriche muessen
    // herausfallen, sonst waere die Route ein Weg aus dem Ordner heraus.
    expect(await ziel("..%2F..%2Fetc")).toMatchObject({ status: 200, datei: "unknown.svg" });
  });
});
