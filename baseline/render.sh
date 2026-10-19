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

output=$(realpath -m "$output")
tex=${output%.pdf}.tex
# Resolve images relative to the Markdown file, as MarkTeXset does.
cd "$(dirname "$input")"
input=$(basename "$input")
pandoc "$input" --from markdown --to latex --standalone --output "$tex" -V documentclass="$class"
if ! lualatex -interaction=nonstopmode -halt-on-error -output-directory "$(dirname "$output")" "$tex" >/dev/null; then
  tail -n 40 "${tex%.tex}.log" >&2
  exit 1
fi
if [[ "${tex%.tex}.pdf" != "$output" ]]; then
  mv "${tex%.tex}.pdf" "$output"
fi
