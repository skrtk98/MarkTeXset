import { renderMath } from "./math.js";

const ARROWS: Record<string, string> = {
  r: "→", l: "←", u: "↑", d: "↓",
  dr: "↘", dl: "↙", ur: "↗", ul: "↖",
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function renderCell(source: string): string {
  const arrows: string[] = [];
  const content = source.replace(/\\arrow\s*\[([^\]]+)\]/g, (_match, direction: string) => {
    for (const value of direction.split(/[;,\s]+/).filter(Boolean)) arrows.push(ARROWS[value.replace(/[^a-z]/gi, "")] ?? "→");
    return "";
  }).trim();
  let rendered = content ? renderMath(content, true).html : "";
  if (arrows.length) rendered += "<span class=\"tikzcd-arrows\" aria-hidden=\"true\">" + arrows.map(escapeHtml).join(" ") + "</span>";
  return rendered;
}

export function renderTikzCd(source: string): string {
  const rows = source.split(/\\\\\s*(?:\r?\n|$)|\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (!rows.length) return "<div class=\"tikzcd math-error\">[empty tikzcd]</div>";
  const cells = rows.map((row) => row.split("&").map(renderCell));
  const width = Math.max(...cells.map((row) => row.length));
  const body = cells.map((row) => "<tr>" + Array.from({ length: width }, (_, index) => "<td>" + (row[index] ?? "") + "</td>").join("") + "</tr>").join("");
  return "<div class=\"tikzcd\"><table class=\"tikzcd-table\"><tbody>" + body + "</tbody></table></div>";
}
