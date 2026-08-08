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
const {
  loginAsAdmin, login, createUser, uniqueName, uploadFile, waitAppReady,
  csrfToken, postForm, apiToken, logout, expectFlash,
} = require("./helpers/relay");
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


// Anmelden per direktem POST — mit Nachweis, den es seit dem CSRF-Schutz
// braucht (backend/csrf.js). Der Wert steht als verstecktes Feld auf der
// Anmeldeseite der jeweiligen Instanz; die Tests hier sprechen mehrere an.
async function anmelden(page, basis, felder, extra = {}) {
  const seite = await (await page.request.get(`${basis}/login`)).text();
  const nachweis = (seite.match(/name="_csrf" value="([^"]+)"/) || [])[1] || "";
  return page.request.post(`${basis}/login`, {
    form: { ...felder, _csrf: nachweis },
    maxRedirects: 0,
    ...extra,
  });
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
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrfToken(page) },
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
      const res = await anmelden(page, BASE_URL, { username: "admin", password: "admin", next: ziel });
      expect(res.status()).toBe(302);
      const nach = res.headers()["location"];
      expect(nach, `next=${ziel}`).toBe("/");
    }
    // ein internes Ziel bleibt dagegen erhalten
    const ok = await anmelden(page, BASE_URL, { username: "admin", password: "admin", next: "/?p=Notizen" });
    expect(ok.headers()["location"]).toBe("/?p=Notizen");
  });

  test("das Sitzungs-Cookie ist abgeschottet — und hinter TLS zusaetzlich Secure",
    async ({ page }) => {
      const einfach = await anmelden(page, BASE_URL, { username: "admin", password: "admin" });
      const keks = einfach.headers()["set-cookie"];
      expect(keks).toContain("HttpOnly");
      expect(keks).toContain("SameSite=Lax");

      // Wie hinter nginx mit TLS: dann MUSS die Secure-Marke dran sein
      const hinterTls = await anmelden(page, BASE_URL, { username: "admin", password: "admin" },
        { headers: { "X-Forwarded-Proto": "https" } });
      expect(hinterTls.headers()["set-cookie"]).toContain("Secure");
    });

  test("nach zehn Fehlversuchen ist der Zugang vorerst gesperrt", async ({ page }) => {
    // eigener Name, damit die Sperre keinen anderen Test trifft; die
    // Absender-Adressen wechseln, um zu zeigen: die KONTO-Sperre greift auch
    // gegen ein Botnetz.
    const opfer = uniqueName("opfer");
    const versuch = (i) => anmelden(page, BASE_URL, { username: opfer, password: "geraten" + i },
      { headers: { "X-Forwarded-For": `198.51.100.${(i % 250) + 1}` } });

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
    const res = await anmelden(page, URL, { username: "admin", password: "admin" });
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
    const res = await anmelden(page, BASE_URL, { username: "admin", password: "admin" },
      { headers: VON_AUSSEN });
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
    const res = await anmelden(page, BASE_URL, { username: u.username, password: u.password },
      { headers: VON_AUSSEN });
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

  test("das Token eines normalen Nutzers gilt auch von aussen", async ({ page }) => {
    // Die Zonenregel betrifft nur Admins — ein Sync-Client unterwegs (Voltage)
    // muss weiter arbeiten koennen.
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);
    await login(page, u.username, u.password);
    const token = await apiToken(page);

    expect((await page.request.get(`${BASE_URL}/api/files?token=${token}`)).status()).toBe(200);
    expect((await page.request.get(`${BASE_URL}/api/files?token=${token}`,
      { headers: VON_AUSSEN })).status()).toBe(200);
  });

  test("die Verwaltungsrouten laufen von aussen nicht — die Sitzung endet dabei",
    async ({ page }) => {
      await loginAsAdmin(page);
      const res = await page.request.post(`${BASE_URL}/users/create`, {
        form: { username: uniqueName("x"), display: "X", password: "geheim123",
                _csrf: await csrfToken(page) },
        headers: VON_AUSSEN,
        maxRedirects: 0,
      });
      // Seit adminRequired hinter loginRequired haengt, greift das schaerfere
      // von beiden Toren zuerst: die Sitzung wird beendet, nicht nur die eine
      // Anfrage abgewiesen. (Frueher kam hier das 404 aus adminRequired.)
      expect(res.status()).toBe(302);
      expect(res.headers()["location"]).toContain("/login?zone=1");

      // das ist die eigentliche Zusicherung: danach traegt die Sitzung nichts mehr
      const danach = await page.request.get(`${BASE_URL}/`, { maxRedirects: 0 });
      expect(danach.headers()["location"]).toContain("/login");
    });
});

test.describe("Hinter einem Reverse Proxy mit Unterpfad", () => {
  // Eigener Container mit BASE_PATH: die uebrige Suite laeuft an der Wurzel,
  // und genau dort faellt ein falsches Anmelde-Ziel NICHT auf. Auf dem Server
  // (BASE_PATH=/relay) landete man dadurch nach dem Login auf der Landingpage
  // des Nachbarn statt in Relay.
  const { execFileSync } = require("child_process");
  const { EXTERNAL, IMAGE } = require("./test-env");
  const NAME = "relay-e2e-unterpfad";
  const PORT = 5997;
  const URL = `http://localhost:${PORT}`;
  const BASIS = "/relay";

  test.skip(EXTERNAL, "braucht einen eigenen Container");

  test.beforeAll(async () => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* war nicht da */ }
    execFileSync("docker", [
      "run", "-d", "--name", NAME, "-p", `${PORT}:5000`,
      "-e", "SERVER_HOST=localhost",
      "-e", `BASE_PATH=${BASIS}`,
      "-e", "ADMIN_PASSWORD=admin",
      "-e", "JWT_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "FILE_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "SESSION_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", `HOST_INTERNAL=${URL}`,
      "-e", "DS_INTERNAL=http://documentserver",
      IMAGE,
    ], { stdio: "pipe" });
    const frist = Date.now() + 60000;
    while (Date.now() < frist) {
      try { if ((await fetch(`${URL}${BASIS}/login`)).ok) break; } catch (e) { /* noch nicht da */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test.afterAll(() => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* egal */ }
  });

  const anmeldenDort = (page, next) => anmelden(page, `${URL}${BASIS}`,
    next === undefined
      ? { username: "admin", password: "admin" }
      : { username: "admin", password: "admin", next });

  test("ohne Ziel landet man in Relay, nicht auf der Wurzel", async ({ page }) => {
    const res = await anmeldenDort(page);
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe(`${BASIS}/`);
  });

  test("ein Ziel innerhalb von Relay bleibt erhalten", async ({ page }) => {
    const res = await anmeldenDort(page, `${BASIS}/?p=Notizen`);
    expect(res.headers()["location"]).toBe(`${BASIS}/?p=Notizen`);
  });

  test("ein Nachbar am selben Server ist kein gueltiges Ziel", async ({ page }) => {
    // /gogs/ liegt auf demselben Rechner, gehoert aber nicht zu Relay
    for (const fremd of ["/gogs/", "/", "//fremde.example", "https://fremde.example"]) {
      const res = await anmeldenDort(page, fremd);
      expect(res.headers()["location"], `next=${fremd}`).toBe(`${BASIS}/`);
    }
  });

  test("der Weg zurueck nach dem Anmelden traegt den Unterpfad", async ({ page }) => {
    const res = await page.request.get(`${URL}${BASIS}/?p=Notizen`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain(`${BASIS}/login?next=`);
    expect(decodeURIComponent(res.headers()["location"])).toContain(`next=${BASIS}/`);
  });
});

test.describe("Zweite Stufe für Admins (TOTP)", () => {
  // Eigener Container mit ADMIN_2FA=1: die uebrige Suite meldet sich staendig
  // als Admin an und soll davon nichts merken.
  const { execFileSync } = require("child_process");
  const { EXTERNAL, IMAGE } = require("./test-env");
  const totp = require("../backend/totp");
  const NAME = "relay-e2e-zweifaktor";
  const PORT = 5996;
  const URL = `http://localhost:${PORT}`;
  const PW = { username: "admin", password: "start-passwort-lang" };

  let geheimnis = null;     // wird in der Einrichtung gefuellt
  let codes = [];           // Wiederherstellungscodes
  let letzterSchritt = 0;   // damit kein Code zweimal benutzt wird

  test.skip(EXTERNAL, "braucht einen eigenen Container");
  test.describe.configure({ mode: "serial" });
  // kann auf das naechste 30-Sekunden-Fenster warten muessen
  test.slow();

  // Ein unverbrauchter Code. Zwei Regeln muessen dabei zusammenpassen: der
  // Server nimmt denselben Zeitschritt kein zweites Mal (Wiederverwendungs-
  // sperre) und akzeptiert hoechstens ein Fenster Vorlauf (Toleranz). Wer
  // beides ignoriert und einfach weiterzaehlt, produziert irgendwann Codes
  // aus der zu fernen Zukunft — dann muss man auf die Uhr warten.
  const frischerCode = async () => {
    while (totp.schrittFuer() + 1 <= letzterSchritt) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    letzterSchritt = Math.max(letzterSchritt + 1, totp.schrittFuer());
    return totp.codeFuerSchritt(geheimnis, letzterSchritt);
  };

  // Nachweis von einer beliebigen Seite dieser Instanz holen
  const nachweisVon = async (page, adresse) => {
    const html = await (await page.request.get(adresse)).text();
    return (html.match(/name="_csrf" value="([^"]+)"/)
      || html.match(/name="csrf-token" content="([^"]+)"/) || [])[1] || "";
  };
  const zweiPost = async (page, felder) => page.request.post(`${URL}/zwei-faktor`, {
    form: { ...felder, _csrf: await nachweisVon(page, `${URL}/zwei-faktor`) },
    maxRedirects: 0,
  });

  test.beforeAll(async () => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* war nicht da */ }
    execFileSync("docker", [
      "run", "-d", "--name", NAME, "-p", `${PORT}:5000`,
      "-e", "SERVER_HOST=localhost", "-e", "TRUST_PROXY=1", "-e", "ADMIN_2FA=1",
      "-e", `ADMIN_PASSWORD=${PW.password}`,
      "-e", "JWT_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "FILE_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "SESSION_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", `HOST_INTERNAL=${URL}`, "-e", "DS_INTERNAL=http://documentserver",
      IMAGE,
    ], { stdio: "pipe" });
    const frist = Date.now() + 60000;
    while (Date.now() < frist) {
      try { if ((await fetch(`${URL}/login`)).ok) break; } catch (e) { /* noch nicht */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test.afterAll(() => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* egal */ }
  });

  test("ein Admin ohne zweite Stufe kommt nur bis zur Einrichtung", async ({ page }) => {
    const an = await anmelden(page, URL, PW);
    expect(an.headers()["location"]).toBe("/zwei-faktor/einrichten");
    // und auch jeder andere Weg fuehrt dorthin
    const start = await page.request.get(`${URL}/`, { maxRedirects: 0 });
    expect(start.headers()["location"]).toBe("/zwei-faktor/einrichten");
  });

  test("die Einrichtung verlangt einen gueltigen Probe-Code", async ({ page }) => {
    await anmelden(page, URL, PW);
    const seite = await (await page.request.get(`${URL}/zwei-faktor/einrichten`)).text();
    geheimnis = (seite.match(/<code class="geheim">([^<]+)<\/code>/) || [])[1].replace(/\s/g, "");
    const nachweis = (seite.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    expect(geheimnis, "Geheimnis muss auf der Seite stehen").toBeTruthy();
    expect(seite, "QR-Code steht als SVG im Markup, nicht als externes Bild").toContain("<svg");

    const falsch = await page.request.post(`${URL}/zwei-faktor/einrichten`, { form: { code: "000000", _csrf: nachweis } });
    expect(await falsch.text()).toContain("stimmt nicht");
    // ohne bestandene Probe bleibt die Stufe inaktiv
    expect((await page.request.get(`${URL}/`, { maxRedirects: 0 })).headers()["location"])
      .toBe("/zwei-faktor/einrichten");

    const gut = await page.request.post(`${URL}/zwei-faktor/einrichten`, { form: { code: await frischerCode(), _csrf: nachweis } });
    const html = await gut.text();
    codes = [...html.matchAll(/<code>([0-9A-F-]{14})<\/code>/g)].map((m) => m[1]);
    expect(codes, "zehn Wiederherstellungscodes, einmalig angezeigt").toHaveLength(10);
    expect((await page.request.get(`${URL}/`, { maxRedirects: 0 })).status()).toBe(200);
  });

  test("wer nur das Passwort kennt, kommt nirgendwo hin", async ({ page }) => {
    const an = await anmelden(page, URL, PW);
    expect(an.headers()["location"]).toBe("/zwei-faktor");
    // Der Nachweis kommt von der Codeseite — die halbe Sitzung darf sie ja
    // laden. So prueft der Test wirklich das ZWEITE Tor und bleibt nicht
    // schon am CSRF-Schutz haengen (der greift hier als eigene Schicht).
    const nachweis = await nachweisVon(page, `${URL}/zwei-faktor`);
    const ohneNachweis = await page.request.post(`${URL}/users/create`, { form: {}, maxRedirects: 0 });
    expect(ohneNachweis.status(), "erste Schicht: kein Nachweis").toBe(403);

    for (const [pfad, meth] of [["/", "get"], ["/users/create", "post"], ["/zwei-faktor/neu", "post"],
                                ["/zwei-faktor/einrichten", "get"]]) {
      const r = meth === "get"
        ? await page.request.get(URL + pfad, { maxRedirects: 0 })
        : await page.request.post(URL + pfad, { form: { _csrf: nachweis }, maxRedirects: 0 });
      expect(r.headers()["location"], `${meth} ${pfad}`).toBe("/zwei-faktor");
    }
    // auch das API-Token traegt die halbe Sitzung nicht
    expect((await page.request.get(`${URL}/api/files`)).status()).toBe(401);
  });

  test("derselbe Code gilt kein zweites Mal", async ({ page }) => {
    await anmelden(page, URL, PW);
    const code = await frischerCode();
    const erste = await zweiPost(page, { code });
    expect(erste.headers()["location"]).toBe("/");

    await anmelden(page, URL, PW);
    const zweite = await zweiPost(page, { code });
    expect(await zweite.text(), "abgefangener Code darf nicht erneut gelten").toContain("stimmt nicht");
  });

  test("ein Wiederherstellungscode ersetzt die Zahl — genau einmal", async ({ page }) => {
    await anmelden(page, URL, PW);
    const erste = await zweiPost(page, { code: codes[0] });
    expect(erste.headers()["location"]).toBe("/");

    await anmelden(page, URL, PW);
    const zweite = await zweiPost(page, { code: codes[0] });
    expect(await zweite.text()).toContain("stimmt nicht");
  });

  test("„diesem Gerät vertrauen“ spart den Code — bis man die Geräte vergisst",
    async ({ page }) => {
      await anmelden(page, URL, PW);
      const mit = await zweiPost(page, { code: await frischerCode(), vertrauen: "1" });
      expect(mit.headers()["set-cookie"]).toContain("relay_td");

      // neue Anmeldung im selben Kontext: das Merkmal liegt im Cookie
      const ohneCode = await anmelden(page, URL, PW);
      expect(ohneCode.headers()["location"], "vertrautes Gerät -> direkt hinein").toBe("/");

      await page.request.post(`${URL}/zwei-faktor/geraete`,
        { form: { _csrf: await nachweisVon(page, `${URL}/`) }, maxRedirects: 0 });
      const wieder = await anmelden(page, URL, PW);
      expect(wieder.headers()["location"], "nach 'Geräte vergessen' wieder ein Code").toBe("/zwei-faktor");
    });
});

test.describe("Etappe 3: Nachweis, Sitzungen, Protokoll", () => {
  test("eine ändernde Anfrage ohne Nachweis wird abgewiesen", async ({ page }) => {
    await loginAsAdmin(page);
    // genau der Angriff: eine fremde Seite loest ein POST mit UNSEREM Cookie
    // aus. Sie kann den Nachweis nicht lesen (Same-Origin-Policy).
    const ohne = await page.request.post(`${BASE_URL}/profile`, {
      form: { display: "Übernommen", email: "" },
      maxRedirects: 0,
    });
    expect(ohne.status()).toBe(403);

    const token = await csrfToken(page);
    const mit = await page.request.post(`${BASE_URL}/profile`, {
      form: { display: "Admin", email: "", _csrf: token },
      maxRedirects: 0,
    });
    expect(mit.status()).toBe(302);
  });

  test("der Nachweis geht auch als Kopfzeile — und die Datei-API braucht keinen",
    async ({ page }) => {
      await loginAsAdmin(page);
      const token = await csrfToken(page);
      const mitKopf = await page.request.post(`${BASE_URL}/notes/desktop`, {
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        data: "{}",
      });
      // 400 = der Nachweis stimmte, nur der Rumpf war unvollstaendig
      expect(mitKopf.status()).toBe(400);

      // Die API meldet sich per Token an, nicht per Cookie — dort gibt es
      // nichts zu faelschen, also ist sie ausgenommen (siehe csrf.js).
      // Ein NORMALER Nutzer: Verwaltungszugaenge haben kein Token.
      const u = await createUser(page);
      await logout(page);
      await login(page, u.username, u.password);
      const tok = await apiToken(page);
      const api = await page.request.put(`${BASE_URL}/api/files/csrf-probe.txt?token=${tok}`, {
        data: "inhalt",
      });
      expect([200, 201]).toContain(api.status());
    });

  test("das Protokoll hält Anmeldungen fest — auch gescheiterte", async ({ page }) => {
    const name = uniqueName("geist");
    await page.request.post(`${BASE_URL}/login`, {
      form: { username: name, password: "falsch", _csrf: await csrfToken(page) },
      maxRedirects: 0,
    });
    await loginAsAdmin(page);
    const seite = await (await page.request.get(`${BASE_URL}/`)).text();
    expect(seite, "gescheiterter Versuch steht im Protokoll").toContain("login.fail");
    expect(seite).toContain(name);
    expect(seite, "erfolgreiche Anmeldung ebenso").toContain("login.ok");
    // und niemals Geheimnisse
    expect(seite).not.toContain("falsch");
  });

  test("Sperren beendet die laufende Sitzung sofort", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const u = await createUser(page);

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const opfer = await ctx.newPage();
    await login(opfer, u.username, u.password);
    await waitAppReady(opfer);
    expect((await opfer.request.get(`${BASE_URL}/`, { maxRedirects: 0 })).status()).toBe(200);

    await postForm(page, `${BASE_URL}/users/lock`, { target: u.username, value: "1" });

    const danach = await opfer.request.get(`${BASE_URL}/`, { maxRedirects: 0 });
    expect(danach.status(), "die Sitzung ist weg, nicht nur blockiert").toBe(302);
    await ctx.close();
  });
});

test.describe("Sitzungen überleben einen Neustart", () => {
  // Eigener Container: die uebrige Suite darf nicht mittendrin neu starten.
  const { execFileSync } = require("child_process");
  const { EXTERNAL, IMAGE } = require("./test-env");
  const NAME = "relay-e2e-neustart";
  const PORT = 5995;
  const URL = `http://localhost:${PORT}`;

  test.skip(EXTERNAL, "braucht einen eigenen Container");

  const warten = async () => {
    const frist = Date.now() + 60000;
    while (Date.now() < frist) {
      try { if ((await fetch(`${URL}/login`)).ok) return; } catch (e) { /* noch nicht */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  test.beforeAll(async () => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* war nicht da */ }
    execFileSync("docker", [
      "run", "-d", "--name", NAME, "-p", `${PORT}:5000`,
      "-e", "SERVER_HOST=localhost", "-e", "ADMIN_PASSWORD=admin",
      "-e", "JWT_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "FILE_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", "SESSION_SECRET=e2e-dummy-secret-e2e-dummy-secret",
      "-e", `HOST_INTERNAL=${URL}`, "-e", "DS_INTERNAL=http://documentserver",
      IMAGE,
    ], { stdio: "pipe" });
    await warten();
  });

  test.afterAll(() => {
    try { execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" }); } catch (e) { /* egal */ }
  });

  test("angemeldet bleiben, auch wenn der Container neu startet", async ({ page }) => {
    const login1 = await (await page.request.get(`${URL}/login`)).text();
    const token = (login1.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const an = await page.request.post(`${URL}/login`, {
      form: { username: "admin", password: "admin", _csrf: token }, maxRedirects: 0,
    });
    expect(an.headers()["location"]).toBe("/");
    expect((await page.request.get(`${URL}/`, { maxRedirects: 0 })).status()).toBe(200);

    execFileSync("docker", ["restart", NAME], { stdio: "pipe" });
    await warten();

    // Frueher lagen Sitzungen im Arbeitsspeicher — hier waere man abgemeldet.
    const danach = await page.request.get(`${URL}/`, { maxRedirects: 0 });
    expect(danach.status(), "Sitzung liegt in SQLite und überlebt").toBe(200);
  });
});

test.describe("API-Token liegt nur als Prüfsumme in der Datenbank", () => {
  const { execFileSync } = require("child_process");
  const { EXTERNAL, IMAGE, CONTAINER } = require("./test-env");

  test("das Token ist in der Datenbank nicht auffindbar", async ({ page }) => {
    test.skip(EXTERNAL, "liest die Datenbank im Container");
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);
    await login(page, u.username, u.password);
    const token = await apiToken(page);
    expect(token.length).toBeGreaterThan(20);
    // es funktioniert …
    expect((await page.request.get(`${BASE_URL}/api/files?token=${token}`)).status()).toBe(200);

    // … steht aber nirgends in der Datei. Genau das ist der Punkt: users.db
    // wird vom Backup aufs NAS gespiegelt.
    const roh = execFileSync("docker",
      ["exec", CONTAINER, "sh", "-c", "cat /data/state/users.db | tr -c '[:print:]' '\\n'"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(roh, "das Token darf im Klartext nirgends stehen").not.toContain(token);
    // die Pruefsumme dagegen schon
    const summe = crypto.createHash("sha256").update(token).digest("hex");
    expect(roh).toContain(summe);
  });

  test("ein Token gilt weiter, wenn es neu erzeugt wird — das alte nicht mehr",
    async ({ page }) => {
      await loginAsAdmin(page);
      const u = await createUser(page);
      await logout(page);
      await login(page, u.username, u.password);
      const alt = await apiToken(page);
      const neu = await apiToken(page);
      expect(neu).not.toBe(alt);
      expect((await page.request.get(`${BASE_URL}/api/files?token=${neu}`)).status()).toBe(200);
      expect((await page.request.get(`${BASE_URL}/api/files?token=${alt}`)).status()).toBe(401);
    });
});


test.describe("Verwaltungszugänge haben kein API-Token", () => {
  test("der Abschnitt fehlt im Konto — und die Route lehnt es auch selbst ab",
    async ({ page }) => {
      await loginAsAdmin(page);
      await waitAppReady(page);
      // gezielt der Abschnitt im Konto-Dialog — der Text "API-Token" kommt
      // auch im Sperren-Hinweis der Nutzerverwaltung vor
      await expect(page.locator("#dlg-account summary").filter({ hasText: "API-Token" }))
        .toHaveCount(0);
      await expect(page.locator("#dlg-account #tok")).toHaveCount(0);

      // nicht nur ausgeblendet: der Server sagt ebenfalls nein
      await postForm(page, `${BASE_URL}/token/reset`, {});
      await page.goto("/");
      await expectFlash(page, "Verwaltungszugänge haben kein API-Token");
    });

  test("wer zum Admin wird, verliert sein bestehendes Token", async ({ page }) => {
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);

    await login(page, u.username, u.password);
    const token = await apiToken(page);
    expect((await page.request.get(`${BASE_URL}/api/files?token=${token}`)).status()).toBe(200);
    await logout(page);

    // Der Admin macht ihn zum Admin …
    await loginAsAdmin(page);
    await postForm(page, `${BASE_URL}/users/admin`, { target: u.username, value: "1" });

    // … und das Token ist damit erledigt, ohne dass jemand es widerrufen musste
    expect((await page.request.get(`${BASE_URL}/api/files?token=${token}`)).status()).toBe(401);
  });
});
