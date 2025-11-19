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
.djs-element.current .djs-visual > :nth-child(1) { stroke: #1976d2 !important; stroke-width: 16px !important; fill: rgba(25,118,210,0.12) !important; }
/* Visited trail */
.djs-element.visited .djs-visual > :nth-child(1) { stroke: #64b5f6 !important; stroke-width: 6px !important; }
/* Ensure diagram text is readable on light/dark backgrounds */
svg text { fill: #111 !important; paint-order: stroke fill; stroke: rgba(255,255,255,0.9); stroke-width: 2px; }
`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Process Player</title>
  <style>${customCss}</style>
  <meta name="color-scheme" content="light" />
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
    /* Force light mode visuals regardless of OS theme */
    html { color-scheme: light; }
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
    var visitedEls = {}; var visitedFlows = {}; var origArrow = {};
    function ensureVisitedArrowMarker(){
      try {
        var svg = canvas()._svg; if(!svg) return;
        if(svg.querySelector && svg.querySelector('#pdb-visited-arrow')) return;
        var defs = svg.querySelector && svg.querySelector('defs');
        if(!defs){ defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.prepend(defs); }
        var marker = document.createElementNS('http://www.w3.org/2000/svg','marker');
        marker.setAttribute('id','pdb-visited-arrow');
        marker.setAttribute('viewBox','0 0 20 20');
        marker.setAttribute('refX','11');
        marker.setAttribute('refY','10');
        marker.setAttribute('markerWidth','6');
        marker.setAttribute('markerHeight','6');
        marker.setAttribute('markerUnits','userSpaceOnUse');
        marker.setAttribute('orient','auto');
        var p = document.createElementNS('http://www.w3.org/2000/svg','path');
        p.setAttribute('d','M 1 5 L 11 10 L 1 15 Z');
        p.setAttribute('fill','#64b5f6');
        p.setAttribute('stroke','none');
        marker.appendChild(p);
        defs.appendChild(marker);
      } catch(e){}
    }
    function addVisitedEl(id){ if(!id || visitedEls[id]) return; try { canvas().addMarker(id,'visited'); visitedEls[id]=true; } catch(e){} }
    function addVisitedFlow(id){
      if(!id || visitedFlows[id]) return;
      try {
        canvas().addMarker(id,'visited'); visitedFlows[id]=true;
        ensureVisitedArrowMarker();
        try {
          var gfx = canvas().getGraphics(id);
          var path = gfx && gfx.querySelector && (gfx.querySelector('path.djs-visual') || gfx.querySelector('path'));
          if(path){
            var m = path.getAttribute('marker-end') || '';
            var s = (path.style && path.style.markerEnd) || '';
            if(!origArrow[id]) origArrow[id] = { attr: m, style: s };
            path.setAttribute('marker-end','url(#pdb-visited-arrow)');
            try { path.style.markerEnd = 'url(#pdb-visited-arrow)'; } catch(e){}
          }
        } catch(e){}
      } catch(e){}
    }

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

    function computePath(fromId, toId){
      var er = elementRegistry();
      var elFrom = er.get(fromId); if(!elFrom) return { nodes: [], flows: [] };
      var from = elFrom.businessObject; var targetId = toId;
      var prev = {}; var q = []; var seen = {};
      if(from && from.id){ q.push(from); seen[from.id]=true; }
      while(q.length){
        var n = q.shift(); if(!n) break;
        if(n.id === targetId){
          var nodes=[]; var flows=[]; var cur=n.id;
          while(prev[cur]){ flows.push(prev[cur].flow); nodes.push(prev[cur].prev); cur = prev[cur].prev; }
          nodes.reverse(); flows.reverse();
          return { nodes: nodes, flows: flows };
        }
        var outs = n.outgoing || [];
        for(var i=0;i<outs.length;i++){
          var f = outs[i]; var t = f && f.targetRef; var tid = t && t.id;
          if(!tid || seen[tid]) continue;
          seen[tid]=true; prev[tid] = { prev: n.id, flow: f.id };
          q.push(t);
        }
      }
      return { nodes: [], flows: [] };
    }

    function markTransition(fromIndex, toIndex){
      var steps = (data.manifest && data.manifest.steps) || [];
      if(fromIndex < 0 || fromIndex >= steps.length) return;
      if(toIndex < 0 || toIndex >= steps.length) return;
      var from = steps[fromIndex]; var to = steps[toIndex];
      addVisitedEl(from.bpmnElementId);
      var path = computePath(from.bpmnElementId, to.bpmnElementId);
      (path.nodes||[]).forEach(addVisitedEl);
      (path.flows||[]).forEach(addVisitedFlow);
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
          return j;
        }
      }
      if(hasEnd) return -2; // finish here (matches editor preview)
      // Linear fallback (matches editor preview): next step in manifest
      return (current + 1 < steps.length) ? current + 1 : -1;
    }

    function findReachableEndId(){
      var steps = data.manifest.steps||[];
      if(current < 0 || current >= steps.length) return null;
      var cur = steps[current];
      var el = elementRegistry().get(cur.bpmnElementId);
      if(!el) return null;
      var q = [];
      var outs = (el.businessObject && el.businessObject.outgoing) || [];
      outs.forEach(function(f){ if(f && f.targetRef) q.push(f.targetRef); });
      var vis = {};
      while(q.length){
        var n = q.shift(); if(!n || !n.id || vis[n.id]) continue; vis[n.id]=true;
        var ty = n.$type || n.type || '';
        if(/EndEvent$/.test(String(ty))) return n.id;
        var o = n.outgoing || [];
        o.forEach(function(f){ if(f && f.targetRef) q.push(f.targetRef); });
      }
      return null;
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
        var b = document.createElement('button'); b.textContent = o.label; b.onclick = async function(){ ctn.innerHTML=''; document.getElementById('next').disabled=false; try { var stepsArr = (data.manifest && data.manifest.steps) || []; if(current>=0 && current < stepsArr.length) clearMarker(stepsArr[current]); } catch(e){}; try { markTransition(current, o.to); } catch(e){}; await playStep(o.to); if(choiceResolve){ var r=choiceResolve; choiceResolve=null; r(); } };
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
      if(uri){ audio = new Audio(uri); return new Promise(function(res){ audio.onended=function(){ addVisitedEl(s && s.bpmnElementId); showPopup(''); showChoices(); res(); }; audio.onerror=function(){ addVisitedEl(s && s.bpmnElementId); showPopup(''); showChoices(); res(); }; audio.play().catch(function(){ addVisitedEl(s && s.bpmnElementId); showPopup(''); showChoices(); res(); }); }); }
      return new Promise(function(res){ setTimeout(function(){ addVisitedEl(s && s.bpmnElementId); showPopup(''); showChoices(); res(); }, s.durationMs||1000); });
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
      try {
        Object.keys(visitedEls||{}).forEach(function(id){ try { canvas().removeMarker(id,'visited'); } catch(e){} });
        Object.keys(visitedFlows||{}).forEach(function(id){ try {
          // restore original arrowhead if we changed it
          var gfx = canvas().getGraphics(id);
          var path = gfx && gfx.querySelector && (gfx.querySelector('path.djs-visual') || gfx.querySelector('path'));
          if(path && origArrow && origArrow[id] !== undefined){
            var o = origArrow[id];
            if(o && typeof o === 'object'){
              if(o.attr !== undefined) path.setAttribute('marker-end', String(o.attr));
              try { path.style.markerEnd = o.style || ''; } catch(e){}
            } else {
              path.setAttribute('marker-end', String(origArrow[id]));
              try { path.style.markerEnd = ''; } catch(e){}
            }
          }
          canvas().removeMarker(id,'visited');
        } catch(e){} });
        visitedEls = {}; visitedFlows = {}; origArrow = {};
      } catch(e){}
    }
    document.getElementById('next').onclick = function(){
      var steps = (data.manifest && data.manifest.steps) || [];
      if(current < 0 && steps.length){ playStep(0); return; }
      var ni = computeNextIndex();
      if(ni >= 0){ try { if(current>=0 && current < steps.length) clearMarker(steps[current]); } catch(e){}; try { markTransition(current, ni); } catch(e){}; playStep(ni); }
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
            if(ni >= 0){ try { var stepsArr2 = (data.manifest && data.manifest.steps) || []; if(current>=0 && current < stepsArr2.length) clearMarker(stepsArr2[current]); } catch(e){}; try { markTransition(current, ni); } catch(e){}; await playStep(ni); }
            else {
              // If EndEvent reachable but no explicit step exists for it, briefly highlight the EndEvent then finish
              var endId = findReachableEndId();
              if(endId){ try{ canvas().addMarker(endId,'current'); canvas().zoom('fit-viewport'); }catch(e){}
                await new Promise(function(res){ setTimeout(res, 600); });
                try{ canvas().removeMarker(endId,'current'); }catch(e){}
              }
              break;
            }
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