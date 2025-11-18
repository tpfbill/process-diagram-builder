import React, { useEffect, useRef, useState } from 'react';
import './styles.css';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
 import BpmnJS from 'bpmn-js/lib/Modeler';
 import Viewer from 'bpmn-js/lib/Viewer';
 import { ProjectManifest, StepMeta } from '@pdb/core';
 
 export default function App() {
   const containerRef = useRef<HTMLDivElement>(null);
   const [viewer, setViewer] = useState<Viewer | null>(null);
   const [manifest, setManifest] = useState<ProjectManifest | null>(null);
   const [current, setCurrent] = useState<number>(-1);
   const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
 
   useEffect(() => {
     const v = new Viewer({ container: containerRef.current! });
     setViewer(v);
     return () => v.destroy();
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
     const canvas = (viewer as any).get('canvas');
     canvas.zoom('fit-viewport');
    canvas.addMarker(step.bpmnElementId, 'current');
     const audioFile = step.audioFile && (document.getElementById('file-input') as HTMLInputElement)?.files;
     let audioUrl: string | undefined;
     if (audioFile) {
       const f = Array.from(audioFile).find(f => f.name === step.audioFile);
       if (f) audioUrl = URL.createObjectURL(f);
     }
     const a = new Audio(audioUrl);
     setAudio(a);
     a?.play();
     await new Promise(r => setTimeout(r, step.durationMs));
    canvas.removeMarker(step.bpmnElementId, 'current');
   };
 
   const next = () => {
     const idx = current + 1;
     if (!manifest) return;
     if (idx < manifest.steps.length) playStep(idx);
   };
 
   return (
     <div style={{ display: 'flex', height: '100vh' }}>
       <div style={{ width: 280, padding: 12, borderRight: '1px solid #ddd' }}>
         <input id="file-input" type="file" multiple onChange={e => loadFiles(e.target.files)} />
         <button onClick={next} disabled={!manifest}>Next</button>
         <div>
           {manifest?.steps.map((s: StepMeta, i) => (
             <div key={s.id} style={{ padding: 6, background: i === current ? '#eef' : 'transparent' }}>
               {i + 1}. {s.label}
             </div>
           ))}
         </div>
       </div>
       <div style={{ flex: 1 }}>
         <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
       </div>
     </div>
   );
 }