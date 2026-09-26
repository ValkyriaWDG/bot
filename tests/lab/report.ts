export interface LabCheck {
  label: string;
  passed: boolean;
  details: string;
}
export interface LabMessage {
  speaker: 'member' | 'bot' | 'system';
  displayName: string;
  content: string;
  command?: string;
  locale?: 'cs' | 'en';
  buttons?: string[];
}
export interface LabScenario {
  id: string;
  title: string;
  description: string;
  status: 'passed' | 'failed';
  checks: LabCheck[];
  messages: LabMessage[];
  observations: Record<string, unknown>;
}
export interface LabReport {
  schemaVersion: 1;
  evidenceKind: 'simulated-discord';
  generatedAt: string;
  sourceRevision: string;
  sourceDirty: boolean;
  environment: { database: string; discord: string; wardogs: string; website: string };
  scenarios: LabScenario[];
  summary: { total: number; passed: number; failed: number };
}
