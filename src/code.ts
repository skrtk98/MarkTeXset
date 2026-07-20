import { createHighlighterCoreSync, createJavaScriptRegexEngine } from "shiki";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import typescript from "shiki/langs/typescript.mjs";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";
import bash from "shiki/langs/bash.mjs";
import java from "shiki/langs/java.mjs";
import cpp from "shiki/langs/cpp.mjs";
import go from "shiki/langs/go.mjs";
import rust from "shiki/langs/rust.mjs";
import sql from "shiki/langs/sql.mjs";
import yaml from "shiki/langs/yaml.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import toml from "shiki/langs/toml.mjs";
import docker from "shiki/langs/docker.mjs";
import php from "shiki/langs/php.mjs";
import ruby from "shiki/langs/ruby.mjs";
import githubLight from "shiki/themes/github-light.mjs";

const highlighter = createHighlighterCoreSync({
  themes: [githubLight],
  langs: [javascript, json, markdown, python, typescript, css, html, bash, java, cpp, go, rust, sql, yaml, shellscript, toml, docker, php, ruby],
  engine: createJavaScriptRegexEngine(),
});

const LANGUAGES: Record<string, string> = {
  js: "javascript", jsx: "javascript", javascript: "javascript",
  ts: "typescript", tsx: "typescript", typescript: "typescript",
  py: "python", python: "python", json: "json", md: "markdown", markdown: "markdown",
  css: "css", html: "html", xml: "html",
  sh: "bash", bash: "bash", shell: "shellscript", shellscript: "shellscript",
  java: "java", c: "cpp", cpp: "cpp", "c++": "cpp", go: "go", golang: "go", rust: "rust", rs: "rust",
  sql: "sql", yml: "yaml", yaml: "yaml", toml: "toml", dockerfile: "docker", docker: "docker",
  php: "php", rb: "ruby", ruby: "ruby",
};
const SUPPORTED = new Set(Object.values(LANGUAGES));

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function tokenClass(content: string, style: string): string {
  const value = content.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  if (/^\s*(?:\/\/|#|\/\*|\*)/.test(value)) return "token-comment";
  if (/^\s*["'`]/.test(value)) return "token-string";
  if (/^\s*(?:\d+(?:\.\d+)?)\s*$/.test(value)) return "token-number";
  if (/\b(?:const|let|var|function|return|if|else|for|while|class|import|from|export|def|async|await|new|type|interface)\b/.test(value)) return "token-keyword";
  if (/^\s*[{}()[\],.;]\s*$/.test(value)) return "token-punctuation";
  if (/^\s*(?:===?|!==?|=>|[+*/%<>-])\s*$/.test(value)) return "token-operator";
  if (/^[A-Z][A-Za-z0-9_$]*$/.test(value.trim())) return "token-type";
  if (/^#[0-9A-Fa-f]{6}$/.test(style)) return "token-variable";
  return "token-function";
}

function decorateTokens(html: string): string {
  return html.replace(/<span style="color:([^"]+)">([\s\S]*?)<\/span>/g, (_match, color: string, content: string) => {
    const semantic = /\b(?:const|let|var|function|return|class|import|export|def|async|await)\b/.test(content) ? "token-keyword" : tokenClass(content, color);
    return "<span class=\"" + semantic + "\" style=\"color:" + color + "\">" + content + "</span>";
  });
}

export interface CodeFence { language: string; filename: string; body: string; }

export function parseCodeInfo(info: string): { language: string; filename: string } {
  const separator = info.indexOf(":");
  if (separator < 0) return { language: info.trim(), filename: "" };
  return { language: info.slice(0, separator).trim(), filename: info.slice(separator + 1).trim() };
}

export function renderCodeFence(fence: CodeFence, diagnostics: { warning: (code: string, message: string) => void }, requestedTheme = "github-light"): string {
  const requested = fence.language.trim();
  const normalized = LANGUAGES[requested.toLowerCase()] ?? requested.toLowerCase();
  const unknown = Boolean(requested) && !SUPPORTED.has(normalized);
  if (unknown) diagnostics.warning("UNKNOWN_CODE_LANGUAGE", "Unknown code language '" + requested + "'; using plain text.");
  const theme = requestedTheme === "github-light" ? requestedTheme : (diagnostics.warning("UNKNOWN_CODE_THEME", "Unknown code theme '" + requestedTheme + "'; using github-light."), "github-light");
  const content = unknown || !requested ? escapeHtml(fence.body) : decorateTokens(highlighter.codeToHtml(fence.body, { lang: normalized, theme }));
  const header = fence.filename || requested ? "<div class=\"code-header\"><span class=\"code-filename\">" + escapeHtml(fence.filename) + "</span><span class=\"code-language\">" + escapeHtml(requested ? normalized : "") + "</span><button class=\"code-copy\" type=\"button\" data-code=\"" + escapeHtml(fence.body) + "\" aria-label=\"Copy code\">Copy</button></div>" : "";
  const codeClass = requested ? " class=\"language-" + escapeHtml(requested.toLowerCase()) + "\"" : "";
  return "<div class=\"code-block\">" + header + "<div class=\"code-content\"><pre><code" + codeClass + ">" + content.replace(/^<pre[^>]*><code>/, "").replace(/<\/code><\/pre>\s*$/, "") + "</code></pre></div></div>";
}
