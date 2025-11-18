 import { contextBridge, ipcRenderer } from 'electron';
 
 contextBridge.exposeInMainWorld('api', {
  saveProject: async (payload: { manifest: string; bpmn: string; audios: { name: string; bytes: number[] }[] }) =>
    ipcRenderer.invoke('dialog:saveProject', payload),
  openProject: async (): Promise<{ ok: boolean; manifest?: string; bpmn?: string; audios?: { name: string; bytes: number[] }[] }> =>
    ipcRenderer.invoke('dialog:openProject'),
  exportStandalone: async (payload: { manifest: string; bpmn: string; audios: { name: string; bytes: number[] }[] }) =>
    ipcRenderer.invoke('dialog:exportStandalone', payload)
 });