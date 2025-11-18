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
 
 app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
 });
 
 app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

 // Export a single-file standalone HTML player containing the project
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
      // production min if available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      viewerPath = require.resolve('bpmn-js/dist/bpmn-viewer.production.min.js');
    } catch {
      // fallback to development build
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

    // Build audio map (stepId -> data URI) from manifest and provided audio files
    let manifestObj: any;
    try { manifestObj = JSON.parse(data.manifest); } catch { manifestObj = { steps: [] }; }
    const byName: Record<string, string> = {};
    for (const a of data.audios || []) {
      const b = Buffer.from(Uint8Array.from(a.bytes));
      const uri = `data:audio/webm;base64,${b.toString('base64')}`;
      byName[a.name] = uri;
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
    #popup { position: absolute; left: 12px; bottom: 12px; max-width: 420px; background: rgba(255,255,255,0.95); border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); white-space: pre-wrap; display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="sidebar">
      <button id="next">Next</button>
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
    function zoomValue(){ try { return canvas().zoom(); } catch(e){ return 1; } }
    function setZoom(z){ try { canvas().zoom(z); } catch(e){} }
    document.getElementById('zoomIn').onclick = function(){ var z=zoomValue(); setZoom(Math.min(z*1.2,3)); };
    document.getElementById('zoomOut').onclick = function(){ var z=zoomValue(); setZoom(Math.max(z/1.2,0.2)); };
    document.getElementById('zoomReset').onclick = function(){ setZoom(1); };
    document.getElementById('zoomFit').onclick = function(){ try { canvas().zoom('fit-viewport'); } catch(e){} };

    var current = -1; var audio = null; var popup = document.getElementById('popup');
    function showPopup(text){ if(!popup) return; popup.textContent = text || ''; popup.style.display = text ? 'block' : 'none'; }
    function hidePopup(){ if(!popup) return; popup.style.display = 'none'; popup.textContent = ''; }
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
    function playStep(idx){
      var s = (data.manifest.steps||[])[idx]; if(!s) return Promise.resolve();
      current = idx; renderList(); addMarker(s);
      showPopup(s && s.description || '');
      if(audio){ try{ audio.pause(); }catch(e){} audio=null; }
      var uri = data.audioMap && data.audioMap[s.id];
      if(uri){ audio = new Audio(uri); return new Promise(function(res){ audio.onended=function(){ clearMarker(s); hidePopup(); res(); }; audio.onerror=function(){ clearMarker(s); hidePopup(); res(); }; audio.play().catch(function(){ clearMarker(s); hidePopup(); res(); }); }); }
      return new Promise(function(res){ setTimeout(function(){ clearMarker(s); hidePopup(); res(); }, s.durationMs||1000); });
    }
    document.getElementById('next').onclick = function(){ var i=current+1; if((data.manifest.steps||[]).length>i){ playStep(i); } };
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