#!/usr/bin/env bash
# Generates the podcast cover (3000x3000 PNG) with ImageMagick. Runs in CI after build.js; not committed.
set -euo pipefail
OUT="${1:-site/cover.png}"
if ! command -v convert >/dev/null 2>&1; then echo "ImageMagick not available — skipping cover"; exit 0; fi
FONT="$(fc-list 2>/dev/null | grep -i -m1 'DejaVuSans-Bold\|DejaVu Sans:style=Bold' | cut -d: -f1 || true)"
FONT_ARG=(); [ -n "$FONT" ] && FONT_ARG=(-font "$FONT")
convert -size 3000x3000 xc:'#121212' \
  -fill '#e8f0fe' -draw 'rectangle 0,2560 3000,2600' \
  "${FONT_ARG[@]}" -fill '#ebebeb' -gravity center -pointsize 330 -annotate +0-260 'AI Edge' \
  -pointsize 330 -annotate +0+120 'Briefing' \
  -pointsize 96 -fill '#9a9a9a' -annotate +0+560 'Daily, fact-first frontier AI news' \
  "$OUT"
echo "cover written to $OUT"
