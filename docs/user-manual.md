---
title: Process Diagram Builder — User Manual
author: Process Diagram Builder Team
version: 0.1.0
---

# 1. Introduction

Process Diagram Builder is a desktop editor (Electron + React + BPMN.js) for creating animated process diagrams with optional per‑step audio narration. You can design BPMN diagrams, define a step sequence, preview with interactive branching, and export a standalone HTML player for sharing.

# 2. Installation

- Windows: install the MSI you built (Process Diagram Builder x.y.z.msi). After install, launch from Start Menu → Process Diagram Builder.
- macOS/Linux: dev builds only (run from source).

# 3. Quick Start

1) Open the app. The BPMN canvas and palette appear.
2) Drag BPMN elements (StartEvent, Task, Gateway, EndEvent) onto the canvas and connect with Sequence Flows.
3) Select any element on the canvas and click “Add Selected as Step” to add it into the step list.
4) Optionally record audio for steps (Record → Stop → Play).
5) Click “Preview” to walk the process. Choose paths at gateways when prompted. “Run Continuous” auto‑advances.
6) Save your project or export a standalone HTML player.

# 4. UI Overview

Top toolbar (left → right):
- Show/Hide Steps: toggle the steps sidebar.
- Add Selected as Step: adds the currently selected BPMN element to the steps list.
- Open Project: load a previously saved project folder.
- Save Project: save manifest, BPMN diagram, and audio to a folder.
- Export Standalone: export a single HTML file player with embedded diagram, styles, and audio.
- Preview: run an interactive preview of your defined steps with highlighting and audio.
- Stop: stop an in‑progress preview.
- Label editor: edit the label of the selected canvas element and apply.
- Size (W×H): resize selected shape numerically and apply.
- Undo / Redo: command history for canvas edits.
- Zoom: Out, Reset (100%), In, Fit to viewport.

Steps sidebar:
- Reorder: drag & drop, or use ▲/▼ buttons.
- Duration: per‑step duration slider and numeric entry (ms) used when no audio is attached.
- Popup Description: rich text area shown as a pop‑up during preview.
- Audio: Record, Stop, and Play per step.

Canvas and palette:
- Uses BPMN.js Modeler. Pan with mouse, zoom with mouse wheel (or toolbar), select to edit.
- Palette provides BPMN building blocks (see Section 5).

# 5. Available BPMN Objects and Their Functions

Core elements (as shown in the BPMN palette):
- Start Event: entry point of the process.
- End Event: termination of the process path; preview detects reachability to end events to finish runs.
- Task: a unit of work; typical step anchor.
- Gateway (Exclusive/Parallel, etc.): branching/merging. In preview you’ll see a “Choose a path” prompt at gateways with multiple outgoing flows.
- Intermediate Event (timer/message/etc., if used): supported by BPMN.js; can influence flows but is optional in this app.
- Sequence Flow: connectors between elements; arrows are emphasized and tracked during preview.

Notes:
- Any BPMN element can be added as a step; choose those that best narrate the process.
- Gateways control interactive branching in preview and in exported players.

# 6. Projects: Save and Open

When you click “Save Project”, the app writes a folder with:
- manifest.json: list of steps with ids, labels, BPMN element ids, durations, descriptions, audio filenames.
- diagram.bpmn: the BPMN XML of your canvas.
- audio/: directory of per‑step audio files (WebM).

“Open Project” expects the same structure. Audio is auto‑linked to steps by filename.

# 7. Preview and Playback

Features during Preview:
- Current highlight: active element is highlighted in bold.
- Visited trail: previously visited elements and flows are shown with a lighter stroke; arrowheads are reduced in size for clarity.
- Sticky final highlight: when a path ends (EndEvent or no next step), the final element remains highlighted until you press Next/Run.
- Popup descriptions: step descriptions appear as a pop‑up overlay.
- Audio: if a step has audio, it plays; otherwise duration is used.
- Gateways: when multiple outgoing paths are possible, you are asked to choose a path; the app computes reachability to find the next relevant step.
- Continuous run: “Run Continuous” traverses the process automatically, pausing only for gateway choices.

Controls during Preview:
- Next Step: advance to the next step (or start at step 1 if none selected). Clears sticky highlight before advancing.
- Stop: cancel the preview and clear transient UI (visited trail persists until reset).

# 8. Export Standalone HTML

“Export Standalone” produces a single HTML file with:
- Embedded BPMN viewer, styles, and fonts.
- Embedded audio per step (base64).
- Interactive branching at gateways with the same logic as the editor.
- Persistent visited trails and sticky final highlight; arrowheads reduced to 1/3 on visited flows.
- Light mode forced for printability; enhanced connector visibility for dark environments.

Usage: open the HTML in any modern browser; the same Preview UI (Next / Run Continuous / choices / zoom) is available.

# 9. Keyboard Shortcuts

- Undo: Ctrl/Cmd + Z
- Redo: Ctrl/Cmd + Shift + Z

# 10. Tips and Best Practices

- Start with StartEvent → Task(s) → Gateway(s) → EndEvent. Keep flows unambiguous.
- Add steps only for elements you want narrated or highlighted in sequence.
- Provide short, clear descriptions for popups; keep audio aligned with step durations.
- Use Fit zoom before preview to see the whole flow.
- For gateway choices, label outgoing targets in BPMN so the choice list shows friendly names.

# 11. Troubleshooting

- I only see the Electron skeleton menu after install: ensure you installed the latest MSI. If building yourself, verify Electron loads dist/index.html in production and Vite base is './'.
- Audio doesn’t play: confirm microphone permissions and that audio files exist in the project’s audio folder.
- Exported HTML looks dark: the export forces light mode; check your browser’s color scheme settings.

# 12. Generate this Manual as PDF

Option A (recommended, no repo changes):

1) From the repo root, run:

```
npx md-to-pdf docs/user-manual.md
```

2) The PDF will be generated as `docs/user-manual.pdf`.

Option B (VS Code):
- Open `docs/user-manual.md` → Command Palette → “Markdown: Print to PDF”.

Option C (Browser):
- View the Markdown rendered (e.g., on GitHub) → print → Save as PDF.

# 13. Version

- App: 0.1.0
- Manual: 0.1.0
