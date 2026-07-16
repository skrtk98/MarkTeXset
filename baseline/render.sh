#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: mathmd-baseline INPUT.md OUTPUT.pdf [en|ja]" >&2
  exit 2
fi

input=$1
output=$2
language=${3:-en}
class=article
if [[ "$language" == "ja" ]]; then
  class=ltjsarticle
elif [[ "$language" != "en" ]]; then
  echo "language must be en or ja" >&2
  exit 2
fi

tex=${output%.pdf}.tex
pandoc "$input" --from markdown --to latex --standalone --output "$tex" -V documentclass="$class"
lualatex -interaction=nonstopmode -halt-on-error -output-directory "$(dirname "$output")" "$tex" >/dev/null
mv "${tex%.tex}.pdf" "$output"
