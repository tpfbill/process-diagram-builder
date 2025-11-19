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
      openProject: () => Promise<{ ok: boolean; manifest?: string; bpmn?: string; audios?: { name: string; bytes: number[] }[] }>;
      exportStandalone: (payload: { manifest: string; bpmn: string; audios: { name: string; bytes: number[] }[] }) => Promise<{ ok: boolean; path?: string }>;
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
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const playbackUrlRef = useRef<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [selectedWidth, setSelectedWidth] = useState<number | ''>('');
  const [selectedHeight, setSelectedHeight] = useState<number | ''>('');
  const selectedIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const previewCancelRef = useRef<boolean>(false);
  // Track visited elements/flows during preview to leave a trail
  const visitedElsRef = useRef<Set<string>>(new Set());
  const visitedFlowsRef = useRef<Set<string>>(new Set());
  const origArrowRef = useRef<Map<string, { attr?: string; style?: string }>>(new Map());
  const [previewChoices, setPreviewChoices] = useState<Array<{ label: string; to: number }>>([]);
  const choiceResolverRef = useRef<((to: number) => void) | null>(null);
  const [previewText, setPreviewText] = useState<string>("");
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

  // Cleanup any playing audio on unmount
  useEffect(() => {
    return () => {
      if (playbackRef.current) {
        try { playbackRef.current.pause(); } catch {}
      }
      if (playbackUrlRef.current) {
        try { URL.revokeObjectURL(playbackUrlRef.current); } catch {}
      }
      playbackRef.current = null;
      playbackUrlRef.current = null;
    };
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
      label: selectedLabel || (selectedElementId ?? ''),
      bpmnElementId: selectedElementId ?? '',
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

  const addVisitedEl = (id: string) => {
    if (!modelerRef.current || !id) return;
    const set = visitedElsRef.current;
    if (set.has(id)) return;
    try { (modelerRef.current as any).get('canvas').addMarker(id, 'visited'); set.add(id); } catch {}
  };
  const addVisitedFlow = (id: string) => {
    if (!modelerRef.current || !id) return;
    const set = visitedFlowsRef.current;
    if (set.has(id)) return;
    try {
      const canvas = (modelerRef.current as any).get('canvas');
      canvas.addMarker(id, 'visited');
      set.add(id);
      // Shrink arrowhead for visited connection
      try {
        const svg: SVGSVGElement | undefined = (canvas as any)._svg;
        if (svg) {
          ensureVisitedArrowMarker(svg);
          const gfx: SVGGElement | null = canvas.getGraphics(id);
          const path: SVGPathElement | null = gfx ? ((gfx.querySelector('path.djs-visual') || gfx.querySelector('path')) as SVGPathElement) : null;
          if (path) {
            const origAttr = path.getAttribute('marker-end') || '';
            const origStyle = (path.style as any)?.markerEnd || '';
            if (!origArrowRef.current.has(id)) origArrowRef.current.set(id, { attr: origAttr, style: origStyle });
            path.setAttribute('marker-end', 'url(#pdb-visited-arrow)');
            try { (path.style as any).markerEnd = 'url(#pdb-visited-arrow)'; } catch {}
          }
        }
      } catch {}
    } catch {}
  };
  const clearVisited = () => {
    if (!modelerRef.current) return;
    const canvas = (modelerRef.current as any).get('canvas');
    for (const id of visitedElsRef.current) { try { canvas.removeMarker(id, 'visited'); } catch {} }
    for (const id of visitedFlowsRef.current) {
      try {
        // Restore original arrowhead
        const gfx: SVGGElement | null = canvas.getGraphics(id);
        const path: SVGPathElement | null = gfx ? ((gfx.querySelector('path.djs-visual') || gfx.querySelector('path')) as SVGPathElement) : null;
        if (path) {
          const orig = origArrowRef.current.get(id);
          if (orig?.attr !== undefined) path.setAttribute('marker-end', orig.attr);
          try { (path.style as any).markerEnd = orig?.style || ''; } catch {}
        }
      } catch {}
      try { canvas.removeMarker(id, 'visited'); } catch {}
    }
    visitedElsRef.current.clear();
    visitedFlowsRef.current.clear();
    origArrowRef.current.clear();
  };

  // Ensure a smaller arrowhead marker exists for visited connections
  const ensureVisitedArrowMarker = (svg: SVGSVGElement) => {
    if (svg.querySelector('#pdb-visited-arrow')) return;
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.prepend(defs); }
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'pdb-visited-arrow');
    marker.setAttribute('viewBox', '0 0 20 20');
    marker.setAttribute('refX', '11');
    marker.setAttribute('refY', '10');
    marker.setAttribute('markerWidth', '6');  // ~1/3 of typical 18-20
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    marker.setAttribute('orient', 'auto');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M 1 5 L 11 10 L 1 15 Z');
    p.setAttribute('fill', '#64b5f6');
    p.setAttribute('stroke', 'none');
    marker.appendChild(p);
    defs.appendChild(marker);
  };

  // Compute path (nodes + sequence flows) between two BPMN element ids
  const computePathBetween = (fromId: string, toId: string): { nodes: string[]; flows: string[] } => {
    const er = (modelerRef.current as any)?.get('elementRegistry');
    const from = er?.get(fromId)?.businessObject;
    const targetId = toId;
    const prev: Record<string, { prev: string; flow: string }> = {};
    const q: any[] = [];
    const seen = new Set<string>();
    if (from?.id) { q.push(from); seen.add(from.id); }
    while (q.length) {
      const n = q.shift();
      if (!n) break;
      if (n.id === targetId) {
        const nodes: string[] = [n.id];
        const flows: string[] = [];
        let cur = n.id as string;
        while (prev[cur]) {
          flows.push(prev[cur].flow);
          nodes.push(prev[cur].prev);
          cur = prev[cur].prev;
        }
        nodes.reverse(); flows.reverse();
        return { nodes, flows };
      }
      const outs: any[] = (n.outgoing || []) as any[];
      for (const f of outs) {
        const t = f?.targetRef; const tid = t?.id;
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        prev[tid] = { prev: n.id, flow: f.id };
        q.push(t);
      }
    }
    return { nodes: [], flows: [] };
  };

  const markTransition = (fromIndex: number, toIndex: number) => {
    const stepsLocal = stepsRef.current;
    if (fromIndex < 0 || fromIndex >= stepsLocal.length) return;
    if (toIndex < 0 || toIndex >= stepsLocal.length) return;
    const from = stepsLocal[fromIndex];
    const to = stepsLocal[toIndex];
    addVisitedEl(from.bpmnElementId);
    const path = computePathBetween(from.bpmnElementId, to.bpmnElementId);
    path.nodes.forEach(addVisitedEl);
    path.flows.forEach(addVisitedFlow);
  };

  const waitForChoice = () => new Promise<number>((resolve) => { choiceResolverRef.current = resolve; });

  const computeChoices = (idx: number) => {
    if (!modelerRef.current) return [] as Array<{ label: string; to: number }>;
    const elementRegistry = (modelerRef.current as any).get('elementRegistry');
    const stepsLocal = stepsRef.current;
    const curStep = stepsLocal[idx];
    const el = curStep && elementRegistry.get(curStep.bpmnElementId);
    const type: string | undefined = el?.type || el?.businessObject?.$type;
    const isGateway = !!type && /Gateway$/.test(type);
    if (!isGateway) return [];
    const outgoing: any[] = (el?.businessObject?.outgoing || []) as any[];
    const reachable = (startId: string) => {
      const vis = new Set<string>();
      const q: string[] = [startId];
      while (q.length) {
        const id = q.shift()!;
        if (vis.has(id)) continue;
        vis.add(id);
        const node = elementRegistry.get(id);
        const outs: any[] = (node?.businessObject?.outgoing || []) as any[];
        for (const f of outs) if (f?.targetRef?.id) q.push(f.targetRef.id);
      }
      return vis;
    };
    const options: Array<{ label: string; to: number }> = [];
    for (const flow of outgoing) {
      const target = flow?.targetRef;
      if (!target?.id) continue;
      const reach = reachable(target.id);
      let to = -1;
      for (let j = idx + 1; j < stepsLocal.length; j++) {
        if (reach.has(stepsLocal[j].bpmnElementId)) { to = j; break; }
      }
      if (to >= 0) options.push({ label: target.name || target.id, to });
    }
    return options;
  };

  const computeNextFromFlow = (idx: number) => {
    if (!modelerRef.current) return { to: -1, hasEnd: false };
    const elementRegistry = (modelerRef.current as any).get('elementRegistry');
    const stepsLocal = stepsRef.current;
    const cur = stepsLocal[idx];
    if (!cur) return { to: -1, hasEnd: false };
    const curEl = elementRegistry.get(cur.bpmnElementId);
    const t: string | undefined = curEl?.type || curEl?.businessObject?.$type;
    if (t && /Gateway$/.test(t)) return { to: -1, hasEnd: false };
    const ids = new Set<string>();
    let hasEnd = false;
    const q: any[] = [];
    const outs: any[] = (curEl?.businessObject?.outgoing || []) as any[];
    for (const f of outs) if (f?.targetRef) q.push(f.targetRef);
    while (q.length) {
      const n = q.shift();
      if (!n?.id || ids.has(n.id)) continue;
      ids.add(n.id);
      const ty: string | undefined = n.$type || n.type;
      if (ty && /EndEvent$/.test(ty)) hasEnd = true;
      const o: any[] = (n.outgoing || []) as any[];
      for (const f of o) if (f?.targetRef) q.push(f.targetRef);
    }
    let to = -1;
    for (let j = idx + 1; j < stepsLocal.length; j++) {
      if (ids.has(stepsLocal[j].bpmnElementId)) { to = j; break; }
    }
    return { to, hasEnd };
  };

  const previewAll = async () => {
    if (previewing) return;
    if (!modelerRef.current) return;
    setPreviewing(true);
    previewCancelRef.current = false;
    clearVisited();
    const canvas = (modelerRef.current as any).get('canvas');
    let idx = 0;
    while (!previewCancelRef.current && idx >= 0 && idx < stepsRef.current.length) {
      const s = stepsRef.current[idx];
      if (!s) break;
      canvas.addMarker(s.bpmnElementId, 'current');
      setPreviewText(s.description || "");
      const blob = recordings[s.id];
      if (blob) await playBlob(blob); else await delay(s.durationMs);
      // Leave a trail for visited elements
      addVisitedEl(s.bpmnElementId);
      canvas.removeMarker(s.bpmnElementId, 'current');
      setPreviewText("");
      if (previewCancelRef.current) break;

      // Branching logic
      const choices = computeChoices(idx);
      if (choices.length) {
        setPreviewChoices(choices);
        const sel = await waitForChoice();
        setPreviewChoices([]);
        if (previewCancelRef.current || sel < 0) break;
        markTransition(idx, sel);
        idx = sel;
        continue;
      }
      const { to, hasEnd } = computeNextFromFlow(idx);
      if (to >= 0) { markTransition(idx, to); idx = to; continue; }
      if (hasEnd) break;
      // Linear fallback
      if (idx + 1 < stepsRef.current.length) {
        markTransition(idx, idx + 1);
        idx = idx + 1;
      } else break;
    }
    setPreviewing(false);
  };
  const stopPreview = () => {
    previewCancelRef.current = true;
    stopPlayback();
    if (choiceResolverRef.current) { try { choiceResolverRef.current(-1); } catch {} choiceResolverRef.current = null; }
    setPreviewChoices([]);
    setPreviewText("");
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

  const stopPlayback = () => {
    if (playbackRef.current) {
      try { playbackRef.current.pause(); } catch {}
    }
    if (playbackUrlRef.current) {
      try { URL.revokeObjectURL(playbackUrlRef.current); } catch {}
    }
    playbackRef.current = null;
    playbackUrlRef.current = null;
  };

  const playBlob = async (blob: Blob) => {
    stopPlayback();
    const url = URL.createObjectURL(blob);
    playbackUrlRef.current = url;
    const a = new Audio(url);
    playbackRef.current = a;
    await new Promise<void>((resolve) => {
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  };

  const playRecording = async (stepId: string) => {
    const blob = recordings[stepId];
    if (!blob) return;
    await playBlob(blob);
  };
 
  const saveProject = async () => {
    const { xml } = await modelerRef.current!.saveXML({ format: true });
    const xmlStr = xml ?? '';
    const audios = await Promise.all(
      steps.map(async s => {
        const blob = recordings[s.id];
        const arr = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
        return { name: `${s.id}.webm`, bytes: Array.from(arr) };
      })
    );
    const man = JSON.stringify({ ...manifest, steps: steps.map(s => ({ ...s, audioFile: `${s.id}.webm` })) }, null, 2);
    await window.api.saveProject({ manifest: man, bpmn: xmlStr, audios });
  };

  const exportStandalone = async () => {
    const { xml } = await modelerRef.current!.saveXML({ format: true });
    const xmlStr = xml ?? '';
    const audios = await Promise.all(
      steps.map(async s => {
        const blob = recordings[s.id];
        const arr = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
        return { name: `${s.id}.webm`, bytes: Array.from(arr) };
      })
    );
    const man = JSON.stringify({ ...manifest, steps: steps.map(s => ({ ...s, audioFile: `${s.id}.webm` })) }, null, 2);
    await window.api.exportStandalone({ manifest: man, bpmn: xmlStr, audios });
  };

  const openProject = async () => {
    const resp = await window.api.openProject();
    if (!resp?.ok || !resp.manifest || !resp.bpmn) return;
    try {
      const mObj: ProjectManifest = JSON.parse(resp.manifest);
      setManifest(mObj);
      setSteps(mObj.steps || []);
      await modelerRef.current?.importXML(resp.bpmn);
      const recs: Record<string, Blob> = {};
      if (resp.audios && Array.isArray(resp.audios)) {
        const audioMap = new Map(resp.audios.map(a => [a.name, a.bytes] as const));
        for (const s of mObj.steps || []) {
          const name = s.audioFile || `${s.id}.webm`;
          const bytes = audioMap.get(name);
          if (bytes) {
            const u8 = new Uint8Array(bytes as number[]);
            recs[s.id] = new Blob([u8], { type: 'audio/webm' });
          }
        }
      }
      setRecordings(recs);
    } catch {}
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
        <button onClick={openProject}>Open Project</button>
        <button onClick={saveProject}>Save Project</button>
        <button onClick={exportStandalone}>Export Standalone</button>
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
            {previewChoices.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Choose a path</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {previewChoices.map((c, i) => (
                    <button key={i} onClick={() => { const r = choiceResolverRef.current; choiceResolverRef.current = null; setPreviewChoices([]); r && r(c.to); }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                {/* Popup description editor */}
                <div style={{ marginTop: 8 }}>
                  <textarea
                    placeholder="Popup description (optional)"
                    value={s.description || ''}
                    onChange={e => {
                      const val = e.target.value;
                      const next = steps.map(x => x.id === s.id ? { ...x, description: val } : x);
                      setSteps(next);
                      setManifest(updateTimestamp({ ...manifest, steps: next }));
                    }}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </div>
                <div>
                  <button onClick={() => startRecording(s.id)}>Record</button>
                  <button onClick={stopRecording} style={{ marginLeft: 8 }}>Stop</button>
                  <button onClick={() => playRecording(s.id)} style={{ marginLeft: 8 }} disabled={!recordings[s.id]}>Play</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, position: 'relative' }} onClick={onCanvasClick}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          {previewing && previewText && (
            <div
              style={{
                position: 'absolute',
                left: 16,
                right: 16,
                bottom: 16,
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid #ddd',
                borderRadius: 8,
                boxShadow: '0 4px 18px rgba(0,0,0,0.12)',
                maxHeight: '40%',
                overflow: 'auto'
              }}
            >
              {previewText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
 }