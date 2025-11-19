import { app, BrowserWindow, ipcMain, dialog } from 'electron';
 import path from 'node:path';
 import fs from 'node:fs';
 
 const createWindow = async () => {
  const preloadPath = app.isPackaged
    ? path.join(__dirname, '../electron/preload.cjs')
    : path.join(__dirname, '../preload/preload.cjs');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: preloadPath
    }
  });
  if (!app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
 };
 
 // Ensure single instance to avoid multiple windows during dev restarts
 const gotLock = app.requestSingleInstanceLock();
 if (!gotLock) {
  app.quit();
 } else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
 }
 
 app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
 });
 
// Open an existing project directory and read manifest, diagram, and audio files
ipcMain.handle('dialog:openProject', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Project Folder',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths || filePaths.length === 0) return { ok: false };
  const projDir = filePaths[0];
  try {
    const manifestPath = path.join(projDir, 'manifest.json');
    const bpmnPath = path.join(projDir, 'diagram.bpmn');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(bpmnPath)) {
      return { ok: false };
    }
    const manifest = fs.readFileSync(manifestPath, 'utf-8');
    const bpmn = fs.readFileSync(bpmnPath, 'utf-8');
    const audioDir = path.join(projDir, 'audio');
    let audios: { name: string; bytes: number[] }[] = [];
    if (fs.existsSync(audioDir) && fs.statSync(audioDir).isDirectory()) {
      const files = fs.readdirSync(audioDir);
      audios = files.map((name) => {
        const buf = fs.readFileSync(path.join(audioDir, name));
        return { name, bytes: Array.from(Uint8Array.from(buf)) };
      });
    }
    return { ok: true, manifest, bpmn, audios };
  } catch (e) {
    return { ok: false };
  }
});

 ipcMain.handle('dialog:saveProject', async (event, data: { manifest: string; bpmn: string; audios: { name: string; bytes: number[] }[] }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Project As',
    defaultPath: 'process-project.zip',
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (canceled || !filePath) return { ok: false };
  const dir = path.dirname(filePath);
  const projDir = path.join(dir, path.basename(filePath, path.extname(filePath)));
  fs.mkdirSync(path.join(projDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(projDir, 'manifest.json'), data.manifest);
  fs.writeFileSync(path.join(projDir, 'diagram.bpmn'), data.bpmn);
  for (const a of data.audios) {
    fs.writeFileSync(path.join(projDir, 'audio', a.name), Buffer.from(a.bytes));
  }
  return { ok: true, path: projDir };
 });

 // Export a single-file standalone HTML player with interactive gateway branching
 ipcMain.handle('dialog:exportStandalone', async (event, data: { manifest: string; bpmn: string; audios: { name: string; bytes: number[] }[] }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Standalone Player',
    defaultPath: 'process-player.html',
    properties: ['showOverwriteConfirmation']
  });
  if (canceled || !filePath) return { ok: false };
  try {
    // Resolve bpmn-js viewer bundle and CSS assets
    let viewerPath = '' as string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      viewerPath = require.resolve('bpmn-js/dist/bpmn-viewer.production.min.js');
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      viewerPath = require.resolve('bpmn-js/dist/bpmn-viewer.development.js');
    }
    const diagramCssPath = require.resolve('bpmn-js/dist/assets/diagram-js.css');
    const bpmnCssPath = require.resolve('bpmn-js/dist/assets/bpmn-js.css');
    const fontCssPath = require.resolve('bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css');
    const viewerJs = fs.readFileSync(viewerPath, 'utf-8');
    const cssDiagram = fs.readFileSync(diagramCssPath, 'utf-8');
    const cssBpmn = fs.readFileSync(bpmnCssPath, 'utf-8');
    const cssFont = fs.readFileSync(fontCssPath, 'utf-8');

    // Build audio map (stepId -> data URI)
    let manifestObj: any; try { manifestObj = JSON.parse(data.manifest); } catch { manifestObj = { steps: [] }; }
    const byName: Record<string, string> = {};
    for (const a of data.audios || []) {
      const b = Buffer.from(Uint8Array.from(a.bytes));
      byName[a.name] = `data:audio/webm;base64,${b.toString('base64')}`;
    }
    const audioMap: Record<string, string> = {};
    for (const s of manifestObj.steps || []) {
      const fname = s.audioFile || `${s.id}.webm`;
      if (byName[fname]) audioMap[s.id] = byName[fname];
    }

    const payload = {
      xml: data.bpmn,
      manifest: manifestObj,
      audioMap
    };
    const payloadJson = JSON.stringify(payload).replace(/<\//g, '<\\/');

    const customCss = `
/* Inline BPMN styles */
${cssDiagram}
${cssBpmn}
${cssFont}
/* Current step highlight */
.djs-element.current .djs-visual > :nth-child(1) { stroke: #1976d2 !important; stroke-width: 8px !important; fill: rgba(25,118,210,0.12) !important; }
`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Process Player</title>
  <style>${customCss}</style>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
    .wrap { display: flex; height: 100vh; }
    .sidebar { width: 320px; border-right: 1px solid #ddd; padding: 12px; overflow: auto; }
    .canvas { flex: 1; position: relative; }
    .toolbar { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; background: rgba(255,255,255,0.9); border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; }
    .step { padding: 6px; }
    .step.current { background: #eef; }
    button { cursor: pointer; }
    #popup { position: absolute; left: 16px; right: 16px; bottom: 16px; padding: 12px 14px; background: rgba(255,255,255,0.95); border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,0.12); max-height: 40%; overflow: auto; display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="sidebar">
      <div id="choices" style="margin-bottom:12px;"></div>
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <button id="next">Next Step</button>
        <button id="run">Run Continuous</button>
      </div>
      <div id="list"></div>
    </div>
    <div class="canvas">
      <div id="viewer" style="width:100%;height:100%"></div>
      <div class="toolbar">
        <button id="zoomOut">-</button>
        <button id="zoomReset">100%</button>
        <button id="zoomIn">+</button>
        <button id="zoomFit">Fit</button>
      </div>
      <div id="popup"></div>
    </div>
  </div>
  <script>${viewerJs}</script>
  <script id="payload" type="application/json">${payloadJson}</script>
  <script>
  (function(){
    const data = JSON.parse(document.getElementById('payload').textContent);
    const BpmnJS = window.BpmnJS || window.BpmnJS && window.BpmnJS.default || window.BpmnViewer || window.bpmnjs || window.bpmnJS || window.Bpmn;
    const viewer = new BpmnJS({ container: '#viewer' });
    const canvas = function(){ return viewer.get('canvas'); };
    const elementRegistry = function(){ return viewer.get('elementRegistry'); };
    function zoomValue(){ try { return canvas().zoom(); } catch(e){ return 1; } }
    function setZoom(z){ try { canvas().zoom(z); } catch(e){} }
    document.getElementById('zoomIn').onclick = function(){ var z=zoomValue(); setZoom(Math.min(z*1.2,3)); };
    document.getElementById('zoomOut').onclick = function(){ var z=zoomValue(); setZoom(Math.max(z/1.2,0.2)); };
    document.getElementById('zoomReset').onclick = function(){ setZoom(1); };
    document.getElementById('zoomFit').onclick = function(){ try { canvas().zoom('fit-viewport'); } catch(e){} };

    var current = -1; var audio = null;
    function renderList(){
      var list = document.getElementById('list');
      list.innerHTML = '';
      (data.manifest.steps||[]).forEach(function(s, i){
        var d = document.createElement('div'); d.className = 'step'+(i===current?' current':''); d.textContent = (i+1)+'. '+(s.label||s.id);
        list.appendChild(d);
      });
    }
    function clearMarker(s){ try { canvas().removeMarker(s.bpmnElementId,'current'); } catch(e){} }
    function addMarker(s){ try { canvas().addMarker(s.bpmnElementId,'current'); canvas().zoom('fit-viewport'); } catch(e){} }

    function computeChoices(){
      var steps = data.manifest.steps||[];
      if(current < 0 || current >= steps.length) return [];
      var cur = steps[current];
      var el = elementRegistry().get(cur.bpmnElementId);
      var t = el && (el.type || (el.businessObject && el.businessObject.$type)) || '';
      var isGw = /Gateway$/.test(String(t));
      if(!isGw) return [];
      var outgoing = (el.businessObject && el.businessObject.outgoing) || [];
      function reachable(startId){
        var vis = {}; var q = [startId];
        while(q.length){
          var id = q.shift(); if(vis[id]) continue; vis[id]=true;
          var node = elementRegistry().get(id);
          var outs = (node && node.businessObject && node.businessObject.outgoing) || [];
          outs.forEach(function(f){ if(f && f.targetRef && f.targetRef.id) q.push(f.targetRef.id); });
        }
        return vis;
      }
      var opts = [];
      outgoing.forEach(function(flow){
        var target = flow && flow.targetRef; if(!target || !target.id) return;
        var reach = reachable(target.id);
        var to = -1;
        for(var j=current+1;j<steps.length;j++){ if(reach[steps[j].bpmnElementId]){ to=j; break; } }
        if(to>=0) opts.push({ label: target.name || target.id, to: to });
      });
      return opts;
    }

    function computeNextIndex(){
      var steps = data.manifest.steps||[];
      if(current < 0 || current >= steps.length) return -1;
      var cur = steps[current];
      var el = elementRegistry().get(cur.bpmnElementId);
      if(!el) return -1;
      var t = el.type || (el.businessObject && el.businessObject.$type) || '';
      if(/Gateway$/.test(String(t))) return -1; // choices UI handles gateways
      var vis = {}; var hasEnd = false; var q = [];
      var outs = (el.businessObject && el.businessObject.outgoing) || [];
      outs.forEach(function(f){ if(f && f.targetRef) q.push(f.targetRef); });
      while(q.length){
        var n = q.shift(); if(!n || !n.id || vis[n.id]) continue; vis[n.id]=true;
        var ty = n.$type || n.type || '';
        if(/EndEvent$/.test(String(ty))) hasEnd = true;
        var o = n.outgoing || [];
        o.forEach(function(f){ if(f && f.targetRef) q.push(f.targetRef); });
      }
      for(var j=current+1;j<steps.length;j++){
        if(vis[steps[j].bpmnElementId]){
          if(typeof running !== 'undefined' && running && typeof runVisited !== 'undefined' && runVisited[j]) continue;
          return j;
        }
      }
      // Fallback: allow wrap-around (manifest order may not match graph path)
      for(var j2=0;j2<steps.length;j2++){
        if(j2!==current && vis[steps[j2].bpmnElementId]){
          if(typeof running !== 'undefined' && running && typeof runVisited !== 'undefined' && runVisited[j2]) continue;
          return j2;
        }
      }
      return hasEnd ? -2 : -1;
    }

    var choiceResolve = null;
    function showChoices(){
      var ctn = document.getElementById('choices');
      ctn.innerHTML = '';
      var opts = computeChoices();
      if(!opts.length){
        var ni = computeNextIndex();
        var nextBtn = document.getElementById('next');
        var runBtn = document.getElementById('run');
        if(ni < 0){
          // finished
          if(running){
            // when running, let the loop handle final reset
            return;
          } else {
            resetAll();
            return;
          }
        }
        if(!running && nextBtn) nextBtn.disabled = false;
        return;
      }
      document.getElementById('next').disabled = true;
      var title = document.createElement('div'); title.textContent = 'Choose a path'; title.style.fontWeight = '600'; title.style.marginBottom = '6px';
      ctn.appendChild(title);
      opts.forEach(function(o){
        var b = document.createElement('button'); b.textContent = o.label; b.onclick = async function(){ ctn.innerHTML=''; document.getElementById('next').disabled=false; await playStep(o.to); if(choiceResolve){ var r=choiceResolve; choiceResolve=null; r(); } };
        ctn.appendChild(b);
      });
    }

    function showPopup(text){
      var el = document.getElementById('popup');
      if(!el) return;
      if(text && String(text).trim().length){ el.textContent = text; el.style.display = 'block'; }
      else { el.textContent=''; el.style.display = 'none'; }
    }

    function playStep(idx){
      var s = (data.manifest.steps||[])[idx]; if(!s) return Promise.resolve();
      current = idx; try { if(running && typeof runVisited !== 'undefined') runVisited[idx] = true; } catch(e){}; renderList(); addMarker(s); showChoices();
      showPopup(s && s.description || '');
      if(audio){ try{ audio.pause(); }catch(e){} audio=null; }
      var uri = data.audioMap && data.audioMap[s.id];
      if(uri){ audio = new Audio(uri); return new Promise(function(res){ audio.onended=function(){ clearMarker(s); showPopup(''); showChoices(); res(); }; audio.onerror=function(){ clearMarker(s); showPopup(''); showChoices(); res(); }; audio.play().catch(function(){ clearMarker(s); showPopup(''); showChoices(); res(); }); }); }
      return new Promise(function(res){ setTimeout(function(){ clearMarker(s); showPopup(''); showChoices(); res(); }, s.durationMs||1000); });
    }

    function resetAll(){
      try {
        var steps = (data.manifest && data.manifest.steps) || [];
        if(current >= 0 && current < steps.length){ clearMarker(steps[current]); }
      } catch(e){}
      if(audio){ try{ audio.pause(); }catch(e){} audio=null; }
      showPopup('');
      var ctn = document.getElementById('choices'); if(ctn) ctn.innerHTML = '';
      current = -1; renderList();
      var nextBtn = document.getElementById('next'); if(nextBtn) nextBtn.disabled = false;
      var runBtn = document.getElementById('run'); if(runBtn) runBtn.disabled = false;
      choiceResolve = null; try { if(typeof runVisited !== 'undefined') runVisited = {}; } catch(e){}
    }
    document.getElementById('next').onclick = function(){
      var steps = (data.manifest && data.manifest.steps) || [];
      if(current < 0 && steps.length){ playStep(0); return; }
      var ni = computeNextIndex();
      if(ni >= 0){ playStep(ni); }
    };
    var running = false; var runVisited = {};
    function waitForChoice(){ return new Promise(function(res){ choiceResolve = res; }); }
    document.getElementById('run').onclick = async function(){
      if(running) return;
      // ensure a full reset before running again
      resetAll(); try { runVisited = {}; } catch(e){}
      running = true;
      var runBtn = document.getElementById('run');
      var nextBtn = document.getElementById('next');
      runBtn.disabled = true;
      nextBtn.disabled = true;
      try {
        var steps = (data.manifest && data.manifest.steps) || [];
        if(current < 0 && steps.length){ await playStep(0); }
        while(true){
          var opts = computeChoices();
          if(opts.length){
            await waitForChoice();
          } else {
            var ni = computeNextIndex();
            if(ni >= 0){ await playStep(ni); }
            else { break; }
          }
        }
      } finally {
        running = false;
        runBtn.disabled = false;
        resetAll();
      }
    };
    viewer.importXML(data.xml).then(function(){ renderList(); canvas().zoom('fit-viewport'); }).catch(console.error);
  })();
  </script>
</body>
</html>`;

    fs.writeFileSync(filePath, html, 'utf-8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false };
  }
 });