#!/bin/sh
# Converts the raw screenshots (scripts/raw/*.png from screenshots.cjs) into the WebP files the page loads:
# a 2400 px image for large screens and a 1280 px one for the rest. Needs cwebp.
set -e
cd "$(dirname "$0")/.."
for raw in scripts/raw/*.png; do
  name=$(basename "$raw" .png)
  [ "$name" = icon ] && continue
  cwebp -quiet -q 82 -resize 2400 0 "$raw" -o "img/$name.webp"
  cwebp -quiet -q 80 -resize 1280 0 "$raw" -o "img/$name-1280.webp"
done
sips -z 256 256 scripts/raw/icon.png --out img/icon.png >/dev/null
sips -z 64 64 scripts/raw/icon.png --out img/favicon.png >/dev/null
