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
COPY relay-entry.sh /relay-entry.sh
RUN chmod +x /relay-entry.sh
ENTRYPOINT ["/relay-entry.sh"]
