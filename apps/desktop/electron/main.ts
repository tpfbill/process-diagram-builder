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