import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { compileFile, type CompileResult } from "./compiler.js";

interface PreviewOptions { input: string; port: number; host: string; }

function json(value: unknown): string { return JSON.stringify(value); }

function clientScript(): string {
  return "(function(){var overlay;function show(ds){if(!overlay){overlay=document.createElement('aside');overlay.id='marktexset-diagnostics';overlay.style='position:fixed;z-index:99999;right:0;top:0;max-width:42em;max-height:90vh;overflow:auto;background:#fff0f0;border:2px solid #c00;padding:1em;font:14px sans-serif;box-shadow:0 2px 8px #555';document.body.appendChild(overlay)}overlay.innerHTML='<button id=\"marktexset-close\" style=\"float:right\">×</button><h2>Diagnostics</h2>'+ds.map(function(d){return '<div style=\"border-top:1px solid #ccc;padding:.5em 0;color:'+(d.severity==='error'?'#a00':'#a60')+'\"><b>'+d.severity.toUpperCase()+' '+d.code+'</b><br>'+d.message+(d.location?'<br>'+d.location.file+':'+d.location.start.line+':'+d.location.start.column:'')+'</div>'}).join('');document.getElementById('marktexset-close').onclick=function(){overlay.remove();overlay=null}}function connect(){var ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/__marktexset/ws');ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==='diagnostics')show(m.diagnostics);if(m.type==='reload'){var y=scrollY;fetch('/',{cache:'no-store'}).then(function(r){return r.text()}).then(function(t){document.open();document.write(t);document.close();scrollTo(0,y)})}};ws.onclose=function(){setTimeout(connect,500)}}fetch('/__marktexset/status',{cache:'no-store'}).then(function(r){return r.json()}).then(function(s){if(s.diagnostics&&s.diagnostics.length)show(s.diagnostics)});connect()})();";
}

function inject(html: string): string {
  const script = "<script>" + clientScript() + "</script>";
  return html.replace("</body>", script + "</body>");
}

function errorPage(result: CompileResult): string {
  const diagnostics = result.diagnostics.toJSON().diagnostics;
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>MarkTeXset diagnostics</title></head><body><h1>MarkTeXset preview</h1><p>Initial compilation failed. Fix the document and save again.</p><script>window.__marktexsetDiagnostics=" + json(diagnostics) + ";</script></body></html>";
}

function dependencies(input: string): string[] {
  const source = fs.readFileSync(input, "utf8");
  const result = new Set<string>([input]);
  const add = (value: string) => {
    if (value.startsWith("http:") || value.startsWith("https:") || path.isAbsolute(value) && !fs.existsSync(value)) return;
    const resolved = path.resolve(path.dirname(input), value);
    if (fs.existsSync(resolved)) result.add(resolved);
  };
  for (const match of source.matchAll(/(?:import|bibliography):\s*[-]?\s*["']?([^\s"']+)["']?/g)) add(match[1]);
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) add(match[1]);
  return [...result];
}

export function startPreview(options: PreviewOptions): Promise<void> {
  const input = path.resolve(options.input);
  let current = compileFile(input);
  let lastGood: string | undefined = current.diagnostics.hasErrors ? undefined : current.html;
  let revision = 0;
  let building = false;
  let pending = false;
  let timer: NodeJS.Timeout | undefined;
  let watchers: fs.FSWatcher[] = [];
  let watchedKey = "";
  let allowedAssets = new Set<string>();
  const clients = new Set<WebSocket>();
  const broadcast = (message: unknown) => { const data = json(message); for (const client of clients) if (client.readyState === 1) client.send(data); };
  const refreshWatchers = () => {
    const files = dependencies(input);
    const key = files.join("\0");
    if (key === watchedKey) return;
    for (const watcher of watchers) watcher.close();
    watchedKey = key;
    allowedAssets = new Set(files.filter((file) => file !== input));
    watchers = files.map((file) => fs.watch(file, (eventType) => { if (eventType === "rename") watchedKey = ""; schedule(); }));
  };
  const build = () => {
    if (building) { pending = true; return; }
    building = true;
    broadcast({ type: "status", state: "building", revision });
    try {
      current = compileFile(input);
      revision++;
      if (!current.diagnostics.hasErrors) lastGood = current.html;
      refreshWatchers();
      broadcast({ type: "diagnostics", revision, diagnostics: current.diagnostics.sorted() });
      broadcast({ type: "status", state: current.diagnostics.hasErrors ? "error" : "ready", revision });
      if (!current.diagnostics.hasErrors) broadcast({ type: "reload", revision });
    } finally {
      building = false;
      if (pending) { pending = false; schedule(); }
    }
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(build, 100); };
  refreshWatchers();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/__marktexset/status") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(json({ revision, diagnostics: current.diagnostics.sorted(), state: current.diagnostics.hasErrors ? "error" : "ready" }));
      return;
    }
    if (url.pathname !== "/") {
      if (url.pathname.startsWith("/__marktexset/")) { response.writeHead(404); response.end("Not found"); return; }
      let asset: string;
      try { asset = path.resolve(path.dirname(input), decodeURIComponent(url.pathname.slice(1))); }
      catch { response.writeHead(400); response.end("Bad request"); return; }
      if (!allowedAssets.has(asset)) { response.writeHead(404); response.end("Not found"); return; }
      const contentType = asset.endsWith(".svg") ? "image/svg+xml" : asset.endsWith(".png") ? "image/png" : asset.endsWith(".jpg") || asset.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" });
      response.end(fs.readFileSync(asset));
      return;
    }
    response.writeHead(current.diagnostics.hasErrors && !lastGood ? 200 : 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(inject(lastGood ?? errorPage(current)));
  });
  const socketServer = new WebSocketServer({ server, path: "/__marktexset/ws" });
  socketServer.on("connection", (client) => { clients.add(client); client.send(json({ type: "diagnostics", revision, diagnostics: current.diagnostics.sorted() })); client.on("close", () => clients.delete(client)); });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const displayHost = options.host.includes(":") ? "[" + options.host + "]" : options.host;
      console.error("Preview server running at http://" + displayHost + ":" + options.port + "/");
      console.error("Watching " + input);
    });
    const close = () => { if (timer) clearTimeout(timer); for (const watcher of watchers) watcher.close(); socketServer.close(); server.close(() => resolve()); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}
