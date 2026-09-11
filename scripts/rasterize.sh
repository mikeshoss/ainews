#!/usr/bin/env bash
# SVG → PNG with librsvg (renders SVG filters correctly; ImageMagick's own SVG renderer does not).
# Usage: scripts/rasterize.sh in.svg out.png [width] [height]
set -euo pipefail
IN="$1"; OUT="$2"; W="${3:-3000}"; H="${4:-$W}"
if ! command -v rsvg-convert >/dev/null 2>&1; then echo "rsvg-convert not available — skipping $OUT"; exit 0; fi
rsvg-convert -w "$W" -h "$H" "$IN" -o "$OUT"
echo "wrote $OUT"
