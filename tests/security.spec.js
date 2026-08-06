// Absicherung der Sicherheits-Zusicherungen, die Relay internet-tauglich machen.
//
// Diese Tests pruefen ZUSICHERUNGEN, keine Optik: Wer eine Kopfzeile
// wegnimmt, eine Datei wieder eingebettet ausliefert oder die Bremse
// entschaerft, soll das hier sofort merken.
//
// Der Wegwerf-Container laeuft mit TRUST_PROXY=1 (global-setup.js) — also wie
// hinter einem nginx. Nur dadurch koennen die Tests eine Absender-Adresse
// mitschicken und die Bremse gezielt ansprechen, ohne sich gegenseitig ins
// Gehege zu kommen.
const crypto = require("crypto");
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, createUser, uniqueName, uploadFile, waitAppReady } = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

// Dasselbe Geheimnis, das global-setup.js dem Container gibt — damit lassen
// sich hier gueltige /files-Links bauen, ohne den Editor zu bemuehen.
const FILE_SECRET = "e2e-dummy-secret-e2e-dummy-secret";
function fileLink(uid, fid) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = crypto.createHmac("sha256", FILE_SECRET)
    .update(`${uid}:${fid}:${exp}`).digest("base64url");
  return `${BASE_URL}/files/${encodeURIComponent(uid)}/${fid}?expires=${exp}&token=${tok}`;
}

test.describe("Sicherheits-Zusicherungen", () => {
  test("die Antwort traegt die Schutz-Kopfzeilen und verraet nicht die Technik",
    async ({ page }) => {
      const res = await page.request.get(`${BASE_URL}/login`);
      const h = res.headers();
      expect(h["content-security-policy"]).toContain("default-src 'self'");
      expect(h["content-security-policy"]).toContain("object-src 'none'");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("no-referrer");
      expect(h["x-powered-by"]).toBeUndefined();
    });

  test("Inline-Skripte laufen nur mit Einmal-Kennung, und die wechselt",
    async ({ page }) => {
      const lies = async () => {
        const res = await page.request.get(`${BASE_URL}/login`);
        const body = await res.text();
        const imSkript = (body.match(/<script nonce="([^"]+)"/) || [])[1];
        const inCsp = (res.headers()["content-security-policy"].match(/'nonce-([^']+)'/) || [])[1];
        return { imSkript, inCsp };
      };
      const a = await lies();
      expect(a.imSkript, "Inline-Skript ohne nonce -> von der Richtlinie geblockt").toBeTruthy();
      expect(a.imSkript).toBe(a.inCsp);
      const b = await lies();
      expect(b.imSkript, "Kennung muss je Antwort neu sein").not.toBe(a.imSkript);
    });

  test("Fehler geben keine Stapelspur nach draussen", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post(`${BASE_URL}/notes/desktop`, {
      headers: { "Content-Type": "application/json" },
      data: "{kaputt",
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
    const body = await res.text();
    expect(body).not.toContain("node_modules");
    expect(body).not.toContain("at JSON.parse");
  });

  test("signierte Datei-Links liefern immer einen Anhang, nie eine Seite",
    async ({ page }) => {
      // Der Angriff waere: HTML hochladen, den signierten Link weitergeben,
      // fremdes Skript laeuft unter UNSERER Herkunft mit der Sitzung des Opfers.
      await loginAsAdmin(page);
      const name = uniqueName("seite") + ".html";
      await uploadFile(page, name, "<script>window.uebernommen=1</script>");

      // Der Link braucht keine Anmeldung — genau deshalb muss die Antwort sitzen.
      const res = await page.request.get(fileLink("admin", name), {
        headers: { Cookie: "" },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-disposition"]).toContain("attachment");
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    });

  test("der Editor oeffnet nur Formate, die OnlyOffice kennt", async ({ page }) => {
    await loginAsAdmin(page);
    const name = uniqueName("seite") + ".html";
    await uploadFile(page, name, "<h1>kein Dokument</h1>");
    // 404 statt 403: verraet nicht einmal, dass die Datei da ist
    const res = await page.request.get(`${BASE_URL}/edit/admin/${name}`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });

  test("das Anmelde-Ziel bleibt innerhalb von Relay", async ({ page }) => {
    // "/\fremde.example" rutschte frueher durch: Browser machen daraus
    // "//fremde.example" und verlassen damit unsere Herkunft.
    for (const ziel of ["/\\fremde.example", "//fremde.example", "https://fremde.example"]) {
      const res = await page.request.post(`${BASE_URL}/login`, {
        form: { username: "admin", password: "admin", next: ziel },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(302);
      const nach = res.headers()["location"];
      expect(nach, `next=${ziel}`).toBe("/");
    }
    // ein internes Ziel bleibt dagegen erhalten
    const ok = await page.request.post(`${BASE_URL}/login`, {
      form: { username: "admin", password: "admin", next: "/?p=Notizen" },
      maxRedirects: 0,
    });
    expect(ok.headers()["location"]).toBe("/?p=Notizen");
  });

  test("das Sitzungs-Cookie ist abgeschottet — und hinter TLS zusaetzlich Secure",
    async ({ page }) => {
      const einfach = await page.request.post(`${BASE_URL}/login`, {
        form: { username: "admin", password: "admin" }, maxRedirects: 0,
      });
      const keks = einfach.headers()["set-cookie"];
      expect(keks).toContain("HttpOnly");
      expect(keks).toContain("SameSite=Lax");

      // Wie hinter nginx mit TLS: dann MUSS die Secure-Marke dran sein
      const hinterTls = await page.request.post(`${BASE_URL}/login`, {
        form: { username: "admin", password: "admin" },
        headers: { "X-Forwarded-Proto": "https" },
        maxRedirects: 0,
      });
      expect(hinterTls.headers()["set-cookie"]).toContain("Secure");
    });

  test("nach zehn Fehlversuchen ist der Zugang vorerst gesperrt", async ({ page }) => {
    // eigener Name, damit die Sperre keinen anderen Test trifft; die
    // Absender-Adressen wechseln, um zu zeigen: die KONTO-Sperre greift auch
    // gegen ein Botnetz.
    const opfer = uniqueName("opfer");
    const versuch = (i) => page.request.post(`${BASE_URL}/login`, {
      form: { username: opfer, password: "geraten" + i },
      headers: { "X-Forwarded-For": `198.51.100.${(i % 250) + 1}` },
      maxRedirects: 0,
    });

    for (let i = 1; i <= 10; i++) {
      const r = await versuch(i);
      expect(r.status(), `Versuch ${i}`).toBe(200); // "Name oder Passwort falsch"
    }
    const elfter = await versuch(11);
    expect(elfter.status()).toBe(429);
    expect(await elfter.text()).toContain("Zu viele Fehlversuche");
  });
});

test.describe("Erstinstallation", () => {
  // Eigener Container, weil der Bootstrap nur bei LEERER Datenbank laeuft und
  // der Suite-Container bewusst ein festes Admin-Passwort bekommt.
  const { execFileSync } = require("child_process");
  const { EXTERNAL, IMAGE } = require("./test-env");
  const NAME = "relay-e2e-erstinstallation";
  const PORT = 5999;
  const URL = `http://localhost:${PORT}`;
  let einmalPasswort = null;

  test.skip(EXTERNAL, "braucht einen eigenen Container");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* war nicht da */ }
    execFileSync("docker", [
      "run", "-d", "--name", NAME, "-p", `${PORT}:5000`,
      "-e", "SERVER_HOST=localhost",
      "-e", "JWT_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "FILE_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "SESSION_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", `HOST_INTERNAL=${URL}`,
      "-e", "DS_INTERNAL=http://documentserver",
      // KEIN ADMIN_PASSWORD -> genau der Weg einer echten Erstinstallation
      IMAGE,
    ], { stdio: "pipe" });

    const frist = Date.now() + 60000;
    while (Date.now() < frist) {
      try {
        const r = await fetch(`${URL}/login`);
        if (r.ok) break;
      } catch (e) { /* noch nicht da */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    const log = execFileSync("docker", ["logs", NAME], { encoding: "utf8", stdio: "pipe" });
    einmalPasswort = (log.match(/Einmal-Passwort: (\S+)/) || [])[1] || null;
  });

  test.afterAll(() => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* egal */ }
  });

  test("es gibt kein Standard-Passwort mehr", async ({ page }) => {
    expect(einmalPasswort, "Einmal-Passwort muss im Container-Log stehen").toBeTruthy();
    expect(einmalPasswort.length).toBeGreaterThanOrEqual(20);
    const res = await page.request.post(`${URL}/login`, {
      form: { username: "admin", password: "admin" }, maxRedirects: 0,
    });
    expect(res.status()).toBe(200); // kein Redirect = nicht angemeldet
    expect(await res.text()).toContain("Name oder Passwort falsch");
  });

  test("das Einmal-Passwort fuehrt nur bis zur Passwort-Seite", async ({ page }) => {
    await page.goto(`${URL}/login`);
    await page.fill("input[name=username]", "admin");
    await page.fill("input[name=password]", einmalPasswort);
    await Promise.all([page.waitForNavigation(), page.click("form button")]);
    await expect(page).toHaveURL(new RegExp("/passwort-setzen$"));

    // auch jeder andere Weg fuehrt dorthin zurueck
    await page.goto(`${URL}/`);
    await expect(page).toHaveURL(new RegExp("/passwort-setzen$"));

    // zu kurz wird abgelehnt
    await page.fill("input[name=new1]", "kurz");
    await page.fill("input[name=new2]", "kurz");
    await page.click("form button");
    await expect(page.locator("form")).toBeVisible();

    // und mit einem richtigen Passwort geht es weiter
    const neu = "ein-langes-eigenes-passwort";
    await page.fill("input[name=new1]", neu);
    await page.fill("input[name=new2]", neu);
    await Promise.all([page.waitForNavigation(), page.click("form button")]);
    await waitAppReady(page);
    await expect(page.locator("table.files")).toBeVisible();
  });
});

test.describe("Admin-Zugaenge nur aus dem Heimnetz", () => {
  // Der Container laeuft mit ADMIN_LAN_ONLY=1 und TRUST_PROXY=1; die Zone
  // kommt aus X-Relay-Zone (global "lan", siehe playwright.config.js).
  // "wan" heisst hier: dieselbe Anfrage, aber ueber den oeffentlichen Eingang.
  const VON_AUSSEN = { "X-Relay-Zone": "wan" };

  test("mit richtigem Passwort, aber von aussen: kein Zutritt", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/login`, {
      form: { username: "admin", password: "admin" },
      headers: VON_AUSSEN,
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    expect(await res.text()).toContain("nur aus dem Heimnetz");
    // Ein Cookie kommt zwar (jede Anfrage bekommt eine leere Sitzung), aber
    // es ist keine ANGEMELDETE Sitzung — das ist der Punkt. Also nachfassen:
    const danach = await page.request.get(`${BASE_URL}/`, { maxRedirects: 0 });
    expect(danach.status()).toBe(302);
    expect(danach.headers()["location"]).toContain("/login");
  });

  test("normale Nutzer sind davon unberuehrt", async ({ page }) => {
    await loginAsAdmin(page);
    const u = await createUser(page);
    const res = await page.request.post(`${BASE_URL}/login`, {
      form: { username: u.username, password: u.password },
      headers: VON_AUSSEN,
      maxRedirects: 0,
    });
    expect(res.status(), "ein normaler Zugang kommt von ueberall herein").toBe(302);
    expect(res.headers()["location"]).toBe("/");
  });

  test("eine Admin-Sitzung endet, wenn sie das Heimnetz verlaesst", async ({ page }) => {
    await loginAsAdmin(page);
    // dieselbe Sitzung, aber ueber den oeffentlichen Eingang
    const draussen = await page.request.get(`${BASE_URL}/`, {
      headers: VON_AUSSEN, maxRedirects: 0,
    });
    expect(draussen.status()).toBe(302);
    expect(draussen.headers()["location"]).toContain("/login?zone=1");

    // die Sitzung ist damit weg — auch von zuhause aus
    const zuhause = await page.request.get(`${BASE_URL}/`, { maxRedirects: 0 });
    expect(zuhause.status(), "Sitzung muss beendet sein, nicht nur blockiert").toBe(302);

    // und die Login-Seite erklaert, warum
    await page.goto("/login?zone=1");
    await expect(page.locator(".err")).toContainText("nur aus dem Heimnetz");
  });

  test("das API-Token eines Admins greift von aussen nicht", async ({ page }) => {
    await loginAsAdmin(page);
    const token = (await page.locator("#tok").textContent()).trim();
    expect(token.length).toBeGreaterThan(20);

    const drinnen = await page.request.get(`${BASE_URL}/api/files?token=${token}`);
    expect(drinnen.status()).toBe(200);

    const draussen = await page.request.get(`${BASE_URL}/api/files?token=${token}`,
      { headers: VON_AUSSEN });
    expect(draussen.status()).toBe(401);
  });

  test("die Verwaltungsrouten antworten von aussen mit 404", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post(`${BASE_URL}/users/create`, {
      form: { username: uniqueName("x"), display: "X", password: "geheim123" },
      headers: VON_AUSSEN,
      maxRedirects: 0,
    });
    // 404 statt 403: dieselbe Sprache wie ueberall, verraet nichts
    expect(res.status()).toBe(404);
  });
});
