// Shapes of the data the API sends. Engine data (cases, forms, rules) keeps the engine's camelCase keys.
// Big engine objects are typed loosely (Dict) on purpose: the engine is the source of truth for them,
// and React only reads the few keys it displays.

export type Dict = Record<string, any>;

export interface Person { id: string; name: string; role: string; roleLabel: string; title: string; unit: string }

export interface Bootstrap {
  people: Person[];
  rules: Dict;
  stageLabels: Record<string, string>;
  tierLabels: Record<string, string>;
  roleLabels: Record<string, string>;
  stages: string[];
  formFields: { k: string; label: string }[];
  toolStatus: Record<string, string>;
  scopeOpts: { id: string; label: string }[];
  autonomyOpts: { id: string; label: string }[];
  ongoingBasis: Record<string, string>;
  ctlStatus: Record<string, string>;
  questionOptions: Record<string, { id: string; label: string }[]>;
}

/** One input in an action dialog, as the engine's actions_for describes it. */
export interface Field {
  name: string;
  type: string; // text, textarea, select, number, checks, hidden, note, measures, overrides, support, panelnotes, smetable, stkblock
  label?: string;
  value?: any;
  required?: boolean;
  options?: Dict[];
  tab?: string;
  sec?: string;
  secTitle?: string;
  [k: string]: any;
}

/** Something a person can do now, from the engine's actions_for. */
export interface Action {
  id: string;
  label: string;
  tone: string;
  fields: Field[];
  intro?: string;
  inline?: boolean;
  form?: boolean;
  tabs?: [string, string][];
  defaultTab?: string;
  confirmLabel?: string;
  disabled?: boolean;
  why?: string;
  blockedMsg?: string;
  evidenceId?: string;
}

export interface CaseRow {
  id: string; title: string; submitterId: string; ownerId?: string; adviserId?: string;
  stage: string; stageLabel: string; tier?: string; tierLabel: string; returned: boolean;
  dueAt?: number; late: boolean; stageSince?: number;
  gaps: { gates: number; newStops: number; other: number };
  stopFlags: string[]; acceptanceExpired: boolean; notPermitted: boolean;
}

export interface QueueItem extends CaseRow { why: string; actions: string[]; readyToFinalize: boolean; deadlock: boolean }

export interface CaseDetail {
  case: Dict;
  row: CaseRow;
  actions: Action[];
  editable: boolean;
  waitingOn: string[];
  scoring: Dict | null;
  support: Dict;
  measures: Dict[];
  stopFlags: string[];
  consultNeeds: Dict;
  review: Dict | null;
  roi: Dict;
  budgetFlag: Dict | null;
  auditCheck: { ok: boolean; entries: number; [k: string]: any };
}

export interface Mail { ts: number; n?: number; to: string[]; subject: string; body: string; kind?: string; ref: { id: string; title: string } }
