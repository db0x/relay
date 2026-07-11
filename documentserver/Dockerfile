# local.json muss eine echte Datei im Image sein (kein Single-File-Bind-Mount),
# sonst kann das Startup-Skript das Cache-Secret nicht per "json -I" hineinschreiben
# -> secure_link-Mismatch nginx<->DocService -> 403 beim Cache-Download.
FROM onlyoffice/documentserver
COPY local.json /etc/onlyoffice/documentserver/local.json
