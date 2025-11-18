import React, { useEffect, useRef, useState } from 'react';
import './styles.css';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import Modeler from 'bpmn-js/lib/Modeler';
 import { ProjectManifest, StepMeta, createEmptyManifest, updateTimestamp } from '@pdb/core';
 
 declare global {
  interface Window {
    api: {
      saveProject: (payload: { manifest: string; bpmn: string; audios: { name: string; bytes: number[] }[] }) => Promise<{ ok: boolean; path?: string }>;
    };
  }
 }
 
 export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<Modeler | null>(null);
  const [manifest, setManifest] = useState<ProjectManifest>(() => createEmptyManifest('New Process'));
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const [recordings, setRecordings] = useState<Record<string, Blob>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const previewCancelRef = useRef<boolean>(false);
 
  useEffect(() => {
    const m = new Modeler({ container: containerRef.current! });
    modelerRef.current = m;
    // Initialize with an empty diagram so the canvas and palette render
    m.createDiagram();
    const eventBus = (m as any).get('eventBus');
    const off = eventBus.on('selection.changed', (e: any) => {
      const sel = e.newSelection && e.newSelection[0];
      setSelectedElementId(sel ? sel.id : null);
    });
    return () => m.destroy();
  }, []);
 
  const addStep = () => {
    if (!selectedElementId) return;
    const id = `${Date.now()}`;
    const s: StepMeta = {
      id,
      label: selectedElementId,
      bpmnElementId: selectedElementId,
      durationMs: 2000
    };
    const next = [...steps, s];
    setSteps(next);
    setManifest(updateTimestamp({ ...manifest, steps: next }));
  };

  const moveStepIndex = (index: number, delta: number) => {
    const to = index + delta;
    if (index < 0 || index >= steps.length) return;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    setSteps(next);
    setManifest(updateTimestamp({ ...manifest, steps: next }));
  };

  const onDragStartStep = (id: string) => setDraggingId(id);
  const onDragOverStep = (e: React.DragEvent) => e.preventDefault();
  const onDropStep = (id: string) => {
    if (!draggingId || draggingId === id) return;
    const from = steps.findIndex(s => s.id === draggingId);
    const to = steps.findIndex(s => s.id === id);
    if (from === -1 || to === -1) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSteps(next);
    setManifest(updateTimestamp({ ...manifest, steps: next }));
    setDraggingId(null);
  };

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
  const previewAll = async () => {
    if (previewing) return;
    if (!modelerRef.current) return;
    setPreviewing(true);
    previewCancelRef.current = false;
    const canvas = (modelerRef.current as any).get('canvas');
    for (const s of steps) {
      if (previewCancelRef.current) break;
      canvas.addMarker(s.bpmnElementId, 'highlight');
      await delay(s.durationMs);
      canvas.removeMarker(s.bpmnElementId, 'highlight');
    }
    setPreviewing(false);
  };
  const stopPreview = () => {
    previewCancelRef.current = true;
    setPreviewing(false);
  };
 
  const onCanvasClick = async () => {};
 
  const startRecording = async (stepId: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = e => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setRecordings(prev => ({ ...prev, [stepId]: blob }));
    };
    mr.start();
  };
 
  const stopRecording = () => mediaRecorderRef.current?.stop();
 
  const saveProject = async () => {
    const { xml } = await modelerRef.current!.saveXML({ format: true });
    const audios = await Promise.all(
      steps.map(async s => {
        const blob = recordings[s.id];
        const arr = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
        return { name: `${s.id}.webm`, bytes: Array.from(arr) };
      })
    );
    const man = JSON.stringify({ ...manifest, steps: steps.map(s => ({ ...s, audioFile: `${s.id}.webm` })) }, null, 2);
    await window.api.saveProject({ manifest: man, bpmn: xml, audios });
  };
 
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 360, borderRight: '1px solid #ddd', padding: 12 }}>
        <button onClick={addStep} disabled={!selectedElementId}>Add Selected as Step</button>
        <button onClick={saveProject} style={{ marginLeft: 8 }}>Save Project</button>
        <div style={{ marginTop: 8 }}>
          <button onClick={previewAll} disabled={steps.length === 0 || previewing}>Preview Sequence</button>
          <button onClick={stopPreview} disabled={!previewing} style={{ marginLeft: 8 }}>Stop Preview</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {steps.map((s, i) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => onDragStartStep(s.id)}
              onDragOver={onDragOverStep}
              onDrop={() => onDropStep(s.id)}
              style={{ padding: 8, borderBottom: '1px solid #eee', background: draggingId === s.id ? '#fafafa' : 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 500 }}>{i + 1}. {s.label}</div>
                <div>
                  <button onClick={() => moveStepIndex(i, -1)} disabled={i === 0}>▲</button>
                  <button onClick={() => moveStepIndex(i, +1)} disabled={i === steps.length - 1} style={{ marginLeft: 4 }}>▼</button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
                <input
                  type="range"
                  min={500}
                  max={10000}
                  step={100}
                  value={s.durationMs}
                  onChange={e => {
                    const v = parseInt(e.target.value || '0', 10);
                    const next = steps.map(x => x.id === s.id ? { ...x, durationMs: v } : x);
                    setSteps(next);
                    setManifest(updateTimestamp({ ...manifest, steps: next }));
                  }}
                  style={{ flex: 1, marginRight: 8 }}
                />
                <input type="number" value={s.durationMs} onChange={e => {
                const v = parseInt(e.target.value || '0', 10);
                const next = steps.map(x => x.id === s.id ? { ...x, durationMs: v } : x);
                setSteps(next);
                setManifest(updateTimestamp({ ...manifest, steps: next }));
              }} style={{ width: 90 }} /> ms
              </div>
              <div>
                <button onClick={() => startRecording(s.id)}>Record</button>
                <button onClick={stopRecording} style={{ marginLeft: 8 }}>Stop</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1 }} onClick={onCanvasClick}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
 }