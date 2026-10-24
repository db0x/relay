#!/bin/sh
# Relay-Vorschaltung vor den Euro-Office-Entrypoint: zwei Handgriffe, dann
# uebernimmt das Original (exec).
set -e

CONF="${EO_CONF:-/etc/euro-office/documentserver}/local.json"

# --- 1. autoAssembly ---------------------------------------------------
# Der DocumentServer speichert damit alle fuenf Minuten von sich aus durch
# (Speicher-Callback mit Status 6), auch wenn niemand Strg+S drueckt. Das ist
# das Netz unter dem Durchschlag beim Speichern: ohne es kostete ein Absturz
# im schlimmsten Fall eine ganze Sitzung.
#
# GEPATCHT statt als Datei gesetzt — das ist der Unterschied zu frueher und
# der Grund, warum es diese Zeilen gibt: in derselben Datei stehen die
# Zugangsdaten des mitgelieferten Postgres. Wer sie ersetzt, nimmt dem Server
# die Anmeldung (siehe Dockerfile). jq liegt im Image, der offizielle
# Entrypoint benutzt es selbst; er fuehrt seine eigenen Aenderungen danach
# ebenfalls zusammen, unsere bleibt also stehen.
if [ -f "$CONF" ]; then
  tmp=$(mktemp)
  if jq '.services.CoAuthoring.autoAssembly = { "enable": true, "interval": "5m" }' "$CONF" > "$tmp"; then
    # cat statt mv: behaelt Eigentuemer und Rechte der Originaldatei (ds:ds)
    cat "$tmp" > "$CONF"
    echo "[relay] autoAssembly = alle 5 Minuten"
  else
    echo "[relay] WARNUNG: autoAssembly konnte nicht gesetzt werden — es wird nur beim Schliessen gespeichert" >&2
  fi
  rm -f "$tmp"
fi

# --- 2. Obergrenze des Konverters --------------------------------------
# MAX_FILE_MB steht in Relay ueberall in MEGABYTE; der Entrypoint erwartet
# Bytes. Umrechnen und ihm ueberlassen — frueher trugen wir den Wert selbst in
# die Konfiguration ein, jetzt gibt es dafuer den vorgesehenen Weg.
MB="${MAX_FILE_MB:-512}"
case "$MB" in ''|*[!0-9]*) MB=512 ;; esac
FILECONVERTER_MAX_DOWNLOAD_BYTES=$((MB * 1024 * 1024))
export FILECONVERTER_MAX_DOWNLOAD_BYTES
echo "[relay] FileConverter.maxDownloadBytes = ${MB} MB"

exec /entrypoint.sh "$@"
