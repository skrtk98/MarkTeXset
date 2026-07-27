import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { compileFile, type CompileResult } from "./compiler.js";
import { inspectLayout } from "./pdf.js";

interface PreviewOptions { input: string; port: number; host: string; mathInspector?: boolean; }

function json(value: unknown): string { return JSON.stringify(value); }

function clientScript(): string {
  return "(function(){var overlay,root;function show(ds){if(!ds.length){if(overlay){overlay.remove();overlay=null;root=null}return}if(!overlay){overlay=document.createElement('aside');overlay.id='marktexset-diagnostics';overlay.style='position:fixed;z-index:99999;right:0;top:0;max-width:42em;max-height:90vh;overflow:auto;background:#fff0f0;border:2px solid #c00;padding:1em;font:14px sans-serif;box-shadow:0 2px 8px #555';root=overlay.attachShadow({mode:'open'});document.body.appendChild(overlay)}root.innerHTML='<style>:host{display:block}button{float:right}div{border-top:1px solid #ccc;padding:.5em 0}</style><button id=\"marktexset-close\">×</button><h2>Diagnostics</h2>'+ds.map(function(d){return '<div style=\"color:'+(d.severity==='error'?'#a00':'#a60')+'\"><b>'+d.severity.toUpperCase()+' '+d.code+'</b><br>'+d.message+(d.location?'<br>'+d.location.file+':'+d.location.start.line+':'+d.location.start.column:'')+'</div>'}).join('');root.querySelector('#marktexset-close').onclick=function(){overlay.remove();overlay=null;root=null}}function connect(){var ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/__marktexset/ws');ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==='diagnostics')show(m.diagnostics);if(m.type==='reload'){var y=scrollY;fetch('/',{cache:'no-store'}).then(function(r){return r.text()}).then(function(t){document.open();document.write(t);document.close();scrollTo(0,y)})}};ws.onclose=function(){setTimeout(connect,500)}}fetch('/__marktexset/status',{cache:'no-store'}).then(function(r){return r.json()}).then(function(s){show(s.diagnostics||[])});connect()})();";
}

function mathInspectorScript(open: boolean): string {
  const script = String.raw`(function(){var active=false,selected=null,hovered=null,overlay,diagnostics=[];var host=document.createElement("aside");host.id="marktexset-math-inspector";var shadow=host.attachShadow({mode:"open"});document.body.appendChild(host);shadow.innerHTML="<style>:host{font:13px system-ui,sans-serif;color:#222}.toolbar{position:fixed;top:12px;left:12px;z-index:100000}.toolbar button,.panel button{font:inherit;border:1px solid #999;border-radius:4px;background:#fff;padding:.4em .7em;cursor:pointer}.toolbar button[data-on=true]{background:#165dff;color:#fff}.panel{position:fixed;top:0;right:0;bottom:0;width:min(390px,92vw);z-index:99998;background:#fff;border-left:1px solid #aaa;box-shadow:-3px 0 12px #0003;overflow:auto;display:none}.panel.open{display:block}.panel header{position:sticky;top:0;background:#f7f7f7;border-bottom:1px solid #ccc;padding:.8em;z-index:1}.panel header h2{font-size:1.05em;margin:0 0 .5em}.panel header button{float:right}.section{border-bottom:1px solid #ddd;padding:.7em}.section h3{font-size:.9em;margin:0 0 .4em}.value{white-space:pre-wrap;word-break:break-word;background:#f6f6f6;border:1px solid #ddd;border-radius:3px;padding:.5em;max-height:16em;overflow:auto}.tree,.tree ul{list-style:none;margin:0;padding-left:1em}.tree li{cursor:pointer;padding:.15em}.tree li:hover{background:#e8f0ff}.copy{float:right;font-size:.85em;padding:.2em .4em!important}.muted{color:#666}.diagnostic{padding:.3em 0;border-top:1px solid #eee}.diagnostic.error{color:#a00}.diagnostic.warning{color:#8a5800}.tabs{display:flex;gap:.25em;flex-wrap:wrap}.tabs button[aria-selected=true]{background:#165dff;color:#fff}.tab-content[hidden]{display:none}.math-overlay{position:fixed;pointer-events:none;z-index:99997;border:2px solid #165dff;background:#165dff1c;box-sizing:border-box;display:none}</style><div class="toolbar"><button id="toggle" type="button" aria-pressed="false">Math inspector: Off</button></div><section class="panel" aria-label="Math inspector"><header><button id="close" type="button" aria-label="Close">×</button><h2>Math inspector</h2><div id="summary" class="muted">Hover a formula, then click to inspect it.</div></header><div class="tabs"><button data-tab="source" aria-selected="true">Source</button><button data-tab="tex" aria-selected="true">TeX</button><button data-tab="dom" aria-selected="false">DOM</button><button data-tab="styles" aria-selected="false">Styles</button><button data-tab="computed" aria-selected="false">Computed</button><button data-tab="diagnostics" aria-selected="true">Diagnostics</button></div><div id="source" class="tab-content section"></div><div id="tex" class="tab-content section"></div><div id="dom" class="tab-content section" hidden></div><div id="styles" class="tab-content section" hidden></div><div id="computed" class="tab-content section" hidden></div><div id="diagnostics" class="tab-content section"></div></section>";var panel=shadow.querySelector(".panel"),toggle=shadow.querySelector("#toggle"),close=shadow.querySelector("#close"),summary=shadow.querySelector("#summary");overlay=document.createElement("div");overlay.className="math-overlay";document.body.appendChild(overlay);function box(id){return shadow.querySelector("#"+id)}function copy(value){if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(value);else{var a=document.createElement("textarea");a.value=value;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove()}}function addValue(parent,value){var n=document.createElement("div");n.className="value";n.textContent=value;parent.appendChild(n)}function position(node){if(!node||!node.isConnected){overlay.style.display="none";return}var r=node.getBoundingClientRect();if(!r.width&&!r.height){overlay.style.display="none";return}overlay.style.display="block";overlay.style.left=r.left+"px";overlay.style.top=r.top+"px";overlay.style.width=r.width+"px";overlay.style.height=r.height+"px"}function mathNode(target){return target&&target.closest?target.closest("[data-mathmd-math-id]"):null}function describe(node){var v=node.tagName.toLowerCase();if(node.id)v+="#"+node.id;if(node.classList&&node.classList.length)v+="."+Array.from(node.classList).join(".");return v}function domTree(node){var root=document.createElement("ul");root.className="tree";function visit(parent,current,depth){if(depth>5)return;var li=document.createElement("li");li.textContent=describe(current);li.onclick=function(e){e.stopPropagation();selected=current;render()};parent.appendChild(li);if(current.children.length){var ul=document.createElement("ul");li.appendChild(ul);Array.from(current.children).forEach(function(c){visit(ul,c,depth+1)})}}visit(root,node,0);return root}function renderDiagnostics(){var node=box("diagnostics");node.replaceChildren();if(!diagnostics.length){node.textContent="No diagnostics.";return}diagnostics.forEach(function(d){var row=document.createElement("div");row.className="diagnostic "+d.severity;row.textContent=d.severity.toUpperCase()+" "+d.code+": "+d.message;node.appendChild(row)})}function render(){if(!selected){summary.textContent="Hover a formula, then click to inspect it.";return}position(selected);summary.textContent=(selected.getAttribute("data-mathmd-math-id")||"")+" · "+(selected.getAttribute("data-mathmd-math-kind")||"math");var s=box("source");s.replaceChildren();s.appendChild(document.createElement("h3")).textContent="Source position";addValue(s,(selected.getAttribute("data-mathmd-source-file")||"document.md")+" "+(selected.getAttribute("data-mathmd-source-start")||""));var t=box("tex");t.replaceChildren();var h=document.createElement("h3");h.textContent="Original TeX";var b=document.createElement("button");b.className="copy";b.textContent="Copy";var tex=selected.getAttribute("data-mathmd-tex")||"";b.onclick=function(){copy(tex)};h.appendChild(b);t.appendChild(h);addValue(t,tex);var d=box("dom");d.replaceChildren();d.appendChild(document.createElement("h3")).textContent="Rendered DOM";d.appendChild(domTree(selected));var st=box("styles");st.replaceChildren();st.appendChild(document.createElement("h3")).textContent="Classes and inline styles";addValue(st,"class=\""+(selected.getAttribute("class")||"")+"\""+(selected.getAttribute("style")?"\nstyle=\""+selected.getAttribute("style")+"\"":""));var co=box("computed");co.replaceChildren();co.appendChild(document.createElement("h3")).textContent="Computed style";var cv=document.createElement("div");cv.className="value";var cs=getComputedStyle(selected);["display","position","width","height","margin","padding","font-size","font-family","color","background-color","border","line-height"].forEach(function(p){var row=document.createElement("div");row.textContent=p+": "+cs.getPropertyValue(p);cv.appendChild(row)});co.appendChild(cv);renderDiagnostics()}function setActive(value){active=value;toggle.setAttribute("aria-pressed",String(value));toggle.setAttribute("data-on",String(value));toggle.textContent="Math inspector: "+(value?"On":"Off");if(value)panel.classList.add("open");else{panel.classList.remove("open");overlay.style.display="none";hovered=null}}toggle.onclick=function(){setActive(!active)};close.onclick=function(){panel.classList.remove("open")};Array.from(shadow.querySelectorAll("[data-tab]")).forEach(function(tab){tab.onclick=function(){var n=tab.getAttribute("data-tab");Array.from(shadow.querySelectorAll("[data-tab]")).forEach(function(x){x.setAttribute("aria-selected",String(x===tab))});Array.from(shadow.querySelectorAll(".tab-content")).forEach(function(x){x.hidden=x.id!==n})}});document.addEventListener("pointerover",function(e){if(!active||host.contains(e.target))return;var n=mathNode(e.target);if(n){hovered=n;position(n)}});document.addEventListener("pointerout",function(e){if(!active||host.contains(e.target))return;if(!mathNode(e.relatedTarget)&&!selected)overlay.style.display="none"});document.addEventListener("click",function(e){if(!active||host.contains(e.target))return;var n=mathNode(e.target);if(n){e.preventDefault();selected=n;panel.classList.add("open");render()}});window.addEventListener("scroll",function(){position(selected||hovered)},true);window.addEventListener("resize",function(){position(selected||hovered)});window.__marktexsetSetDiagnostics=function(ds){diagnostics=Array.isArray(ds)?ds:[];renderDiagnostics()};setActive(false);if(__OPEN__)panel.classList.add("open")})()`;
  const markupStart = script.indexOf('shadow.innerHTML="') + 'shadow.innerHTML="'.length;
  const markupEnd = script.indexOf('";var panel=', markupStart);
  const markup = script.slice(markupStart, markupEnd).replace("</style>", "@media(max-width:700px){.panel{left:0;right:0;top:auto;bottom:0;width:auto;height:55vh;border-left:0;border-top:1px solid #aaa}}</style>");
  const safeMarkup = script.slice(0, markupStart - 'shadow.innerHTML="'.length) + "shadow.innerHTML=" + JSON.stringify(markup) + ";" + script.slice(markupEnd + 2);
  const withDetails = safeMarkup
    .replace('var active=false,selected=null,hovered=null,overlay,diagnostics=[]',
      'var active=false,selected=null,selectedMeta=null,hovered=null,referenceInfo="",overlay,diagnostics=[]')
    .replace('function render(){if(!selected){',
      'function render(){var meta=selectedMeta||selected;if(!selected){')
    .replaceAll('selected.getAttribute(', 'meta.getAttribute(')
    .replace('selected=current;render()', 'selected=current;selectedMeta=mathNode(current)||current;render()')
    .replace('addValue(s,(meta.getAttribute("data-mathmd-source-file")||"document.md")+" "+(meta.getAttribute("data-mathmd-source-start")||""));var t=box',
      'addValue(s,(meta.getAttribute("data-mathmd-source-file")||"document.md")+"\\nStart: "+(meta.getAttribute("data-mathmd-source-start")||"")+"\\nEnd: "+(meta.getAttribute("data-mathmd-source-end")||"")+"\\nLabel: "+(meta.getAttribute("data-mathmd-label")||"(none)")+"\\nNumbered: "+(meta.getAttribute("data-mathmd-numbered")||"false")+"\\nNumber: "+(meta.getAttribute("data-mathmd-number")||"(none)")+"\\nNotag: "+(meta.getAttribute("data-mathmd-notag")||"false")+"\\nAlignment: "+(meta.getAttribute("data-mathmd-alignment")||"[]")+"\\nReferences: "+(meta.getAttribute("data-mathmd-references")||"[]")+"\\nSettings: "+(meta.getAttribute("data-mathmd-settings")||"{}")+"\\nContext:\\n"+(meta.getAttribute("data-mathmd-source-context")||""));var t=box')
    .replace('addValue(t,tex);var d=box',
      'addValue(t,tex);var tokenBox=document.createElement("div");tokenBox.className="value";var tokenMap=[];try{tokenMap=JSON.parse(meta.getAttribute("data-mathmd-source-map")||"[]")}catch(e){}var renderedNodes=Array.from(meta.querySelectorAll("[data-mml-node]"));tokenMap.forEach(function(item,index){var token=document.createElement("span");token.textContent=item.text+" ";token.title=item.type+" ["+item.start+", "+item.end+")";token.tabIndex=0;if(renderedNodes[index]===selected)token.style.background="#ffda6a";token.onclick=function(){selected=renderedNodes[Math.min(index,Math.max(0,renderedNodes.length-1))]||meta;selectedMeta=meta;render()};tokenBox.appendChild(token)});t.appendChild(tokenBox);var d=box')
    .replace('d.appendChild(domTree(selected));var st=box',
      'd.appendChild(domTree(selected));var jsonButton=document.createElement("button");jsonButton.className="copy";jsonButton.textContent="Copy JSON";jsonButton.onclick=function(){copy(JSON.stringify({metadata:Object.fromEntries(Array.from(meta.attributes).filter(function(a){return a.name.indexOf("data-mathmd-")===0}).map(function(a){return[a.name,a.value]})),element:describe(selected),html:selected.outerHTML.slice(0,20000)},null,2))};d.querySelector("h3").appendChild(jsonButton);var st=box')
    .replace('setActive(false);if(__OPEN__)',
      'document.addEventListener("click",function(e){if(!active||host.contains(e.target))return;var mathLink=e.target.closest&&e.target.closest("a");if(mathLink&&!(mathLink.getAttribute("href")||"").startsWith("#"))mathLink=null;if(mathLink){var target=document.getElementById((mathLink.getAttribute("href")||"").slice(1));if(target){e.preventDefault();referenceInfo="Reference: "+(mathLink.textContent||"")+" → "+(mathLink.getAttribute("href")||"");selected=target;selectedMeta=mathNode(target)||target;panel.classList.add("open");render();return}}var wrapper=mathNode(e.target);var exact=e.target.closest&&e.target.closest("[data-mml-node],mjx-container,svg");if(wrapper&&exact&&exact!==wrapper){selected=exact;selectedMeta=wrapper;panel.classList.add("open");render()}});document.addEventListener("keydown",function(e){var n=mathNode(document.activeElement);if(!active||!n)return;if(e.key==="Enter"||e.key===" "){e.preventDefault();selected=n;selectedMeta=n;panel.classList.add("open");render()}if(e.key==="Escape"){selected=null;selectedMeta=null;overlay.style.display="none";render()}});setActive(false);if(__OPEN__)')
    .replace('if(!active||host.contains(e.target))return;var n=mathNode(e.target);if(n){e.preventDefault();selected=n;panel.classList.add("open");render()}});',
      'if(!active||host.contains(e.target))return;var link=e.target.closest("[data-mathmd-reference-target]");if(link){e.preventDefault();var target=document.getElementById(link.getAttribute("data-mathmd-reference-target"));if(target){referenceInfo="Reference: "+(link.textContent||"")+" → #"+link.getAttribute("data-mathmd-reference-target");selected=target;selectedMeta=mathNode(target)||target;panel.classList.add("open");render()}return}var n=mathNode(e.target);if(n){e.preventDefault();selected=n;selectedMeta=n;panel.classList.add("open");render()}});')
    .replace('summary.textContent=(meta.getAttribute("data-mathmd-math-id")||"")+" · "+(meta.getAttribute("data-mathmd-math-kind")||"math");',
      'summary.textContent=(referenceInfo?referenceInfo+" · ":"")+(meta.getAttribute("data-mathmd-math-id")||"")+" · "+(meta.getAttribute("data-mathmd-math-kind")||"math");')
  return withDetails.replace("__OPEN__", String(open));
}

function inject(html: string, inspector: boolean, openInspector: boolean): string {
  const printStyle = "<style>@media print{#marktexset-diagnostics{display:none!important}}</style>";
  const copyScript = "<script>(function(){document.querySelectorAll('.code-copy').forEach(function(b){b.style.display='inline-block';b.onclick=function(){var code=b.getAttribute('data-code')||'';var done=function(){var old=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=old},1200)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(code).then(done).catch(function(){var s=document.createElement('textarea');s.value=code;document.body.appendChild(s);s.select();document.execCommand('copy');s.remove();done()})}else{var s=document.createElement('textarea');s.value=code;document.body.appendChild(s);s.select();document.execCommand('copy');s.remove();done()}}})})()</script>";
  const script = copyScript + "<script>" + clientScript() + "</script>" + (inspector ? "<script>" + mathInspectorScript(openInspector) + "</script>" : "");
  return html.replace("</head>", printStyle + "</head>").replace("</body>", script + "</body>");
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

export async function startPreview(options: PreviewOptions): Promise<void> {
  const input = path.resolve(options.input);
  const initial = compileFile(input);
  const configuredInspector = initial.config.preview?.["math-inspector"] ?? {};
  const inspectorEnabled = options.mathInspector ?? configuredInspector.enabled !== false;
  const inspectorOpen = configuredInspector.open === true;
  let current = inspectorEnabled ? compileFile(input, { mathInspector: true }) : initial;
  const inspectCurrentLayout = async () => {
    if (current.diagnostics.hasErrors) return;
    try {
      for (const diagnostic of await inspectLayout(current, input)) current.diagnostics.warning(diagnostic.code, diagnostic.message);
    } catch (error) {
      current.diagnostics.warning("LAYOUT_INSPECTION_FAILED", "Preview layout inspection failed: " + String(error));
    }
  };
  let lastGood: string | undefined = current.diagnostics.hasErrors ? undefined : current.html;
  let revision = 0;
  let building = false;
  let pending = false;
  let timer: NodeJS.Timeout | undefined;
  let watchers: fs.FSWatcher[] = [];
  let watchedKey = "";
  let allowedAssets = new Set<string>();
  const clients = new Set<WebSocket>();
  let initialLayoutReady = false;
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
  const build = async () => {
    if (building) { pending = true; return; }
    building = true;
    broadcast({ type: "status", state: "building", revision });
    try {
      current = inspectorEnabled ? compileFile(input, { mathInspector: true }) : compileFile(input);
      await inspectCurrentLayout();
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
    response.end(inject(lastGood ?? errorPage(current), inspectorEnabled, inspectorOpen));
  });
  const socketServer = new WebSocketServer({ server, path: "/__marktexset/ws" });
  socketServer.on("connection", (client) => {
    clients.add(client);
    if (initialLayoutReady) client.send(json({ type: "diagnostics", revision, diagnostics: current.diagnostics.sorted() }));
    client.on("close", () => clients.delete(client));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const displayHost = options.host.includes(":") ? "[" + options.host + "]" : options.host;
      console.error("Preview server running at http://" + displayHost + ":" + options.port + "/");
      console.error("Watching " + input);
      void inspectCurrentLayout().then(() => {
        initialLayoutReady = true;
        broadcast({ type: "diagnostics", revision, diagnostics: current.diagnostics.sorted() });
      });
    });
    const close = () => { if (timer) clearTimeout(timer); for (const watcher of watchers) watcher.close(); socketServer.close(); server.close(() => resolve()); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}
