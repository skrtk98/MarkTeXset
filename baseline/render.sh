#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "Usage: mathmd-baseline INPUT.md OUTPUT.pdf [en|ja] [article|report|book]" >&2
  exit 2
fi

input=$1
output=$2
language=${3:-en}
class=${4:-article}
if [[ "$class" != "article" && "$class" != "report" && "$class" != "book" ]]; then
  echo "class must be article, report, or book" >&2
  exit 2
fi
division=()
if [[ "$class" != "article" ]]; then
  division=(--top-level-division=chapter)
fi
if [[ "$language" == "ja" ]]; then
  class=ltjs$class
elif [[ "$language" != "en" ]]; then
  echo "language must be en or ja" >&2
  exit 2
fi

output=$(realpath -m "$output")
tex=${output%.pdf}.tex
# Resolve images relative to the Markdown file, as MarkTeXset does.
cd "$(dirname "$input")"
input=$(basename "$input")
pandoc "$input" --from markdown --to latex --standalone --number-sections --output "$tex" -V documentclass="$class" "${division[@]}"
if ! lualatex -interaction=nonstopmode -halt-on-error -output-directory "$(dirname "$output")" "$tex" >/dev/null; then
  tail -n 40 "${tex%.tex}.log" >&2
  exit 1
fi
if [[ "${tex%.tex}.pdf" != "$output" ]]; then
  mv "${tex%.tex}.pdf" "$output"
fi
