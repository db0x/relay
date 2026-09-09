#!/bin/bash
# Tonspuren einer Video-Bibliothek browsertauglich machen.
#
# WARUM: Browser dekodieren kein Dolby Digital (AC-3/E-AC-3), DTS oder TrueHD.
# Filme mit ausschliesslich solchen Spuren laufen im Browser stumm — und weil
# gar keine abspielbare Spur da ist, blendet der Player nicht einmal seinen
# Lautstaerkeregler ein. Das sieht aus wie "der Ton laesst sich nicht
# aktivieren".
#
# WAS PASSIERT: Jedem betroffenen Film wird eine zusaetzliche AAC-Spur
# angehaengt (deutsche Spur bevorzugt). REIN ADDITIV:
#   - das Bild wird KOPIERT, nicht neu kodiert,
#   - alle vorhandenen Spuren bleiben unveraendert erhalten,
#   - die bisherige Standardspur bleibt Standardspur — Fernseher und VLC
#     bekommen weiter das originale Dolby, nur der Browser greift zur neuen
#     AAC-Spur (nachgemessen: Chromium tut das auch, wenn AC-3 davorsteht).
# Der Inhalt ist danach eine OBERMENGE des Vorherigen.
#
# WAS DIESES SKRIPT TUT, DAMIT NICHTS KAPUTTGEHT:
#   1. schreibt IMMER in eine .tmp neben der Datei, nie in die Datei selbst,
#   2. prueft die .tmp danach hart — Laufzeit, Spurenzahl, Bild-Codec
#      unveraendert, neue Tonspur vorhanden UND vollstaendig dekodierbar,
#   3. ersetzt das Original erst, wenn alle Pruefungen bestanden sind,
#   4. bricht bei zu wenig Plattenplatz ab, BEVOR es anfaengt,
#   5. uebernimmt Rechte, Eigentuemer und Aenderungsdatum,
#   6. ist wiederholbar: fertige Filme werden uebersprungen, ein Abbruch
#      hinterlaesst nur eine .tmp, die beim naechsten Lauf wegfliegt.
# Bei JEDEM Fehler bleibt das Original unangetastet.
#
# Aufruf:
#   ton-nachruesten.sh --report [VERZEICHNIS]   nur ansehen, nichts aendern
#   ton-nachruesten.sh --limit 3 [VERZEICHNIS]  nur die ersten 3 reparieren
#   ton-nachruesten.sh [VERZEICHNIS]            alles reparieren
# Optionen:
#   --keep-original   Original als <name>.orig behalten (braucht doppelt Platz)
#   --log DATEI       Protokoll zusaetzlich in eine Datei
set -u

MODUS=reparieren; LIMIT=0; BEHALTEN=0; LOGDATEI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --report|-r)      MODUS=report; shift;;
    --limit)          LIMIT="${2:-0}"; shift 2;;
    --keep-original)  BEHALTEN=1; shift;;
    --log)            LOGDATEI="${2:-}"; shift 2;;
    -*)               echo "Unbekannte Option: $1" >&2; exit 2;;
    *)                break;;
  esac
done
WURZEL="${1:-$(sed -n 's/^SHARED_LIB=//p' "$(dirname "$0")/../.env" 2>/dev/null | head -1)}"

sag() { printf '%s\n' "$*"; [ -n "$LOGDATEI" ] && printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOGDATEI"; }

[ -n "$WURZEL" ] && [ -d "$WURZEL" ] || { echo "Verzeichnis fehlt: ${WURZEL:-<leer>}" >&2; exit 1; }
command -v ffprobe >/dev/null && command -v ffmpeg >/dev/null || { echo "ffmpeg/ffprobe fehlen" >&2; exit 1; }

SPIELBAR='^(aac|mp3|opus|vorbis|flac|pcm_)'      # Tonspuren, die Browser abspielen
# Bild-Codecs, die Browser abspielen. Filme mit anderem Bild (mpeg2video aus
# DVD-Rips, mpeg4, vc1) werden UEBERSPRUNGEN: eine reparierte Tonspur machte
# daraus nur ein Hoerspiel — gemessen an einem MPEG-2-Film: Ton 127582 Bytes,
# Bild 0 Bytes, videoWidth 0. Solche Filme brauchen zuerst eine Bild-Umwandlung.
BILD_OK='^(h264|vp8|vp9|av1|theora)$'
ENDUNGEN=( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.avi'
           -o -iname '*.mov' -o -iname '*.ts' -o -iname '*.m2ts' -o -iname '*.webm' )

sag "Bibliothek: $WURZEL"
[ "$MODUS" = report ] && sag "(nur Bestandsaufnahme — es wird nichts geschrieben)"

# Liegengebliebene .tmp aus einem abgebrochenen Lauf: die sind wertlos, das
# Original ist ja unberuehrt. Weg damit, bevor Platz gerechnet wird.
altlasten=$(find "$WURZEL" -type f -name '*.tonfix.tmp.*' -print | wc -l)
if [ "$altlasten" -gt 0 ]; then
  sag "  $altlasten Rest(e) eines abgebrochenen Laufs entfernt"
  [ "$MODUS" = reparieren ] && find "$WURZEL" -type f -name '*.tonfix.tmp.*' -delete
fi

gesamt=0; betroffen=0; repariert=0; gescheitert=0; ohneton=0; bildfremd=0; groesste=0; summe=0
liste=$(mktemp); trap 'rm -f "$liste"' EXIT

while IFS= read -r -d '' f; do
  gesamt=$((gesamt+1))
  spuren=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null)
  if [ -z "$spuren" ]; then
    sag "  ohne Tonspur:  ${f#"$WURZEL"/}"; ohneton=$((ohneton+1)); continue
  fi
  if echo "$spuren" | grep -qE "$SPIELBAR"; then continue; fi   # hat schon Spielbares
  bild=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null | head -1)
  if ! echo "$bild" | grep -qE "$BILD_OK"; then
    sag "  Bild nicht browsertauglich ($bild), uebersprungen:  ${f#"$WURZEL"/}"
    bildfremd=$((bildfremd+1)); continue
  fi
  betroffen=$((betroffen+1))
  g=$(stat -c %s "$f")
  summe=$((summe+g)); [ "$g" -gt "$groesste" ] && groesste=$g
  printf '%s\0' "$f" >>"$liste"
  sag "  betroffen:  ${f#"$WURZEL"/}  (Ton: $(echo "$spuren" | paste -sd,), $((g/1024/1024)) MB)"
done < <(find "$WURZEL" -type f \( "${ENDUNGEN[@]}" \) ! -name '*.tonfix.tmp.*' -print0 | sort -z)

sag ""
sag "$gesamt Videodateien: $betroffen mit reparierbarer Tonspur, $bildfremd mit browserfremdem Bild (uebersprungen), $ohneton ohne Tonspur."
sag "Zusammen $((summe/1024/1024/1024)) GB; groesste Datei $((groesste/1024/1024)) MB."

if [ "$MODUS" = report ]; then
  sag "Zum Reparieren ohne --report starten (vorher --limit 2 zum Ausprobieren)."
  exit 0
fi
[ "$betroffen" -eq 0 ] && { sag "Nichts zu tun."; exit 0; }

# Platz: es wird immer nur EINE Datei gleichzeitig geschrieben. Noetig ist
# also die groesste plus Reserve — nicht die Summe.
frei=$(df -P --block-size=1 "$WURZEL" | awk 'NR==2{print $4}')
noetig=$((groesste + groesste/5 + 1024*1024*1024))
if [ "$frei" -lt "$noetig" ]; then
  sag "ABBRUCH: nur $((frei/1024/1024)) MB frei, gebraucht werden $((noetig/1024/1024)) MB."
  exit 1
fi
sag "Platz: $((frei/1024/1024/1024)) GB frei — reicht."
sag ""

n=0
while IFS= read -r -d '' f; do
  n=$((n+1))
  [ "$LIMIT" -gt 0 ] && [ "$n" -gt "$LIMIT" ] && { sag "(--limit $LIMIT erreicht)"; break; }
  kurz="${f#"$WURZEL"/}"
  sag "[$n/$betroffen] $kurz"

  anzahl=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | grep -c .)
  # Datenstroeme (bin_data, Timecode) werden nicht uebernommen — fuer die
  # Wiedergabe wertlos.
  # GEPRUEFT wird NICHT die Gesamtzahl der Spuren: der mp4-Muxer legt von sich
  # aus einen Textstrom fuer die Kapitelmarken an (bei .m4v gemessen), damit
  # waere die Zahl je nach Behaelter eine andere. Geprueft wird stattdessen
  # genau das, worauf es ankommt — Bild unveraendert, genau eine Tonspur mehr.
  bildspuren=$(ffprobe -v error -select_streams v -show_entries stream=index -of csv=p=0 "$f" | grep -c .)
  bild_alt=$(ffprobe -v error -select_streams v -show_entries stream=codec_name -of csv=p=0 "$f" | paste -sd,)
  dauer_alt=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  groesse_alt=$(stat -c %s "$f")
  # deutsche Spur bevorzugen, sonst die erste
  idx=$(ffprobe -v error -select_streams a -show_entries stream_tags=language -of csv=p=0 "$f" \
        | grep -nx 'ger\|deu' | head -1 | cut -d: -f1)
  [ -n "$idx" ] && idx=$((idx-1)) || idx=0

  # Behaelter der QUELLE beibehalten: schriebe man MKV-Inhalt in eine .m4v,
  # passten Endung und Inhalt nicht mehr zusammen (und Relay setzt den
  # Content-Type nach der Endung). mp4 kann AC-3 und AAC nebeneinander.
  # WICHTIG dabei die Standardspur-Markierung der neuen Spur:
  #   matroska — auf 0 lassen. Chromium sucht sich dort selbst eine
  #     abspielbare Spur, und die urspruengliche bleibt Standard: Fernseher
  #     und VLC bekommen weiter das originale Dolby (nachgemessen).
  #   mp4 — MUSS default sein. Dort nimmt Chromium ausschliesslich die
  #     Standardspur und faellt NICHT zurueck; ohne die Marke bleibt der Film
  #     im Browser stumm (nachgemessen: Ton-Bytes 0).
  case "${f##*.}" in
    [Mm][Kk][Vv]|[Ww][Ee][Bb][Mm]) muxer=matroska; endung=mkv; marke=0;;
    [Mm][Pp]4|[Mm]4[Vv]|[Mm][Oo][Vv])   muxer=mp4;      endung=mp4; marke=default;;
    *) sag "    uebersprungen: Behaelter .${f##*.} wird nicht angefasst"; gescheitert=$((gescheitert+1)); continue;;
  esac
  tmp="$f.tonfix.tmp.$endung"
  rm -f "$tmp"
  # -map 0             alles Vorhandene uebernehmen
  # -map 0:a:$idx      die gewaehlte Tonspur ein zweites Mal ...
  # -c copy            ... nichts neu kodieren ...
  # -c:a:$anzahl aac   ... ausser genau dieser angehaengten Spur ($anzahl ist
  #                    ihr Index unter den Ausgabe-Tonspuren: die vorhandenen
  #                    belegen 0..anzahl-1).
  # -ac 2              Stereo: Browser geben ohnehin Stereo aus, und die Datei
  #                    waechst so nur um wenige Prozent.
  if ! ffmpeg -nostdin -v error -y -i "$f" \
       -map 0 -map -0:d -map "0:a:$idx" \
       -c copy -c:a:"$anzahl" aac -ac:a:"$anzahl" 2 -b:a:"$anzahl" 192k \
       -metadata:s:a:"$anzahl" language=ger \
       -metadata:s:a:"$anzahl" title="Deutsch (AAC, für Browser)" \
       -disposition:a:"$anzahl" "$marke" \
       -f "$muxer" "$tmp"
  then
    rm -f "$tmp"; gescheitert=$((gescheitert+1)); sag "    FEHLER (ffmpeg) — Original unveraendert"; continue
  fi

  # --- Pruefungen, ALLE muessen bestehen -------------------------------
  fehler=""
  neu_ton=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$tmp" 2>/dev/null)
  neu_bild=$(ffprobe -v error -select_streams v -show_entries stream=codec_name -of csv=p=0 "$tmp" 2>/dev/null | paste -sd,)
  neu_anzahl=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$tmp" 2>/dev/null | grep -c .)
  neu_bildspuren=$(ffprobe -v error -select_streams v -show_entries stream=index -of csv=p=0 "$tmp" 2>/dev/null | grep -c .)
  dauer_neu=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp" 2>/dev/null)
  groesse_neu=$(stat -c %s "$tmp" 2>/dev/null || echo 0)

  echo "$neu_ton" | grep -qE "$SPIELBAR" || fehler="$fehler keine-spielbare-Tonspur"
  [ "$neu_anzahl" = "$((anzahl+1))" ] || fehler="$fehler Tonspuren($neu_anzahl!=$((anzahl+1)))"
  [ "$neu_bildspuren" = "$bildspuren" ] || fehler="$fehler Bildspuren($neu_bildspuren!=$bildspuren)"
  [ "$neu_bild" = "$bild_alt" ] || fehler="$fehler Bild-Codec($neu_bild!=$bild_alt)"
  # Laufzeit mit 2 Sekunden Toleranz. NICHT exakt: der AAC-Kodierer arbeitet in
  # Bloecken von 1024 Samples (~21 ms bei 48 kHz), die neue Tonspur endet also
  # nie genau gleich — und die Behaelter-Laufzeit richtet sich nach der
  # laengsten Spur. Ein Abschneiden auf ganze Sekunden machte aus 0,02 s
  # Unterschied eine ganze (bei "Iron Sky" genau so passiert: 5562,000 gegen
  # 5561,x). Das BILD kann ohnehin nicht abweichen, es wird nur kopiert.
  differenz=$(( ${dauer_neu%.*} - ${dauer_alt%.*} ))
  [ "$differenz" -lt 0 ] && differenz=$(( -differenz ))
  [ "$differenz" -le 2 ] || fehler="$fehler Laufzeit(${dauer_neu%.*}!=${dauer_alt%.*})"
  # nie kleiner als das Original — eine abgeschnittene Datei faellt so auf
  [ "$groesse_neu" -ge "$groesse_alt" ] || fehler="$fehler Groesse-geschrumpft"
  # und die neue Spur muss sich VOLLSTAENDIG dekodieren lassen
  if [ -z "$fehler" ]; then
    ffmpeg -nostdin -v error -i "$tmp" -map "0:a:$anzahl" -f null - >/dev/null 2>&1 \
      || fehler="$fehler neue-Tonspur-nicht-dekodierbar"
  fi

  if [ -n "$fehler" ]; then
    rm -f "$tmp"; gescheitert=$((gescheitert+1))
    sag "    FEHLER (Pruefung:$fehler) — Original unveraendert"; continue
  fi

  # --- erst jetzt ersetzen --------------------------------------------
  chmod --reference="$f" "$tmp" 2>/dev/null
  chown --reference="$f" "$tmp" 2>/dev/null
  touch -r "$f" "$tmp"
  if [ "$BEHALTEN" = 1 ]; then mv -f "$f" "$f.orig" || { rm -f "$tmp"; gescheitert=$((gescheitert+1)); sag "    FEHLER (Original sichern)"; continue; }; fi
  if mv -f "$tmp" "$f"; then
    repariert=$((repariert+1))
    sag "    OK — Spuren jetzt: $(echo "$neu_ton" | paste -sd,), +$(( (groesse_neu-groesse_alt)/1024/1024 )) MB"
  else
    gescheitert=$((gescheitert+1)); sag "    FEHLER (Ersetzen)"
    [ "$BEHALTEN" = 1 ] && mv -f "$f.orig" "$f"
  fi
done <"$liste"

sag ""
sag "fertig: $repariert repariert, $gescheitert fehlgeschlagen, von $betroffen betroffenen."
[ "$gescheitert" -gt 0 ] && exit 1
exit 0
