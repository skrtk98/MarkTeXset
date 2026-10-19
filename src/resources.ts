import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface NetworkPolicy { allow?: boolean; domains?: string[]; }
export interface RemoteDiagnostics { error: (code: string, message: string) => void; }
export type RemoteKind = "image" | "css-asset";

interface CacheEntry { sha256: string; contentType: string; fetchedAt: string; }

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
const CSS_ASSET_TYPES = new Set([...IMAGE_TYPES, "font/woff", "font/woff2", "font/otf", "font/ttf"]);

export function resourceCacheDirectory(): string {
  if (process.env.MARKTEXSET_CACHE_DIR) return path.resolve(process.env.MARKTEXSET_CACHE_DIR);
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cache, "marktexset", "resources");
}

function indexPath(directory: string): string { return path.join(directory, "index.json"); }

function readIndex(directory: string): Record<string, CacheEntry> {
  try { return JSON.parse(fs.readFileSync(indexPath(directory), "utf8")); } catch { return {}; }
}

export function resetResourceCache(directory = resourceCacheDirectory()): void {
  fs.rmSync(directory, { recursive: true, force: true });
}

/** Returns a policy error message, or undefined when the URL may be fetched. */
export function policyViolation(url: string, policy: NetworkPolicy | undefined): { code: string; message: string } | undefined {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { code: "INVALID_URL", message: "'" + url + "' is not a valid URL." }; }
  if (policy?.allow !== true) return { code: "NETWORK_DISABLED", message: "External resource '" + url + "' requires network.allow: true and an allowed domain." };
  if (parsed.protocol !== "https:") return { code: "NETWORK_INSECURE_URL", message: "External resource '" + url + "' must use HTTPS." };
  if (parsed.username || parsed.password) return { code: "INVALID_URL", message: "External resource '" + url + "' must not contain credentials." };
  const domains = (policy.domains ?? []).map((domain) => domain.toLowerCase());
  if (!domains.includes(parsed.hostname.toLowerCase())) return { code: "NETWORK_DOMAIN_NOT_ALLOWED", message: "Domain '" + parsed.hostname + "' is not listed in network.domains." };
  return undefined;
}

/** Synchronously resolves a remote resource to a data URI from the cache, recording misses for a later fetch. */
export function resolveRemoteResource(url: string, kind: RemoteKind, policy: NetworkPolicy | undefined, diagnostics: RemoteDiagnostics, pending: Set<string>, directory = resourceCacheDirectory()): string | undefined {
  const violation = policyViolation(url, policy);
  if (violation) { diagnostics.error(violation.code, violation.message); return undefined; }
  const entry = readIndex(directory)[url];
  const file = entry && path.join(directory, entry.sha256);
  if (!entry || !fs.existsSync(file!)) {
    pending.add(url);
    diagnostics.error("REMOTE_RESOURCE_UNAVAILABLE", "External resource '" + url + "' has not been fetched.");
    return undefined;
  }
  if (!(kind === "image" ? IMAGE_TYPES : CSS_ASSET_TYPES).has(entry.contentType)) {
    diagnostics.error("REMOTE_RESOURCE_TYPE", "External resource '" + url + "' has unsupported type '" + entry.contentType + "'.");
    return undefined;
  }
  return "data:" + entry.contentType + ";base64," + fs.readFileSync(file!).toString("base64");
}

function sniffType(data: Uint8Array): string | undefined {
  const head = Buffer.from(data.subarray(0, 512));
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "wOFF") return "font/woff";
  if (head.subarray(0, 4).toString("latin1") === "wOF2") return "font/woff2";
  if (head.subarray(0, 4).toString("latin1") === "OTTO") return "font/otf";
  if (head.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))) return "font/ttf";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head.toString("utf8"))) return "image/svg+xml";
  return undefined;
}

export interface FetchLike {
  (url: string, init: { redirect: "manual"; signal: AbortSignal }): Promise<{ status: number; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }>;
}

// Reads at most MAX_BYTES so an endpoint that omits or understates Content-Length cannot exhaust memory.
async function readLimited(response: Awaited<ReturnType<FetchLike>>): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel(); throw new Error("Resource exceeds " + MAX_BYTES + " bytes."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Fetches each URL under the network policy, re-checking every redirect, and stores it by content hash. */
export async function fetchRemoteResources(urls: Iterable<string>, policy: NetworkPolicy | undefined, options: { directory?: string; fetcher?: FetchLike } = {}): Promise<Array<{ url: string; error: string }>> {
  const directory = options.directory ?? resourceCacheDirectory();
  const fetcher = options.fetcher ?? (fetch as unknown as FetchLike);
  const failures: Array<{ url: string; error: string }> = [];
  for (const url of urls) {
    try {
      let current = url;
      let response: Awaited<ReturnType<FetchLike>> | undefined;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const violation = policyViolation(current, policy);
        if (violation) throw new Error(violation.message);
        response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect without a Location header.");
        if (hop === MAX_REDIRECTS) throw new Error("Too many redirects.");
        current = new URL(location, current).href;
      }
      if (!response || response.status !== 200) throw new Error("HTTP " + response?.status);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) throw new Error("Resource exceeds " + MAX_BYTES + " bytes.");
      const data = await readLimited(response);
      const contentType = sniffType(data);
      if (!contentType) throw new Error("Unrecognized resource type.");
      const sha256 = crypto.createHash("sha256").update(data).digest("hex");
      fs.mkdirSync(directory, { recursive: true });
      const target = path.join(directory, sha256);
      if (!fs.existsSync(target)) { fs.writeFileSync(target + ".tmp", data); fs.renameSync(target + ".tmp", target); }
      const index = readIndex(directory);
      index[url] = { sha256, contentType, fetchedAt: new Date().toISOString() };
      fs.writeFileSync(indexPath(directory) + ".tmp", JSON.stringify(index, null, 2));
      fs.renameSync(indexPath(directory) + ".tmp", indexPath(directory));
    } catch (error) {
      failures.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}
