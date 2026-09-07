#!/bin/bash
# Bild einer Video-Bibliothek browsertauglich machen (MPEG-2 -> H.264).
#
# WARUM: Browser dekodieren kein MPEG-2. Solche Filme — praktisch immer
# DVD-Rips — zeigen im Browser gar nichts: videoWidth 0, Bild 0 Bytes
# (nachgemessen). Eine reparierte Tonspur allein macht daraus nur ein
# Hoerspiel, deshalb erledigt dieses Skript BEIDES in einem Durchgang.
#
# WAS PASSIERT, je Film:
#   - das Bild wird nach H.264 umkodiert (CRF 20, veryfast),
#   - Seitenverhaeltnis, Aufloesung, Bildrate und Kapitel bleiben,
#   - Zeilensprung wird ERKANNT und nur dann entflochten, wenn wirklich
#     welcher da ist (viele DVD-Rips sind als "tt" markiert, aber in
#     Wahrheit progressiv — blindes yadif kostete unnoetig Qualitaet),
#   - alle vorhandenen Tonspuren bleiben unveraendert kopiert,
#   - fehlt eine browsertaugliche Tonspur, kommt eine AAC-Spur dazu
#     (deutsche Quelle bevorzugt) — dasselbe wie in ton-nachruesten.sh.
#
# QUALITAET: gemessen an einem DVD-Rip (720x576, 7,5 Mbit/s) ergibt CRF 20
# SSIM 0,977 und PSNR 43,3 dB. Ab etwa 40 dB gilt ein Unterschied als nicht
# mehr wahrnehmbar. Es bleibt aber eine ZWEITE verlustbehaftete Runde und ist
# nicht umkehrbar — darum gibt es --keep-original, und ich empfehle es.
#
# SICHERHEITSNETZE (wie beim Ton-Skript):
#   1. schreibt in eine .tmp neben der Datei, nie in die Datei selbst,
#   2. prueft hart, BEVOR ersetzt wird: Bild-Codec h264, Aufloesung und
#      SEITENVERHAELTNIS unveraendert (sonst waere der Film gestaucht),
#      Laufzeit auf 2 s genau, Tonspuren vollzaehlig, browsertauglicher Ton
#      vorhanden, und die Datei laesst sich VOLLSTAENDIG dekodieren,
#   3. ersetzt erst danach; bei jedem Fehler bleibt das Original unberuehrt,
#   4. Platzpruefung vorab, Rechte/Eigentuemer/Datum bleiben erhalten,
#   5. wiederholbar: fertige Filme werden uebersprungen.
#
# Aufruf:
#   bild-nachruesten.sh --report [VERZ]          nur ansehen
#   bild-nachruesten.sh --only "Iron Man" [VERZ] nur passende Filme
#   bild-nachruesten.sh --limit 3 [VERZ]         die ersten drei
# Optionen: --keep-original  --log DATEI  --crf N (Standard 20)
#           --preset X (Standard veryfast)
set -u

MODUS=umwandeln; LIMIT=0; BEHALTEN=0; LOGDATEI=""; NUR=""; CRF=20; PRESET=veryfast
while [ $# -gt 0 ]; do
  case "$1" in
    --report|-r)     MODUS=report; shift;;
    --limit)         LIMIT="${2:-0}"; shift 2;;
    --only)          NUR="${2:-}"; shift 2;;
    --keep-original) BEHALTEN=1; shift;;
    --log)           LOGDATEI="${2:-}"; shift 2;;
    --crf)           CRF="${2:-20}"; shift 2;;
    --preset)        PRESET="${2:-veryfast}"; shift 2;;
    -*)              echo "Unbekannte Option: $1" >&2; exit 2;;
    *)               break;;
  esac
done
WURZEL="${1:-$(sed -n 's/^SHARED_LIB=//p' "$(dirname "$0")/../.env" 2>/dev/null | head -1)}"

sag() { printf '%s\n' "$*"; [ -n "$LOGDATEI" ] && printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOGDATEI"; }

[ -n "$WURZEL" ] && [ -d "$WURZEL" ] || { echo "Verzeichnis fehlt: ${WURZEL:-<leer>}" >&2; exit 1; }
command -v ffprobe >/dev/null && command -v ffmpeg >/dev/null || { echo "ffmpeg/ffprobe fehlen" >&2; exit 1; }

BILD_OK='^(h264|vp8|vp9|av1|theora)$'                 # was Browser zeigen
TON_OK='^(aac|mp3|opus|vorbis|flac|pcm_)'             # was Browser hoeren
ENDUNGEN=( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.avi'
           -o -iname '*.mov' -o -iname '*.ts' -o -iname '*.m2ts' )

sag "Bibliothek: $WURZEL   (CRF $CRF, preset $PRESET)"
[ -n "$NUR" ] && sag "Nur Filme mit: $NUR"
[ "$MODUS" = report ] && sag "(nur Bestandsaufnahme — es wird nichts geschrieben)"

reste=$(find "$WURZEL" -type f -name '*.bildfix.tmp.*' -print | wc -l)
if [ "$reste" -gt 0 ]; then
  sag "  $reste Rest(e) eines abgebrochenen Laufs entfernt"
  [ "$MODUS" = umwandeln ] && find "$WURZEL" -type f -name '*.bildfix.tmp.*' -delete
fi

gesamt=0; betroffen=0; fertig=0; gescheitert=0; groesste=0; summe=0
liste=$(mktemp); trap 'rm -f "$liste"' EXIT

while IFS= read -r -d '' f; do
  gesamt=$((gesamt+1))
  [ -n "$NUR" ] && { case "$f" in *"$NUR"*) ;; *) continue;; esac; }
  bild=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null | head -1)
  [ -n "$bild" ] || continue
  echo "$bild" | grep -qE "$BILD_OK" && continue      # Bild ist schon in Ordnung
  betroffen=$((betroffen+1))
  g=$(stat -c %s "$f"); summe=$((summe+g)); [ "$g" -gt "$groesste" ] && groesste=$g
  printf '%s\0' "$f" >>"$liste"
  ton=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null | grep . | paste -sd,)
  sag "  betroffen:  ${f#"$WURZEL"/}  (Bild: $bild, Ton: ${ton:-keiner}, $((g/1024/1024)) MB)"
done < <(find "$WURZEL" -type f \( "${ENDUNGEN[@]}" \) ! -name '*.bildfix.tmp.*' ! -name '*.orig' -print0 | sort -z)

sag ""
sag "$gesamt Videodateien, $betroffen mit browserfremdem Bild."
sag "Zusammen $((summe/1024/1024/1024)) GB; groesste Datei $((groesste/1024/1024)) MB."
[ "$MODUS" = report ] && exit 0
[ "$betroffen" -eq 0 ] && { sag "Nichts zu tun."; exit 0; }

# Platz: es wird immer nur EINE Datei geschrieben, und die neue ist kleiner.
# Mit --keep-original bleibt zusaetzlich das Original liegen.
frei=$(df -P --block-size=1 "$WURZEL" | awk 'NR==2{print $4}')
noetig=$((groesste + 1024*1024*1024))
if [ "$frei" -lt "$noetig" ]; then
  sag "ABBRUCH: nur $((frei/1024/1024)) MB frei, gebraucht werden $((noetig/1024/1024)) MB."; exit 1
fi
sag "Platz: $((frei/1024/1024/1024)) GB frei — reicht."
sag ""

n=0
while IFS= read -r -d '' f; do
  n=$((n+1))
  [ "$LIMIT" -gt 0 ] && [ "$n" -gt "$LIMIT" ] && { sag "(--limit $LIMIT erreicht)"; break; }
  sag "[$n/$betroffen] ${f#"$WURZEL"/}"
  start=$(date +%s)

  # --- Zustand vorher festhalten -------------------------------------
  read -r w_alt h_alt dar_alt <<<"$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,display_aspect_ratio -of csv=p=0 "$f" 2>/dev/null | tr ',' ' ')"
  dauer_alt=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null)
  groesse_alt=$(stat -c %s "$f")
  tonspuren=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null | grep .)
  anzahl=$(echo "$tonspuren" | grep -c .)

  # --- Zeilensprung? Nur messen, nicht raten --------------------------
  # 400 Bilder aus der Mitte. Nur wenn wirklich Halbbilder ueberwiegen, wird
  # entflochten — viele DVD-Rips sind als "tt" markiert und trotzdem progressiv.
  idet=$(ffmpeg -nostdin -v info -ss 600 -i "$f" -vf idet -frames:v 400 -an -f null - 2>&1 \
         | grep "Multi frame detection" | tail -1)
  tff=$(echo "$idet" | sed -n 's/.*TFF: *\([0-9]*\).*/\1/p'); tff=${tff:-0}
  bff=$(echo "$idet" | sed -n 's/.*BFF: *\([0-9]*\).*/\1/p'); bff=${bff:-0}
  prog=$(echo "$idet" | sed -n 's/.*Progressive: *\([0-9]*\).*/\1/p'); prog=${prog:-0}
  if [ "$((tff+bff))" -gt "$prog" ]; then
    filter=( -vf yadif=0:-1:0 ); sag "    Zeilensprung erkannt (TFF $tff / BFF $bff) — wird entflochten"
  else
    filter=(); sag "    progressiv (TFF $tff / BFF $bff / prog $prog) — kein Entflechten"
  fi

  # --- Ton: vorhandene kopieren, bei Bedarf eine AAC-Spur ergaenzen ----
  tonargs=( -c:a copy ); erwartete_tonspuren=$anzahl
  if [ "$anzahl" -gt 0 ] && ! echo "$tonspuren" | grep -qE "$TON_OK"; then
    idx=$(ffprobe -v error -select_streams a -show_entries stream_tags=language -of csv=p=0 "$f" 2>/dev/null \
          | grep -nx 'ger\|deu' | head -1 | cut -d: -f1)
    [ -n "$idx" ] && idx=$((idx-1)) || idx=0
    tonargs=( -map "0:a:$idx" -c:a copy -c:a:"$anzahl" aac -ac:a:"$anzahl" 2 -b:a:"$anzahl" 192k
              -metadata:s:a:"$anzahl" language=ger
              -metadata:s:a:"$anzahl" title="Deutsch (AAC, für Browser)" )
    erwartete_tonspuren=$((anzahl+1))
    sag "    Tonspur $idx wird zusaetzlich als AAC angehaengt"
  fi

  case "${f##*.}" in
    [Mm][Kk][Vv]) muxer=matroska; endung=mkv;;
    [Mm][Pp]4|[Mm]4[Vv]|[Mm][Oo][Vv]) muxer=mp4; endung=mp4;;
    *) muxer=matroska; endung=mkv;;
  esac
  tmp="$f.bildfix.tmp.$endung"; rm -f "$tmp"

  if ! ffmpeg -nostdin -v error -y -i "$f" \
       -map 0 -map -0:d "${filter[@]}" \
       -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p \
       "${tonargs[@]}" -c:s copy \
       -f "$muxer" "$tmp"
  then
    rm -f "$tmp"; gescheitert=$((gescheitert+1)); sag "    FEHLER (ffmpeg) — Original unveraendert"; continue
  fi

  # --- Pruefungen ------------------------------------------------------
  fehler=""
  read -r w_neu h_neu dar_neu <<<"$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,display_aspect_ratio -of csv=p=0 "$tmp" 2>/dev/null | tr ',' ' ')"
  bild_neu=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$tmp" 2>/dev/null | head -1)
  ton_neu=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$tmp" 2>/dev/null | grep .)
  anz_neu=$(echo "$ton_neu" | grep -c .)
  dauer_neu=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp" 2>/dev/null)
  groesse_neu=$(stat -c %s "$tmp" 2>/dev/null || echo 0)

  [ "$bild_neu" = "h264" ] || fehler="$fehler Bild($bild_neu)"
  [ "$w_neu" = "$w_alt" ] && [ "$h_neu" = "$h_alt" ] || fehler="$fehler Aufloesung(${w_neu}x${h_neu}!=${w_alt}x${h_alt})"
  # Seitenverhaeltnis: DVD ist anamorph (720x576 bei 16:9). Ginge das
  # verloren, waere der Film gestaucht — deshalb ausdruecklich geprueft.
  [ "$dar_neu" = "$dar_alt" ] || fehler="$fehler Seitenverhaeltnis($dar_neu!=$dar_alt)"
  d=$(( ${dauer_neu%.*} - ${dauer_alt%.*} )); [ "$d" -lt 0 ] && d=$(( -d ))
  [ "$d" -le 2 ] || fehler="$fehler Laufzeit(${dauer_neu%.*}!=${dauer_alt%.*})"
  [ "$anz_neu" = "$erwartete_tonspuren" ] || fehler="$fehler Tonspuren($anz_neu!=$erwartete_tonspuren)"
  [ "$anzahl" -eq 0 ] || echo "$ton_neu" | grep -qE "$TON_OK" || fehler="$fehler kein-browsertauglicher-Ton"
  # nicht absurd klein (eine abgebrochene Datei faellt so auf)
  [ "$groesse_neu" -gt $((groesse_alt/50)) ] || fehler="$fehler viel-zu-klein"
  # und die neue Datei muss sich VOLLSTAENDIG dekodieren lassen
  if [ -z "$fehler" ]; then
    ffmpeg -nostdin -v error -i "$tmp" -map 0:v -map 0:a -f null - >/dev/null 2>&1 \
      || fehler="$fehler nicht-vollstaendig-dekodierbar"
  fi

  if [ -n "$fehler" ]; then
    rm -f "$tmp"; gescheitert=$((gescheitert+1))
    sag "    FEHLER (Pruefung:$fehler) — Original unveraendert"; continue
  fi

  chmod --reference="$f" "$tmp" 2>/dev/null
  chown --reference="$f" "$tmp" 2>/dev/null
  touch -r "$f" "$tmp"
  if [ "$BEHALTEN" = 1 ]; then
    mv -f "$f" "$f.orig" || { rm -f "$tmp"; gescheitert=$((gescheitert+1)); sag "    FEHLER (Original sichern)"; continue; }
  fi
  if mv -f "$tmp" "$f"; then
    fertig=$((fertig+1))
    dauer=$(( $(date +%s) - start ))
    sag "    OK — $bild_neu ${w_neu}x${h_neu} $dar_neu, Ton: $(echo "$ton_neu" | paste -sd,)"
    sag "       $((groesse_alt/1024/1024)) MB -> $((groesse_neu/1024/1024)) MB (-$(( (groesse_alt-groesse_neu)*100/groesse_alt ))%), $((dauer/60)) min $((dauer%60)) s"
  else
    gescheitert=$((gescheitert+1)); sag "    FEHLER (Ersetzen)"
    [ "$BEHALTEN" = 1 ] && mv -f "$f.orig" "$f"
  fi
done <"$liste"

sag ""
sag "fertig: $fertig umgewandelt, $gescheitert fehlgeschlagen, von $betroffen betroffenen."
[ "$gescheitert" -gt 0 ] && exit 1
exit 0
