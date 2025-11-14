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
 
  useEffect(() => {
    const m = new Modeler({ container: containerRef.current! });
    modelerRef.current = m;
    // Initialize with an empty diagram so the canvas and palette render
    m.createDiagram();
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
 
  const onCanvasClick = async () => {
    const elementRegistry = modelerRef.current?.get('elementRegistry');
    const selection = modelerRef.current?.get('selection');
    const selected = selection.get();
    if (selected && selected[0]) setSelectedElementId(selected[0].id);
  };
 
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
      <div style={{ width: 320, borderRight: '1px solid #ddd', padding: 12 }}>
        <button onClick={addStep} disabled={!selectedElementId}>Add Selected as Step</button>
        <button onClick={saveProject} style={{ marginLeft: 8 }}>Save Project</button>
        <div style={{ marginTop: 12 }}>
          {steps.map(s => (
            <div key={s.id} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
              <div>{s.label}</div>
              <input type="number" value={s.durationMs} onChange={e => {
                const v = parseInt(e.target.value || '0', 10);
                const next = steps.map(x => x.id === s.id ? { ...x, durationMs: v } : x);
                setSteps(next);
                setManifest(updateTimestamp({ ...manifest, steps: next }));
              }} /> ms
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