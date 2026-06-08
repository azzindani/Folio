#!/usr/bin/env bash
# Fetch the core font set Folio steers designs toward, as TTFs, into src/mcp/fonts/.
# These are fed to resvg (fontDirs) so PNG/PDF export matches the editor's web-font
# render. Variable TTFs (one file = all weights) where available; static otherwise.
# Source: google/fonts @ main (OFL/Apache). Re-run to refresh. Idempotent.
set -u
DEST="$(cd "$(dirname "$0")/../../src/mcp/fonts" && pwd)"
JSD="https://cdn.jsdelivr.net/gh/google/fonts@main"
RAW="https://raw.githubusercontent.com/google/fonts/main"
# family-file|repo-relative-path
FONTS=(
  "Inter[opsz,wght].ttf|ofl/inter/Inter[opsz,wght].ttf"
  "SpaceGrotesk[wght].ttf|ofl/spacegrotesk/SpaceGrotesk[wght].ttf"
  "JetBrainsMono[wght].ttf|ofl/jetbrainsmono/JetBrainsMono[wght].ttf"
  "SpaceMono-Regular.ttf|ofl/spacemono/SpaceMono-Regular.ttf"
  "SpaceMono-Bold.ttf|ofl/spacemono/SpaceMono-Bold.ttf"
  "PlayfairDisplay[wght].ttf|ofl/playfairdisplay/PlayfairDisplay[wght].ttf"
  "BebasNeue-Regular.ttf|ofl/bebasneue/BebasNeue-Regular.ttf"
  "Anton-Regular.ttf|ofl/anton/Anton-Regular.ttf"
  "RobotoMono[wght].ttf|ofl/robotomono/RobotoMono[wght].ttf"
  "RobotoSlab[wght].ttf|apache/robotoslab/RobotoSlab[wght].ttf"
  "Lora[wght].ttf|ofl/lora/Lora[wght].ttf"
  "EBGaramond[wght].ttf|ofl/ebgaramond/EBGaramond[wght].ttf"
  "Montserrat[wght].ttf|ofl/montserrat/Montserrat[wght].ttf"
  "Manrope[wght].ttf|ofl/manrope/Manrope[wght].ttf"
  "SourceCodePro[wght].ttf|ofl/sourcecodepro/SourceCodePro[wght].ttf"
  "FiraCode[wght].ttf|ofl/firacode/FiraCode[wght].ttf"
  "PlusJakartaSans[wght].ttf|ofl/plusjakartasans/PlusJakartaSans[wght].ttf"
  "PublicSans[wght].ttf|ofl/publicsans/PublicSans[wght].ttf"
  "WorkSans[wght].ttf|ofl/worksans/WorkSans[wght].ttf"
  "Archivo[wdth,wght].ttf|ofl/archivo/Archivo[wdth,wght].ttf"
  # Roboto + IBM Plex Sans moved to non-obvious paths in google/fonts:
  "Roboto[wdth,wght].ttf|ofl/roboto/Roboto[wdth,wght].ttf"
  "IBMPlexSans[wdth,wght].ttf|ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf"
)
enc(){ python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
ok=0; fail=0
for entry in "${FONTS[@]}"; do
  out="${entry%%|*}"; rel="${entry##*|}"
  [ -s "$DEST/$out" ] && { echo "skip  $out (exists)"; ok=$((ok+1)); continue; }
  got=0
  for base in "$JSD" "$RAW"; do
    for i in 1 2 3; do
      if curl -fsSL -o "$DEST/$out" "$base/$(enc "$rel")"; then
        sz=$(wc -c < "$DEST/$out"); [ "$sz" -gt 2000 ] && { echo "ok    $out ($sz)"; got=1; break; }
      fi
      sleep 1
    done
    [ "$got" = 1 ] && break
  done
  [ "$got" = 1 ] && ok=$((ok+1)) || { echo "FAIL  $out"; rm -f "$DEST/$out"; fail=$((fail+1)); }
done
echo "--- $ok ok, $fail failed ---"
