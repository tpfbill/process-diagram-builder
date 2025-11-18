import React, { useEffect, useRef, useState } from 'react';
import './styles.css';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
 import BpmnJS from 'bpmn-js/lib/Modeler';
 import Viewer from 'bpmn-js/lib/Viewer';
 import { ProjectManifest, StepMeta } from '@pdb/core';
 
 type ProjectIndexItem = { slug: string; name: string };

 export default function App() {
   const containerRef = useRef<HTMLDivElement>(null);
   const [viewer, setViewer] = useState<Viewer | null>(null);
   const [manifest, setManifest] = useState<ProjectManifest | null>(null);
   const [current, setCurrent] = useState<number>(-1);
   const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [projects, setProjects] = useState<ProjectIndexItem[]>([]);
  const [projectSlug, setProjectSlug] = useState<string>("");
  const getCanvas = () => (viewer as any)?.get('canvas');
  const zoomValue = () => getCanvas()?.zoom() ?? 1;
  const setZoom = (z: number) => getCanvas()?.zoom(z);
  const zoomIn = () => { const z = zoomValue(); setZoom(Math.min(z * 1.2, 3)); };
  const zoomOut = () => { const z = zoomValue(); setZoom(Math.max(z / 1.2, 0.2)); };
  const zoomReset = () => setZoom(1);
  const zoomFit = () => getCanvas()?.zoom('fit-viewport');
 
   useEffect(() => {
     const v = new Viewer({ container: containerRef.current! });
     setViewer(v);
     return () => v.destroy();
   }, []);
 
   // Load project index if available
   useEffect(() => {
     (async () => {
       try {
         const res = await fetch('/projects/index.json', { cache: 'no-store' });
         if (res.ok) {
           const list: ProjectIndexItem[] = await res.json();
           setProjects(list);
         }
       } catch {}
     })();
   }, []);

   const loadFiles = async (files: FileList | null) => {
     if (!files) return;
     const fileMap = new Map<string, File>();
     Array.from(files).forEach(f => fileMap.set(f.name, f));
     const m = fileMap.get('manifest.json');
     const bpmn = fileMap.get('diagram.bpmn');
     if (!m || !bpmn) return;
     const manifestObj: ProjectManifest = JSON.parse(await m.text());
     setManifest(manifestObj);
     const xml = await bpmn.text();
     await viewer?.importXML(xml);
   };
 
   const playStep = async (idx: number) => {
     if (!manifest || !viewer) return;
     const step = manifest.steps[idx];
     if (!step) return;
     setCurrent(idx);
    setShowPopup(!!step.description);
     const canvas = (viewer as any).get('canvas');
     canvas.zoom('fit-viewport');
    canvas.addMarker(step.bpmnElementId, 'current');
     let audioUrl: string | undefined;
     if (step.audioFile) {
       if (projectSlug) {
         audioUrl = `/projects/${projectSlug}/${step.audioFile}`;
       } else {
         const input = document.getElementById('file-input') as HTMLInputElement;
         const files = input?.files ? Array.from(input.files) : [];
         const f = files.find(f => f.name === step.audioFile);
         if (f) audioUrl = URL.createObjectURL(f);
       }
     }
     const a = audioUrl ? new Audio(audioUrl) : null;
     setAudio(a);
     try { await a?.play(); } catch {}
    await new Promise(r => setTimeout(r, step.durationMs));
    canvas.removeMarker(step.bpmnElementId, 'current');
    setShowPopup(false);
   };
 
   const next = () => {
     const idx = current + 1;
     if (!manifest) return;
     if (idx < manifest.steps.length) playStep(idx);
   };
 
   const loadProjectBySlug = async (slug: string) => {
     if (!viewer) return;
     try {
       const [mRes, xRes] = await Promise.all([
         fetch(`/projects/${slug}/manifest.json`, { cache: 'no-store' }),
         fetch(`/projects/${slug}/diagram.bpmn`, { cache: 'no-store' })
       ]);
       if (!mRes.ok || !xRes.ok) return;
       const man: ProjectManifest = await mRes.json();
       setManifest(man);
       const xml = await xRes.text();
       await viewer.importXML(xml);
       setProjectSlug(slug);
       setCurrent(-1);
     } catch {}
   };

   return (
     <div style={{ display: 'flex', height: '100vh' }}>
       <div style={{ width: 320, padding: 12, borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: 8 }}>
         <div>
           <div style={{ fontWeight: 600, marginBottom: 6 }}>Load project</div>
           <select value={projectSlug} onChange={e => loadProjectBySlug(e.target.value)} style={{ width: '100%' }}>
             <option value="">— Select from server —</option>
             {projects.map(p => (
               <option key={p.slug} value={p.slug}>{p.name}</option>
             ))}
           </select>
         </div>
         <div>
           <div style={{ fontWeight: 600, margin: '8px 0 6px' }}>Or load files</div>
           <input id="file-input" type="file" multiple onChange={e => { setProjectSlug(""); loadFiles(e.target.files); }} />
         </div>
         <button onClick={next} disabled={!manifest}>Next</button>
         <div>
           {manifest?.steps.map((s: StepMeta, i) => (
             <div key={s.id} style={{ padding: 6, background: i === current ? '#eef' : 'transparent' }}>
               {i + 1}. {s.label}
             </div>
           ))}
         </div>
       </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div style={{ position: 'absolute', right: 12, top: 12, display: 'flex', gap: 6, background: 'rgba(255,255,255,0.9)', border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px' }}>
          <button onClick={zoomOut} title="Zoom Out">-</button>
          <button onClick={zoomReset} title="Reset Zoom">100%</button>
          <button onClick={zoomIn} title="Zoom In">+</button>
          <button onClick={zoomFit} title="Fit">Fit</button>
        </div>
        {showPopup && manifest && current >= 0 && manifest.steps[current]?.description && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, maxWidth: 420, background: 'rgba(255,255,255,0.95)', border: '1px solid #ddd', borderRadius: 8, padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', whiteSpace: 'pre-wrap' }}>
            {manifest.steps[current].description}
          </div>
        )}
       </div>
     </div>
   );
 }