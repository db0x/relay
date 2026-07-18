#!/bin/bash
# Relay-Wrapper um den DS-Start: schreibt MAX_FILE_MB (Default 512) als
# FileConverter.converter.maxDownloadBytes in die local.json, BEVOR der
# eigentliche DocumentServer startet. Nutzt dasselbe json-Tool wie das
# Original-Startskript (JSON_BIN). Das FileConverter-Skelett muss in
# local.json vorhanden sein — json legt keine Zwischenobjekte an.
set -e
MB="${MAX_FILE_MB:-512}"
case "$MB" in (''|*[!0-9]*) MB=512 ;; esac
BYTES=$((MB * 1024 * 1024))
/var/www/onlyoffice/documentserver/npm/json -q -I \
  -f /etc/onlyoffice/documentserver/local.json \
  -e "this.FileConverter.converter.maxDownloadBytes = ${BYTES}"
echo "[relay] FileConverter.maxDownloadBytes = ${MB} MB"
exec /app/ds/run-document-server.sh
