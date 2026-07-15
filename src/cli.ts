#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { compileFile } from "./compiler.js";
import { formatDiagnosticsText } from "./diagnostics.js";

function usage(): never {
  console.error("Usage: marktexset <input.md> [-o output.html] [--format text|json]");
  process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) usage();
const input = args[0];
let output: string | undefined;
let format = "text";
for (let i = 1; i < args.length; i++) {
  if (args[i] === "-o" || args[i] === "--output") output = args[++i];
  else if (args[i] === "--format") format = args[++i] ?? "";
  else usage();
}
if (!fs.existsSync(input)) { console.error("Input file does not exist: " + input); process.exit(2); }
if (format !== "text" && format !== "json") usage();
const result = compileFile(input);
if (format === "json") process.stdout.write(JSON.stringify(result.diagnostics.toJSON(), null, 2) + "\n");
else if (result.diagnostics.items.length) process.stderr.write(formatDiagnosticsText(result.diagnostics) + "\n");
if (result.diagnostics.hasErrors) process.exit(1);
if (output) fs.writeFileSync(path.resolve(output), result.html);
else if (format !== "json") process.stdout.write(result.html + "\n");
