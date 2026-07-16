#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { compileFile } from "./compiler.js";
import { formatDiagnosticsText } from "./diagnostics.js";
import { startPreview } from "./preview.js";

function usage(message?: string): never {
  if (message) console.error("CLI error: " + message);
  console.error("Usage: marktexset <preview|build|init> ...");
  process.exit(2);
}

function parseOutput(args: string[]): { output?: string; format: string; force: boolean } {
  let output: string | undefined;
  let format = "html";
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") output = args[++i] ?? usage("Missing output path.");
    else if (args[i] === "--format") format = args[++i] ?? "";
    else if (args[i] === "--force") force = true;
    else usage("Unknown option '" + args[i] + "'.");
  }
  if (format !== "html" && format !== "json") usage("Unsupported format '" + format + "'.");
  return { output, format, force };
}

function requireMarkdownInput(input: string): string {
  if (path.extname(input) !== ".md") usage("Input must have the lowercase .md extension.");
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) usage("Input file does not exist: " + input);
  return path.resolve(input);
}

function report(result: ReturnType<typeof compileFile>, format: string): void {
  if (format === "json") process.stdout.write(JSON.stringify(result.diagnostics.toJSON(), null, 2) + "\n");
  else if (result.diagnostics.items.length) process.stderr.write(formatDiagnosticsText(result.diagnostics) + "\n");
}

function build(args: string[]): void {
  if (!args.length) usage("build requires an input Markdown file.");
  const input = requireMarkdownInput(args[0]);
  const options = parseOutput(args.slice(1));
  const output = path.resolve(options.output ?? input.slice(0, -3) + ".html");
  if (!fs.existsSync(path.dirname(output))) usage("Output directory does not exist: " + path.dirname(output));
  if (fs.existsSync(output) && !options.force) usage("Output file exists; use --force to overwrite: " + output);
  const result = compileFile(input);
  report(result, options.format);
  if (result.diagnostics.hasErrors) process.exit(1);
  fs.writeFileSync(output, result.html, "utf8");
  if (options.format !== "json") console.error("Wrote " + output);
}

function init(args: string[]): void {
  if (!args.length) usage("init requires a target path.");
  let target = args[0];
  const options = { language: "en", force: false };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--language") options.language = args[++i] ?? usage("Missing language.");
    else if (args[i] === "--force") options.force = true;
    else usage("Unknown option '" + args[i] + "'.");
  }
  if (options.language !== "en" && options.language !== "ja") usage("Only en and ja are supported.");
  const extension = path.extname(target);
  if (!extension) target += ".md";
  else if (extension !== ".md") usage("init target must have the lowercase .md extension.");
  const output = path.resolve(target);
  if (!fs.existsSync(path.dirname(output))) usage("Parent directory does not exist: " + path.dirname(output));
  if (fs.existsSync(output) && !options.force) usage("File exists; use --force to overwrite: " + output);
  const title = options.language === "ja" ? "無題の文書" : "Untitled document";
  const content = "---\nmathmd:\n  meta:\n    language: " + options.language + "\n    title: \"" + title + "\"\n    author: []\n    date: null\n---\n";
  fs.writeFileSync(output, content, "utf8");
  console.error("Created " + output);
}

function preview(args: string[]): void {
  if (!args.length) usage("preview requires an input Markdown file.");
  const input = requireMarkdownInput(args[0]);
  let port = 3000;
  let host = "127.0.0.1";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "-p" || args[i] === "--port") port = Number(args[++i]);
    else if (args[i] === "--host") host = args[++i] ?? usage("Missing host.");
    else usage("Unknown option '" + args[i] + "'.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) usage("Port must be an integer from 1 to 65535.");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") console.error("Warning: preview is accessible from clients that can reach " + host + ".");
  startPreview({ input, port, host }).catch((error) => { console.error("Preview server error: " + error.message); process.exit(1); });
}

export function main(argv = process.argv.slice(2)): void {
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") usage();
  const command = argv[0];
  if (command === "build") build(argv.slice(1));
  else if (command === "init") init(argv.slice(1));
  else if (command === "preview") preview(argv.slice(1));
  else usage("Unknown command '" + command + "'.");
}

if (import.meta.url === "file://" + process.argv[1]) main();
