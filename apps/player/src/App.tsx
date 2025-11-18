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
  const [choices, setChoices] = useState<Array<{ label: string; to: number }>>([]);
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
    setChoices([]);
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
    if (!manifest || !viewer) return;
    // If current is a gateway, present branch choices instead of blindly advancing
    const elementRegistry = (viewer as any).get('elementRegistry');
    const steps = manifest.steps;
    const idx = current + 1;
    if (current >= 0) {
      const curStep = steps[current];
      const el = curStep && elementRegistry.get(curStep.bpmnElementId);
      const type: string | undefined = el?.type || el?.businessObject?.$type;
      const isGateway = !!type && /Gateway$/.test(type);
      if (isGateway) {
        const outgoing: any[] = (el?.businessObject?.outgoing || []) as any[];
        const computeReachable = (startId: string): Set<string> => {
          const vis = new Set<string>();
          const q: string[] = [startId];
          while (q.length) {
            const id = q.shift()!;
            if (vis.has(id)) continue;
            vis.add(id);
            const node = elementRegistry.get(id);
            const bos = node?.businessObject;
            const outs: any[] = (bos?.outgoing || []) as any[];
            for (const f of outs) { if (f?.targetRef?.id) q.push(f.targetRef.id); }
          }
          return vis;
        };
        const options: Array<{ label: string; to: number }> = [];
        for (const flow of outgoing) {
          const target = flow?.targetRef;
          if (!target?.id) continue;
          const reach = computeReachable(target.id);
          let to = -1;
          for (let j = current + 1; j < steps.length; j++) {
            if (reach.has(steps[j].bpmnElementId)) { to = j; break; }
          }
          if (to >= 0) {
            options.push({ label: target.name || target.id, to });
          }
        }
        if (options.length) { setChoices(options); return; }
      }
    }
    if (idx < steps.length) playStep(idx);
   };
 
   return (
     <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 280, padding: 12, borderRight: '1px solid #ddd' }}>
        <input id="file-input" type="file" multiple onChange={e => loadFiles(e.target.files)} />
        {choices.length > 0 && (
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Choose a path</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {choices.map((c, i) => (
                <button key={i} onClick={() => { setChoices([]); playStep(c.to); }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <button onClick={next} disabled={!manifest || choices.length > 0}>Next</button>
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
       </div>
     </div>
   );
 }