 # Process Diagram Builder
 
 Desktop editor with web playback for animated BPMN processes with per-step audio.
 
 - Desktop: Electron + React + bpmn-js (modeler) with mic recording
 - Player: React + bpmn-js (viewer) with step-by-step animation
 - Storage: Local project folder (diagram.bpmn, manifest.json, audio/*)
 - Export: HTML/JSON bundle for local hosting
 
 Workspaces:
 - apps/desktop
 - apps/player
 - packages/core