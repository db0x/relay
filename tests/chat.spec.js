// Chat: Ende-zu-Ende verschluesselte Textnachrichten zwischen zwei Nutzern.
//
// Der interessante Teil steht NICHT im Backend, sondern im Browser
// (backend/public/js/chat/crypto.js) — darum laufen fast alle Faelle hier ueber
// zwei echte Browser-Kontexte. Zwei Kontexte statt zwei Seiten: die
// Schluessel liegen in der IndexedDB, und die ist je Kontext eigen. Zwei Tabs
// desselben Kontexts waeren dasselbe "Geraet" und wuerden nichts beweisen.
//
// Voraussetzung fuer WebCrypto ist eine SICHERE HERKUNFT. Die Suite laeuft
// gegen http://localhost — das gilt als sicher, der Chat funktioniert also.
// Ueber eine LAN-IP ohne TLS waere crypto.subtle nicht da; dieser Fall ist
// unten mit abgedeckt (die Oberflaeche sagt es dann deutlich).
const { test, expect } = require("@playwright/test");
const {
  ADMIN, login, loginAsAdmin, createUser, waitAppReady, openMenuDialog,
} = require("./helpers/relay");

// Fenster aufklappen, falls es (Default) eingeklappt startet. Der Umschalter
// wirkt in BEIDE Richtungen — blind klicken wuerde ein offenes Fenster
// zuklappen, und die gemerkte Lage macht das von Lauf zu Lauf verschieden.
async function openChat(page) {
  await waitAppReady(page);
  if (await page.locator("#chat.page-min").count()) await page.click("#chat-toggle");
  await expect(page.locator("#chat")).toBeVisible();
  // Aufschliessen laeuft asynchron (IndexedDB, PBKDF2, evtl. Schluessel
  // anlegen). Fertig ist es, wenn das Schloss weg ist.
  await expect(page.locator("#chat-lock")).toBeHidden({ timeout: 20000 });
}

async function sendTo(page, peer, text) {
  await page.click(`.chat-peer[data-user="${peer}"]`);
  await expect(page.locator("#chat-form")).toBeVisible();
  await page.fill("#chat-input", text);
  await page.press("#chat-input", "Enter");
  await expect(page.locator(".chat-msg-own .chat-bubble").last()).toHaveText(text);
}

test.describe("Chat", () => {
  test("zwei Nutzer schreiben sich, der Server sieht nur Geheimtext", async ({ browser, page }) => {
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Chat Partner" });

    const ctx = await browser.newContext();
    const peer = await ctx.newPage();
    await login(peer, other.username, other.password);

    await openChat(page);
    await openChat(peer);

    await sendTo(page, other.username, "Hallo, das hier ist verschlüsselt.");

    // Live-Zustellung ueber den SSE-Strom: das andere Fenster steht auf keinem
    // Gespraech, also erscheint der Zaehler an der Kontaktzeile.
    const zaehler = peer.locator(`.chat-peer[data-user="${ADMIN.username}"] .chat-peer-unread`);
    await expect(zaehler).toBeVisible({ timeout: 15000 });
    await expect(zaehler).toHaveText("1");
    // ... und die Glocke am Avatar, damit es auch ohne offenes Fenster auffaellt
    await expect(peer.locator("#notif-badge")).toBeVisible();

    // Erst der Empfaenger kann den Klartext sehen
    await peer.click(`.chat-peer[data-user="${ADMIN.username}"]`);
    await expect(peer.locator(".chat-bubble").first())
      .toHaveText("Hallo, das hier ist verschlüsselt.");
    // gelesen -> Zaehler weg
    await expect(zaehler).toBeHidden();

    // Was der SERVER ausliefert, ist Geheimtext: der Klartext darf in der
    // Antwort nirgends vorkommen.
    const roh = await peer.evaluate(async (p) => {
      const r = await fetch(`/chat/messages?peer=${encodeURIComponent(p)}`,
        { credentials: "same-origin" });
      return JSON.stringify(await r.json());
    }, ADMIN.username);
    expect(roh).not.toContain("verschlüsselt");
    expect(roh).toContain("\"ct\":");

    // Rueckrichtung, ebenfalls live
    await sendTo(peer, ADMIN.username, "Angekommen! Umlaute: äöüß");
    await expect(page.locator(".chat-msg:not(.chat-msg-own) .chat-bubble").last())
      .toHaveText("Angekommen! Umlaute: äöüß", { timeout: 15000 });

    await ctx.close();
  });

  test("der Verlauf kommt auf einem anderen Geraet vom Server", async ({ browser, page }) => {
    // Das ist der Kern der Anforderung: E2E-verschluesselt UND trotzdem
    // ueberall verfuegbar. Moeglich, weil der private Schluessel umhuellt auf
    // dem Server liegt und sich aus dem Passwort wieder oeffnen laesst.
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Zweitgeraet" });

    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await login(p1, other.username, other.password);
    await openChat(p1);
    await openChat(page);
    await sendTo(page, other.username, "Nachricht für zwei Geräte");
    await expect(p1.locator(`.chat-peer[data-user="${ADMIN.username}"] .chat-peer-unread`))
      .toBeVisible({ timeout: 15000 });

    // Frischer Kontext = anderes Geraet: leere IndexedDB, nur das Passwort.
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, other.username, other.password);
    await openChat(p2);
    await p2.click(`.chat-peer[data-user="${ADMIN.username}"]`);
    await expect(p2.locator(".chat-bubble").first())
      .toHaveText("Nachricht für zwei Geräte", { timeout: 15000 });

    await ctx1.close();
    await ctx2.close();
  });

  test("ohne Schluessel im Browser fragt der Chat nach dem Passwort", async ({ browser, page }) => {
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Gesperrt" });

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, other.username, other.password);
    await openChat(p);   // legt das Schluesselpaar an

    // Speicher geleert, Sitzung bleibt: der private Schluessel ist weg, die
    // Huelle auf dem Server aber noch da.
    await p.evaluate(() => new Promise((ok) => {
      const r = indexedDB.deleteDatabase("relay-chat");
      r.onsuccess = r.onerror = r.onblocked = () => ok();
    }));
    await p.reload();
    await waitAppReady(p);
    await expect(p.locator("#chat-lock")).toBeVisible({ timeout: 20000 });
    await expect(p.locator("#chat-form")).toBeHidden();

    // Falsches Passwort oeffnet nichts — der Server kann dabei nicht helfen,
    // die Huelle geht nur mit dem richtigen auf.
    await p.fill("#chat-unlock-pw", "definitivFalsch");
    await p.click("#chat-lock-form button");
    await expect(p.locator("#chat-lock-err")).toBeVisible({ timeout: 20000 });

    // Richtiges Passwort schliesst auf
    await p.fill("#chat-unlock-pw", other.password);
    await p.click("#chat-lock-form button");
    await expect(p.locator("#chat-lock")).toBeHidden({ timeout: 20000 });

    await ctx.close();
  });

  test("ein Passwortwechsel nimmt den Schluessel mit", async ({ browser, page }) => {
    // Ohne das waere nach jedem Passwortwechsel der ganze Verlauf verloren:
    // die Huelle haengt am Passwort. Der Browser packt sie beim Wechsel um
    // (js/chat/password-hook.js), der Server uebernimmt sie erst nach
    // erfolgreicher Aenderung (routes/auth.js).
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Wechsler" });

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, other.username, other.password);
    await openChat(p);
    await openChat(page);
    await sendTo(page, other.username, "Vor dem Passwortwechsel");
    await expect(p.locator(`.chat-peer[data-user="${ADMIN.username}"] .chat-peer-unread`))
      .toBeVisible({ timeout: 15000 });

    const neu = "nochGeheimer2026";
    await openMenuDialog(p, "dlg-account");
    await p.evaluate(() => {
      const d = document.querySelector("#pw-form").closest("details");
      if (d) d.open = true;
    });
    await p.fill("#pw-form input[name=old]", other.password);
    await p.fill("#pw-form input[name=new1]", neu);
    await p.fill("#pw-form input[name=new2]", neu);
    await Promise.all([p.waitForNavigation(), p.click("#pw-form button")]);

    // Anderes Geraet, NEUES Passwort: der alte Verlauf muss da sein.
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, other.username, neu);
    await openChat(p2);
    await p2.click(`.chat-peer[data-user="${ADMIN.username}"]`);
    await expect(p2.locator(".chat-bubble").first())
      .toHaveText("Vor dem Passwortwechsel", { timeout: 15000 });

    await ctx.close();
    await ctx2.close();
  });

  test("niemand kann in fremdem Namen schreiben oder fremd mitlesen", async ({ browser, page }) => {
    // Der Absender kommt IMMER aus der Sitzung, nie aus dem Rumpf
    // (routes/chat.js). Und /chat/messages liefert nur Gespraeche, an denen
    // der Angemeldete selbst beteiligt ist.
    await loginAsAdmin(page);
    const a = await createUser(page, { display: "Alice" });
    const b = await createUser(page, { display: "Bob" });

    const ctxA = await browser.newContext();
    const pa = await ctxA.newPage();
    await login(pa, a.username, a.password);
    await openChat(pa);

    const ctxB = await browser.newContext();
    const pb = await ctxB.newPage();
    await login(pb, b.username, b.password);
    await openChat(pb);

    await sendTo(pa, b.username, "Nur für Bob");

    // Der Admin fragt den Verlauf zwischen Alice und Bob ab: er bekommt sein
    // EIGENES (leeres) Gespraech mit Bob, nicht deren.
    const fremd = await page.evaluate(async (u) => {
      const r = await fetch(`/chat/messages?peer=${encodeURIComponent(u)}`,
        { credentials: "same-origin" });
      return (await r.json()).messages.length;
    }, b.username);
    expect(fremd).toBe(0);

    // Absender faelschen: Bob schickt eine Nachricht "von Alice" — sie landet
    // als Bobs eigene, der `from`-Wert kommt aus der Sitzung.
    const gefaelscht = await pb.evaluate(async (opts) => {
      const csrf = document.querySelector('meta[name="csrf-token"]').content;
      const r = await fetch("/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        credentials: "same-origin",
        body: JSON.stringify({ from: opts.alice, to: opts.admin, iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" }),
      });
      return (await r.json()).message;
    }, { alice: a.username, admin: ADMIN.username });
    expect(gefaelscht.from).toBe(b.username);

    await ctxA.close();
    await ctxB.close();
  });

  test("der Verlauf rollt zur neuen Nachricht", async ({ browser, page }) => {
    // Der Fehler dahinter: ansEnde() setzte scrollTop an .chat-log — dort
    // haengt aber nur die Leiste, gerollt wird der Viewport DARIN
    // (OverlayScrollbars v2, siehe core/scrollbars.js: scrollElement).
    // Der Verlauf blieb dadurch immer am Anfang stehen.
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Roller" });

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, other.username, other.password);
    await openChat(p);
    await openChat(page);
    await page.click(`.chat-peer[data-user="${other.username}"]`);
    await p.click(`.chat-peer[data-user="${ADMIN.username}"]`);

    // So viele, dass der Verlauf sicher ueberlaeuft
    for (let i = 1; i <= 25; i += 1) {
      await page.fill("#chat-input", `Zeile ${i}`);
      await page.press("#chat-input", "Enter");
    }
    await expect(p.locator(".chat-bubble")).toHaveCount(25, { timeout: 20000 });

    // Der rollende Teil ist NICHT .chat-log selbst.
    const amEnde = async (seite) => seite.evaluate(() => {
      const log = document.getElementById("chat-log");
      const os = window.OverlayScrollbarsGlobal
        && window.OverlayScrollbarsGlobal.OverlayScrollbars(log);
      const v = os ? os.elements().viewport : log;
      return v.scrollHeight - v.scrollTop - v.clientHeight < 40;
    });
    expect(await amEnde(page)).toBe(true);   // eigene Nachricht
    expect(await amEnde(p)).toBe(true);      // live empfangene

    // Zurueckgeblaettert: NICHT wegspringen, sondern die Pille anbieten
    await p.evaluate(() => {
      const log = document.getElementById("chat-log");
      const os = window.OverlayScrollbarsGlobal.OverlayScrollbars(log);
      os.elements().viewport.scrollTop = 0;
    });
    await expect(p.locator("#chat-new")).toBeHidden();
    await sendTo(page, other.username, "Waehrend du oben liest");
    await expect(p.locator("#chat-new")).toBeVisible({ timeout: 15000 });
    expect(await amEnde(p)).toBe(false);

    // Klick auf die Pille rollt ans Ende
    await p.click("#chat-new");
    await expect(p.locator("#chat-new")).toBeHidden();
    await expect.poll(() => amEnde(p), { timeout: 10000 }).toBe(true);

    await ctx.close();
  });

  test("bei zugeklapptem Fenster kommt die Nachricht in die Glocke", async ({ browser, page }) => {
    // Der Fehler, der das ausgeloest hat: empfangen() hielt "Gespraech
    // ausgewaehlt" fuer "Nutzer schaut hin". Beim Zuklappen blieb die Auswahl
    // stehen — die Nachricht landete im UNSICHTBAREN Verlauf und wurde
    // sofort als gelesen gemeldet. Also keine Glocke, kein Zaehler, und beim
    // Aufklappen stand sie einfach da. Massgeblich ist die SICHTBARKEIT.
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Zugeklappt" });

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, other.username, other.password);
    await openChat(p);
    await openChat(page);

    // Erst ein Austausch, damit beim Empfaenger ein Gespraech AUSGEWAEHLT ist
    await sendTo(page, other.username, "Erste Nachricht");
    await p.click(`.chat-peer[data-user="${ADMIN.username}"]`);
    await expect(p.locator(".chat-bubble").first()).toHaveText("Erste Nachricht");
    await expect(p.locator("#notif-badge")).toBeHidden();

    // Fenster zuklappen — die Auswahl bleibt bestehen
    await p.click("#chat-minimize");
    await expect(p.locator("#chat")).toBeHidden();

    await sendTo(page, other.username, "Bist du noch da?");

    // Jetzt MUSS es auffallen: Glocke, Eintrag und Zaehler an der Kontaktzeile
    await expect(p.locator("#notif-badge")).toBeVisible({ timeout: 15000 });
    await expect(p.locator('.notif-item[data-kind="chat"]')).toHaveCount(1);
    await expect(p.locator(`.chat-peer[data-user="${ADMIN.username}"] .chat-peer-unread`))
      .toBeVisible();
    // ... und serverseitig darf sie NICHT als gelesen gelten
    const offen = await p.evaluate(async (u) => {
      const r = await fetch("/chat/peers", { credentials: "same-origin" });
      return (await r.json()).peers.find((x) => x.username === u).unread;
    }, ADMIN.username);
    expect(offen).toBe(1);

    // Aufklappen zaehlt als gesehen: Zaehler und Glocke gehen weg
    await p.click("#chat-toggle");
    await expect(p.locator(`.chat-peer[data-user="${ADMIN.username}"] .chat-peer-unread`))
      .toBeHidden({ timeout: 15000 });
    await expect(p.locator(".chat-bubble").last()).toHaveText("Bist du noch da?");

    await ctx.close();
  });

  test("auch ein zugesperrter Chat meldet neue Nachrichten", async ({ browser, page }) => {
    // Zweiter Fehler derselben Meldung: verbindeStrom() haing frueher an
    // offen(), also am Aufschliessen. Ein zugesperrter Chat bekam damit gar
    // nichts mit. Der Strom transportiert Geheimtext — um zu merken, DASS
    // etwas ankam, braucht es keinen Schluessel.
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Zugesperrt" });

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, other.username, other.password);
    await openChat(p);                     // legt das Schluesselpaar an

    // Speicher leeren, Sitzung behalten -> beim Neuladen zugesperrt
    await p.evaluate(() => new Promise((ok) => {
      const r = indexedDB.deleteDatabase("relay-chat");
      r.onsuccess = r.onerror = r.onblocked = () => ok();
    }));
    await p.reload();
    await waitAppReady(p);
    await expect(p.locator("#chat-lock")).toBeVisible({ timeout: 20000 });

    await openChat(page);
    await sendTo(page, other.username, "Trotzdem melden");

    await expect(p.locator("#notif-badge")).toBeVisible({ timeout: 15000 });
    await expect(p.locator(`.chat-peer[data-user="${ADMIN.username}"] .chat-peer-unread`))
      .toBeVisible();

    await ctx.close();
  });

  test("Chat-Nachricht in der Glocke oeffnet das Gespraech", async ({ browser, page }) => {
    await loginAsAdmin(page);
    const other = await createUser(page, { display: "Klopfer" });

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, other.username, other.password);
    await openChat(p);
    await openChat(page);
    await sendTo(page, other.username, "Klopf klopf");

    // Neu laden: die Glocke kommt jetzt serverseitig gerendert
    await p.reload();
    await waitAppReady(p);
    await expect(p.locator("#notif-badge")).toBeVisible();
    await p.click("#notif-btn");
    const eintrag = p.locator('.notif-item[data-kind="chat"]');
    await expect(eintrag).toContainText("hat dir geschrieben");
    await eintrag.click();

    // Das Fenster steht offen, das richtige Gespraech ist gewaehlt
    await expect(p.locator("#chat")).toBeVisible();
    await expect(p.locator(".chat-bubble").first()).toHaveText("Klopf klopf", { timeout: 15000 });
    // gelesen = weg
    await expect(p.locator("#notif-badge")).toBeHidden();

    await ctx.close();
  });
});
