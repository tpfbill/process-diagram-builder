import React, { useEffect, useRef, useState } from 'react';
import './styles.css';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import Modeler from 'bpmn-js/lib/Modeler';
// Explicitly include navigation + resize modules to ensure resizer handles are available
// and panning/zooming work as expected.
// These are included by default in Modeler, but we wire them to be safe and to enable keyboard binding.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ResizeModule from 'diagram-js/lib/features/resize';
// Ensure create/drag/palette are present and active
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import CreateModule from 'diagram-js/lib/features/create';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import DraggingModule from 'diagram-js/lib/features/dragging';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PaletteModule from 'bpmn-js/lib/features/palette';
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
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [selectedWidth, setSelectedWidth] = useState<number | ''>('');
  const [selectedHeight, setSelectedHeight] = useState<number | ''>('');
  const selectedIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const previewCancelRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
 
  useEffect(() => {
    const m = new Modeler({
      container: containerRef.current!,
      additionalModules: [
        ZoomScrollModule,
        MoveCanvasModule,
        ResizeModule,
        CreateModule,
        DraggingModule,
        PaletteModule
      ],
      keyboard: { bindTo: document }
    });
    modelerRef.current = m;
    // Initialize with an empty diagram so the canvas and palette render
    m.createDiagram();
    const eventBus = (m as any).get('eventBus');
    const commandStack = (m as any).get('commandStack');
    // initialize undo/redo state
    setCanUndo(commandStack.canUndo());
    setCanRedo(commandStack.canRedo());
    eventBus.on('commandStack.changed', () => {
      setCanUndo(commandStack.canUndo());
      setCanRedo(commandStack.canRedo());
    });
    eventBus.on('selection.changed', (e: any) => {
      const sel = e.newSelection && e.newSelection[0];
      setSelectedElementId(sel ? sel.id : null);
      if (sel) {
        const name = sel.businessObject && sel.businessObject.name;
        setSelectedLabel(name || "");
        setSelectedWidth(typeof sel.width === 'number' ? sel.width : '');
        setSelectedHeight(typeof sel.height === 'number' ? sel.height : '');
      } else {
        setSelectedLabel("");
        setSelectedWidth('');
        setSelectedHeight('');
      }
    });
    // When labels are edited inline on canvas, reflect into sidebar and auto-sync steps
    eventBus.on('element.changed', (e: any) => {
      const el = e && e.element;
      if (!el) return;
      const cur = selectedIdRef.current;
      const name = el.businessObject && el.businessObject.name;
      if (cur && el.id === cur) {
        setSelectedLabel(name || "");
        if (typeof el.width === 'number') setSelectedWidth(el.width);
        if (typeof el.height === 'number') setSelectedHeight(el.height);
      }
      // Auto-sync any steps that reference this BPMN element
      if (el.id) {
        const next = stepsRef.current.map(s => s.bpmnElementId === el.id ? { ...s, label: name || s.label } : s);
        const changed = JSON.stringify(next) !== JSON.stringify(stepsRef.current);
        if (changed) {
          setSteps(next);
          setManifest(updateTimestamp({ ...manifestRef.current, steps: next }));
        }
      }
    });
    return () => m.destroy();
  }, []);

  useEffect(() => { selectedIdRef.current = selectedElementId; }, [selectedElementId]);
  const manifestRef = useRef(manifest);
  const stepsRef = useRef(steps);
  useEffect(() => { manifestRef.current = manifest; }, [manifest]);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
 
  const addStep = () => {
    if (!selectedElementId) return;
    const id = `${Date.now()}`;
    const s: StepMeta = {
      id,
      label: selectedLabel || selectedElementId,
      bpmnElementId: selectedElementId,
      durationMs: 2000
    };
    const next = [...steps, s];
    setSteps(next);
    setManifest(updateTimestamp({ ...manifest, steps: next }));
  };

  const applyElementLabel = () => {
    if (!selectedElementId || !modelerRef.current) return;
    const elementRegistry = (modelerRef.current as any).get('elementRegistry');
    const modeling = (modelerRef.current as any).get('modeling');
    const el = elementRegistry.get(selectedElementId);
    if (!el) return;
    modeling.updateLabel(el, selectedLabel);
  };

  const applyElementSize = () => {
    if (!selectedElementId || !modelerRef.current) return;
    if (selectedWidth === '' || selectedHeight === '') return;
    const elementRegistry = (modelerRef.current as any).get('elementRegistry');
    const modeling = (modelerRef.current as any).get('modeling');
    const el = elementRegistry.get(selectedElementId);
    if (!el) return;
    const w = Math.max(30, Number(selectedWidth));
    const h = Math.max(30, Number(selectedHeight));
    modeling.resizeShape(el, { x: el.x, y: el.y, width: w, height: h });
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
      canvas.addMarker(s.bpmnElementId, 'current');
      await delay(s.durationMs);
      canvas.removeMarker(s.bpmnElementId, 'current');
    }
    setPreviewing(false);
  };
  const stopPreview = () => {
    previewCancelRef.current = true;
    setPreviewing(false);
  };
 
  const onCanvasClick = async () => {};

  // Zoom controls
  const getCanvas = () => (modelerRef.current as any)?.get('canvas');
  const zoomValue = () => getCanvas()?.zoom() ?? 1;
  const setZoom = (z: number) => getCanvas()?.zoom(z);
  const zoomIn = () => {
    const z = zoomValue();
    setZoom(Math.min(z * 1.2, 3));
  };
  const zoomOut = () => {
    const z = zoomValue();
    setZoom(Math.max(z / 1.2, 0.2));
  };
  const zoomReset = () => setZoom(1);
  const zoomFit = () => getCanvas()?.zoom('fit-viewport');

  // Undo / Redo controls
  const undo = () => (modelerRef.current as any)?.get('commandStack').undo();
  const redo = () => (modelerRef.current as any)?.get('commandStack').redo();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isInput = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]');
      if (isInput) return; // don't hijack typing
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
 
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top toolbar */}
      <div style={{ height: 72, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #ddd', background: '#fff' }}>
        <button onClick={() => setShowSidebar(s => !s)} title={showSidebar ? 'Hide Steps' : 'Show Steps'}>
          {showSidebar ? 'Hide Steps' : 'Show Steps'}
        </button>
        <div style={{ width: 12 }} />
        <button onClick={addStep} disabled={!selectedElementId}>Add Selected as Step</button>
        <button onClick={saveProject}>Save Project</button>
        <button onClick={previewAll} disabled={steps.length === 0 || previewing}>Preview</button>
        <button onClick={stopPreview} disabled={!previewing}>Stop</button>
        <div style={{ width: 16 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 240 }}>
          <label style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Label</label>
          <input
            type="text"
            placeholder="Enter label"
            value={selectedLabel}
            onChange={e => setSelectedLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyElementLabel(); }}
            style={{ flex: 1, minWidth: 120 }}
          />
          <button onClick={applyElementLabel} disabled={!selectedElementId}>Apply</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Size</label>
          <input
            type="number"
            min={30}
            placeholder="W"
            value={selectedWidth}
            onChange={e => setSelectedWidth(e.target.value === '' ? '' : Number(e.target.value))}
            style={{ width: 64 }}
          />
          ×
          <input
            type="number"
            min={30}
            placeholder="H"
            value={selectedHeight}
            onChange={e => setSelectedHeight(e.target.value === '' ? '' : Number(e.target.value))}
            style={{ width: 64 }}
          />
          <button onClick={applyElementSize} disabled={!selectedElementId || selectedWidth === '' || selectedHeight === ''}>Apply</button>
        </div>
        <div style={{ flex: 1 }} />
        {/* Undo/Redo + Zoom controls moved into top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={undo} disabled={!canUndo} title="Undo (⌘/Ctrl+Z)">Undo</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (⇧+⌘/Ctrl+Z)">Redo</button>
          <div style={{ width: 8 }} />
          <button onClick={zoomOut} title="Zoom Out">-</button>
          <button onClick={zoomReset} title="Reset Zoom">100%</button>
          <button onClick={zoomIn} title="Zoom In">+</button>
          <button onClick={zoomFit} title="Fit">Fit</button>
        </div>
      </div>

      {/* Main content: steps sidebar + canvas */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {showSidebar && (
          <div style={{ width: 320, borderRight: '1px solid #ddd', padding: 12, overflow: 'auto' }}>
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
        )}

        <div style={{ flex: 1, position: 'relative' }} onClick={onCanvasClick}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  );
 }