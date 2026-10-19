// Builds quality samples with MarkTeXset (and optionally the TeX baseline) and compares layout metrics.
// Usage: npm run quality -- [--baseline] [--out quality-report] [input.md ...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { compileFileWithResources } from "../src/compiler.js";
import { renderPdf } from "../src/pdf.js";
import { analyzePdf, formatReports, type QualityReport } from "../src/quality.js";

const args = process.argv.slice(2);
const baseline = args.includes("--baseline");
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "quality-report");
const inputs = args.filter((arg, index) => !arg.startsWith("--") && !(outIndex >= 0 && index === outIndex + 1));
const files = (inputs.length ? inputs : fs.readdirSync("examples/quality").filter((name) => name.endsWith(".md")).map((name) => path.join("examples/quality", name))).map((file) => path.resolve(file));

fs.mkdirSync(out, { recursive: true });
const sections: string[] = [];
const results: Record<string, Record<string, QualityReport>> = {};
for (const file of files) {
  const name = path.basename(file, ".md");
  const language = fs.readFileSync(file, "utf8").match(/^\s*language:\s*(\w+)/m)?.[1] === "ja" ? "ja" : "en";
  const result = await compileFileWithResources(file);
  if (result.diagnostics.hasErrors) throw new Error(name + " has compile errors");
  const pdf = path.join(out, name + ".marktexset.pdf");
  await renderPdf(result, pdf, file);
  const reports = [{ name: "MarkTeXset", report: analyzePdf(pdf) }];
  if (baseline) {
    const texPdf = path.join(out, name + ".baseline.pdf");
    execFileSync("docker", ["run", "--rm", "-u", process.getuid!() + ":" + process.getgid!(), "-v", path.dirname(file) + ":/in:ro", "-v", out + ":/out", "marktexset-baseline", "/in/" + path.basename(file), "/out/" + path.basename(texPdf), language], { stdio: "inherit" });
    reports.push({ name: "TeX baseline", report: analyzePdf(texPdf) });
  }
  results[name] = Object.fromEntries(reports.map((item) => [item.name, item.report]));
  sections.push("## " + name + " (" + language + ")\n\n" + formatReports(reports));
}
const report = "# Typesetting quality report\n\n" + sections.join("\n");
fs.writeFileSync(path.join(out, "report.md"), report);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(results, null, 2) + "\n");
process.stdout.write(report);
