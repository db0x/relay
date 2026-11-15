# Relay-Anpassung am Euro-Office-DocumentServer (Fork von OnlyOffice).
#
# WICHTIG — und anders als unter OnlyOffice: die local.json wird NICHT mehr
# ueberschrieben. Das Image bringt in dieser Datei die Zugangsdaten seines
# MITGELIEFERTEN Postgres-Clusters mit (beim Paketbau eingetragen), und sein
# Entrypoint legt die Rolle nicht an — er liest das Passwort nur von dort.
# Ein COPY darueber loeschte es, und der Server kaeme mit Anmeldefehlern gar
# nicht hoch. Unter OnlyOffice fiel dasselbe COPY nicht auf, weil dessen
# Startskript den Datenbankbenutzer selbst anlegt (mit dem dann leeren Wert).
#
# Noetig ist hier ohnehin fast nichts mehr: JWT, die Freigabe privater
# Adressen und die Konverter-Obergrenze nimmt Euro-Office als
# UMGEBUNGSVARIABLEN entgegen (siehe docker-compose.yml). Uebrig bleibt
# autoAssembly, fuer das es keine gibt — dafuer das Vorschalt-Skript.
FROM ghcr.io/euro-office/documentserver:latest

# --- Akzentleiste abschalten -----------------------------------------
# Euro-Office malt oben im Editor einen 6px-Streifen in einer Farbe JE
# DOKUMENTTYP: Text #446995 blau, Tabelle #3a8056 gruen, Praesentation
# #b75b44, PDF #aa5252, Zeichnung #444796. Technisch ist es ein
# Pseudo-Element, das #viewport um dieselben 6px nach unten schiebt:
#
#   :root body[data-editor-type] #viewport::before {
#     content: ""; position: fixed; top: 0; height: 6px;
#     background: var(--eo-app-accent);
#   }
#
# WARUM WEG: In Relay sitzt der Editor in einem eigenen Fenster mit eigener
# Titelleiste. Der Streifen verdoppelt dort keine Information, sondern setzt
# eine zweite, fremde Farbkante ueber unsere — in einer Oberflaeche, die
# sonst durchgehend demselben Satz folgt. (`--eo-app-accent` ist uebrigens
# die EINZIGE --eo-*-Variable im ganzen Stylesheet; diese Leiste ist der
# gesamte sichtbare Umfang des Rebrandings.)
#
# Angewandt wird es auf die drei Editor-Stylesheets. Der Schritt laeuft bei
# JEDEM Neubau gegen das frische Basis-Image, haelt also auch den
# naechtlichen Neubau aus. Rueckgaengig: diese RUN-Zeile loeschen.
#
# `grep -q` davor ist Absicht: findet sich die Regel nicht mehr (weil
# Euro-Office sie umbaut), bricht der Bau ab, statt stillschweigend nichts
# zu tun und uns im Glauben zu lassen, es sei erledigt.
RUN set -eu; \
    for d in documenteditor spreadsheeteditor presentationeditor; do \
      f="/var/www/euro-office/documentserver/web-apps/apps/$d/main/app.css"; \
      grep -q -- "--eo-app-accent" "$f" || { echo "ERWARTETE REGEL FEHLT in $f"; exit 1; }; \
      printf '\n/* Relay: Akzentleiste je Dokumenttyp abschalten */\n:root body[data-editor-type] #viewport::before{display:none !important}\n:root body[data-editor-type] #viewport{top:0 !important}\n' >> "$f"; \
    done

COPY relay-entry.sh /relay-entry.sh
RUN chmod +x /relay-entry.sh
ENTRYPOINT ["/relay-entry.sh"]
