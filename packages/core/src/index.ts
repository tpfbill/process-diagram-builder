 export type StepId = string;
 
 export interface StepMeta {
   id: StepId;
   label: string;
   description?: string;
   durationMs: number;
   bpmnElementId: string;
   audioFile?: string;
 }
 
 export interface ProjectManifest {
   schemaVersion: 1;
   name: string;
   createdAt: string;
   updatedAt: string;
   bpmnPath: string;
   steps: StepMeta[];
 }
 
 export const createEmptyManifest = (name: string): ProjectManifest => ({
   schemaVersion: 1,
   name,
   createdAt: new Date().toISOString(),
   updatedAt: new Date().toISOString(),
   bpmnPath: "diagram.bpmn",
   steps: []
 });
 
 export const updateTimestamp = (m: ProjectManifest): ProjectManifest => ({
   ...m,
   updatedAt: new Date().toISOString()
 });