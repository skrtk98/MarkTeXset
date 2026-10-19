import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compile, compileFileWithResources } from "../src/compiler.js";
import { fetchRemoteResources, type FetchLike } from "../src/resources.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const allow = (domains: string[]) => "---\nmathmd:\n  network:\n    allow: true\n    domains: [" + domains.map((domain) => JSON.stringify(domain)).join(", ") + "]\n---\n\n";
const reply = (status: number, body: Uint8Array | string = "", headers: Record<string, string> = {}) => ({ status, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, arrayBuffer: async () => Uint8Array.from(typeof body === "string" ? new TextEncoder().encode(body) : body).buffer as ArrayBuffer });

function withCache<T>(action: (directory: string) => Promise<T> | T): Promise<T> {
  const previous = process.env.MARKTEXSET_CACHE_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-resources-"));
  process.env.MARKTEXSET_CACHE_DIR = directory;
  return Promise.resolve(action(directory)).finally(() => { if (previous === undefined) delete process.env.MARKTEXSET_CACHE_DIR; else process.env.MARKTEXSET_CACHE_DIR = previous; });
}

const codes = (source: string) => compile(source).diagnostics.items.map((item) => item.code);

test("rejects external resources unless the network policy allows the exact HTTPS domain", () => withCache(() => {
  assert.ok(codes("![a](https://img.example/a.png)\n").includes("NETWORK_DISABLED"));
  assert.ok(codes(allow(["img.example"]) + "![a](http://img.example/a.png)\n").includes("NETWORK_INSECURE_URL"));
  assert.ok(codes(allow(["img.example"]) + "![a](https://cdn.img.example/a.png)\n").includes("NETWORK_DOMAIN_NOT_ALLOWED"));
  const pending = compile(allow(["img.example"]) + "![a](https://img.example/a.png)\n");
  assert.deepEqual(pending.pendingResources, ["https://img.example/a.png"]);
  assert.ok(pending.diagnostics.items.some((item) => item.code === "REMOTE_RESOURCE_UNAVAILABLE"));
}));

test("fetches, verifies, and caches remote images by content hash", () => withCache(async (directory) => {
  const fetcher: FetchLike = async () => reply(200, PNG);
  assert.deepEqual(await fetchRemoteResources(["https://img.example/a.png"], { allow: true, domains: ["img.example"] }, { fetcher }), []);
  const index = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
  assert.equal(index["https://img.example/a.png"].contentType, "image/png");
  assert.ok(fs.existsSync(path.join(directory, index["https://img.example/a.png"].sha256)));
  const result = compile(allow(["img.example"]) + "![a](https://img.example/a.png)\n");
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.html, /<img src="data:image\/png;base64,/);
  assert.deepEqual(result.pendingResources, []);
}));

test("re-checks redirects and rejects unrecognized content", () => withCache(async () => {
  const policy = { allow: true, domains: ["img.example"] };
  const redirect: FetchLike = async (url) => url.includes("img.example") ? reply(302, "", { location: "https://evil.example/a.png" }) : reply(200, PNG);
  const [redirected] = await fetchRemoteResources(["https://img.example/a.png"], policy, { fetcher: redirect });
  assert.match(redirected.error, /evil\.example/);
  const [html] = await fetchRemoteResources(["https://img.example/page"], policy, { fetcher: async () => reply(200, "<html>not an image</html>") });
  assert.match(html.error, /Unrecognized/);
  const [missing] = await fetchRemoteResources(["https://img.example/none.png"], policy, { fetcher: async () => reply(404) });
  assert.match(missing.error, /HTTP 404/);
}));

test("compileFileWithResources fetches once, then builds from the cache", () => withCache(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marktexset-remote-doc-"));
  const input = path.join(directory, "document.md");
  fs.writeFileSync(path.join(directory, "remote.css"), ".x { background: url(\"https://img.example/bg.png\"); }\n");
  fs.writeFileSync(input, "---\nmathmd:\n  style:\n    import: [\"remote.css\"]\n  network:\n    allow: true\n    domains: [\"img.example\"]\n---\n\n![a](https://img.example/a.png)\n\n![b](https://img.example/broken.png)\n");
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => { requests.push(url); return url.endsWith("broken.png") ? reply(500) : reply(200, PNG); }) as unknown as typeof fetch;
  try {
    const first = await compileFileWithResources(input);
    assert.deepEqual(requests.sort(), ["https://img.example/a.png", "https://img.example/bg.png", "https://img.example/broken.png"]);
    const failed = first.diagnostics.items.find((item) => item.code === "REMOTE_RESOURCE_FAILED");
    assert.match(failed?.message ?? "", /broken\.png' could not be fetched: HTTP 500/);
    assert.match(first.html, /url\("data:image\/png;base64,/);
    requests.length = 0;
    fs.writeFileSync(input, fs.readFileSync(input, "utf8").replace("\n\n![b](https://img.example/broken.png)\n", "\n"));
    const second = await compileFileWithResources(input);
    assert.deepEqual(requests, [], "cached resources are not fetched again");
    assert.equal(second.diagnostics.hasErrors, false);
    await compileFileWithResources(input, { resetCache: true });
    assert.equal(requests.length, 2, "--reset-cache fetches again");
  } finally {
    globalThis.fetch = original;
  }
}));
