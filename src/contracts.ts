import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

import documentRecordSchema from "../contracts/cultnet.document-record.schema.json";
import helloSchema from "../contracts/cultnet.hello.schema.json";
import loginSchema from "../contracts/cultnet.login.schema.json";
import registerSchema from "../contracts/cultnet.register.schema.json";
import verifySchema from "../contracts/cultnet.verify.schema.json";
import loginSuccessSchema from "../contracts/cultnet.login-success.schema.json";
import errorSchema from "../contracts/cultnet.error.schema.json";
import documentPutSchema from "../contracts/cultnet.document-put.schema.json";
import documentDeleteSchema from "../contracts/cultnet.document-delete.schema.json";
import snapshotRequestSchema from "../contracts/cultnet.snapshot-request.schema.json";
import snapshotResponseSchema from "../contracts/cultnet.snapshot-response.schema.json";
import ghostlightAgentStateSchema from "../contracts/ghostlight.agent-state.schema.json";

export type CultNetSchemaVersion =
  | "cultnet.hello.v0"
  | "cultnet.login.v0"
  | "cultnet.register.v0"
  | "cultnet.verify.v0"
  | "cultnet.login_success.v0"
  | "cultnet.error.v0"
  | "cultnet.document_put.v0"
  | "cultnet.document_delete.v0"
  | "cultnet.snapshot_request.v0"
  | "cultnet.snapshot_response.v0";

export interface CultNetDocumentRecord<TPayload = unknown> {
  documentType: string;
  documentKey: string;
  storedAt: string;
  payloadSchemaVersion?: string;
  payload: TPayload;
  sourceRuntimeId?: string;
  sourceAgentId?: string;
  sourceRole?: string;
  tags?: string[];
}

export interface CultNetHelloMessage {
  schemaVersion: "cultnet.hello.v0";
  runtimeId: string;
  runtimeKind: string;
  agentId?: string;
  role?: string;
  displayName?: string;
  supportedDocumentTypes?: string[];
  supportedMessageVersions?: string[];
}

export interface CultNetLoginMessage {
  schemaVersion: "cultnet.login.v0";
  nonce: string;
  auth: string;
  password: string;
}

export interface CultNetRegisterMessage {
  schemaVersion: "cultnet.register.v0";
  nonce: string;
  email: string;
  password: string;
  name: string;
}

export interface CultNetVerifyMessage {
  schemaVersion: "cultnet.verify.v0";
  nonce: string;
  session: string;
}

export interface CultNetLoginSuccessMessage {
  schemaVersion: "cultnet.login_success.v0";
  nonce: string;
  session: string;
}

export interface CultNetErrorMessage {
  schemaVersion: "cultnet.error.v0";
  error: string;
}

export interface CultNetDocumentPutMessage<TPayload = unknown> {
  schemaVersion: "cultnet.document_put.v0";
  messageId: string;
  document: CultNetDocumentRecord<TPayload>;
}

export interface CultNetDocumentDeleteMessage {
  schemaVersion: "cultnet.document_delete.v0";
  messageId: string;
  documentType: string;
  documentKey: string;
}

export interface CultNetSnapshotRequestMessage {
  schemaVersion: "cultnet.snapshot_request.v0";
  messageId: string;
  documentTypes?: string[];
  documentKeys?: string[];
}

export interface CultNetSnapshotResponseMessage<TPayload = unknown> {
  schemaVersion: "cultnet.snapshot_response.v0";
  messageId: string;
  documents: CultNetDocumentRecord<TPayload>[];
}

export interface GhostlightPressure {
  pressure_id: string;
  label: string;
  intensity: number;
}

export interface GhostlightWorldTime {
  label: string;
  [key: string]: unknown;
}

export interface GhostlightWorldState {
  world_id: string;
  setting: string;
  time: GhostlightWorldTime;
  canon_context: string[];
  ambient_pressures?: GhostlightPressure[];
}

export interface GhostlightIdentity {
  name: string;
  roles: string[];
  origin: string;
  public_description: string;
  private_notes?: string[];
}

export interface GhostlightStateVariable {
  mean: number;
  plasticity: number;
  current_activation: number;
  evidence?: string[];
}

export type GhostlightVariableMap = Record<string, GhostlightStateVariable>;

export interface GhostlightInferredStateVariable {
  observed_activation: number;
  attributed_disposition: number;
  confidence: number;
  evidence?: string[];
}

export type GhostlightInferredVariableMap = Record<string, GhostlightInferredStateVariable>;

export interface GhostlightValueCommitment {
  value_id: string;
  label: string;
  priority: number;
  unforgivable_if_betrayed: boolean;
}

export type GhostlightGoalScope = "immediate" | "scene" | "case" | "arc" | "life";
export type GhostlightGoalStatus = "active" | "blocked" | "dormant" | "resolved" | "abandoned";

export interface GhostlightGoal {
  goal_id: string;
  description: string;
  scope: GhostlightGoalScope;
  priority: number;
  emotional_stake: string;
  blockers?: string[];
  status: GhostlightGoalStatus;
}

export interface GhostlightMemory {
  memory_id: string;
  summary: string;
  salience: number;
  confidence: number;
  linked_event_ids?: string[];
  linked_relationship_id?: string;
}

export interface GhostlightMemoryBundle {
  episodic: GhostlightMemory[];
  semantic: GhostlightMemory[];
  relationship_summaries: GhostlightMemory[];
}

export interface GhostlightCanonicalState {
  underlying_organization: GhostlightVariableMap;
  stable_dispositions: GhostlightVariableMap;
  behavioral_dimensions: GhostlightVariableMap;
  presentation_strategy: GhostlightVariableMap;
  voice_style: GhostlightVariableMap;
  situational_state: GhostlightVariableMap;
  values: GhostlightValueCommitment[];
}

export type GhostlightBeliefClaimType =
  | "fact"
  | "identity_inference"
  | "motive_inference"
  | "prediction"
  | "norm"
  | "value_read"
  | "relationship_read";

export type GhostlightBeliefVisibility = "private" | "shared" | "public" | "rumor";

export interface GhostlightBelief {
  belief_id: string;
  claim: string;
  confidence: number;
  subject_id?: string;
  claim_type?: GhostlightBeliefClaimType;
  evidence_event_ids?: string[];
  visibility?: GhostlightBeliefVisibility;
  emotional_charge?: number;
}

export type GhostlightPerceivedDistortion =
  | "hostile_attribution"
  | "false_reassurance"
  | "overread_warmth"
  | "underread_threat"
  | "false_mask_detection"
  | "missed_mask_detection"
  | "status_injury"
  | "threat_amplification"
  | "institutional_suspicion_transfer"
  | "care_underread"
  | "mask_overfocus";

export interface GhostlightPerceivedStateOverlay {
  observer_agent_id: string;
  target_agent_id: string;
  perceived_dimensions: GhostlightInferredVariableMap;
  beliefs: GhostlightBelief[];
  distortions: GhostlightPerceivedDistortion[];
}

export interface GhostlightAgent {
  agent_id: string;
  identity: GhostlightIdentity;
  canonical_state: GhostlightCanonicalState;
  goals: GhostlightGoal[];
  memories: GhostlightMemoryBundle;
  perceived_state_overlays: GhostlightPerceivedStateOverlay[];
}

export interface GhostlightRelationship {
  relationship_id: string;
  source_id: string;
  target_id: string;
  stance: GhostlightVariableMap;
  summary: string;
  unresolved_incident_ids?: string[];
}

export type GhostlightEventKind =
  | "dialogue"
  | "action"
  | "memory"
  | "relationship_shift"
  | "scene_outcome"
  | "author_note";

export interface GhostlightEventExchangeTurn {
  speaker_id: string;
  utterance_summary: string;
  dialogue_function: string;
  observable_cues?: string[];
}

export interface GhostlightEventPrivateInterpretation {
  agent_id: string;
  interpretation: string;
  attributed_motive?: string;
  appraisal_tags?: string[];
  confidence: number;
}

export interface GhostlightStateDelta {
  path: string;
  delta: number;
}

export interface GhostlightEventEffect {
  agent_id: string;
  summary: string;
  state_deltas?: GhostlightStateDelta[];
  new_belief_ids?: string[];
  memory_update_ids?: string[];
}

export interface GhostlightEvent {
  event_id: string;
  kind: GhostlightEventKind;
  summary: string;
  participants: string[];
  pressure_tags: string[];
  observed_exchange?: GhostlightEventExchangeTurn[];
  private_interpretations?: GhostlightEventPrivateInterpretation[];
  event_effects?: GhostlightEventEffect[];
}

export interface GhostlightDialogueContextPack {
  speaker_agent_id: string;
  listener_ids: string[];
  speaker_local_truth: string[];
  speaker_beliefs: string[];
  active_memories: string[];
  active_goals: string[];
  presentation_constraints: string[];
}

export interface GhostlightScene {
  scene_id: string;
  location: string;
  participants: string[];
  public_stakes: string[];
  hidden_stakes: string[];
  dialogue_context_packs: GhostlightDialogueContextPack[];
}

export interface GhostlightAgentStateDocument {
  schema_version: "ghostlight.agent_state.v0";
  world: GhostlightWorldState;
  agents: GhostlightAgent[];
  relationships: GhostlightRelationship[];
  events: GhostlightEvent[];
  scenes: GhostlightScene[];
}

export type CultNetMessage =
  | CultNetHelloMessage
  | CultNetLoginMessage
  | CultNetRegisterMessage
  | CultNetVerifyMessage
  | CultNetLoginSuccessMessage
  | CultNetErrorMessage
  | CultNetDocumentPutMessage
  | CultNetDocumentDeleteMessage
  | CultNetSnapshotRequestMessage
  | CultNetSnapshotResponseMessage;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const CULTNET_MESSAGE_SCHEMAS = [
  helloSchema,
  loginSchema,
  registerSchema,
  verifySchema,
  loginSuccessSchema,
  errorSchema,
  documentPutSchema,
  documentDeleteSchema,
  snapshotRequestSchema,
  snapshotResponseSchema,
] as const;

const cultNetValidators = new Map<CultNetSchemaVersion, ValidateFunction>();
for (const schema of [documentRecordSchema, ...CULTNET_MESSAGE_SCHEMAS]) {
  ajv.addSchema(schema);
}

for (const schema of CULTNET_MESSAGE_SCHEMAS) {
  const schemaVersion = schema.properties.schemaVersion.const as CultNetSchemaVersion;
  cultNetValidators.set(schemaVersion, ajv.compile(schema));
}

const ghostlightAgentStateValidator = ajv.compile(ghostlightAgentStateSchema);

export function parseCultNetMessage(input: unknown): CultNetMessage {
  if (!input || typeof input !== "object") {
    throw new Error("CultNet message must be an object.");
  }

  const schemaVersion = (input as { schemaVersion?: string }).schemaVersion as CultNetSchemaVersion | undefined;
  if (!schemaVersion) {
    throw new Error("CultNet message is missing schemaVersion.");
  }

  const validator = cultNetValidators.get(schemaVersion);
  if (!validator) {
    throw new Error(`Unsupported CultNet schemaVersion "${schemaVersion}".`);
  }

  if (!validator(input)) {
    throw new Error(renderValidationErrors(schemaVersion, validator));
  }

  return input as CultNetMessage;
}

export function validateGhostlightAgentState(input: unknown): GhostlightAgentStateDocument {
  if (!ghostlightAgentStateValidator(input)) {
    throw new Error(renderValidationErrors("ghostlight.agent_state.v0", ghostlightAgentStateValidator));
  }

  return input as unknown as GhostlightAgentStateDocument;
}

function renderValidationErrors(schemaVersion: string, validator: ValidateFunction): string {
  const details = validator.errors?.map((error) => {
    const location = error.instancePath.length > 0 ? error.instancePath : "/";
    return `${location}: ${error.message}`;
  }) ?? ["unknown validation failure"];
  return `Validation failed for ${schemaVersion}: ${details.join("; ")}`;
}

export const cultNetSchemas = {
  helloSchema,
  loginSchema,
  registerSchema,
  verifySchema,
  loginSuccessSchema,
  errorSchema,
  documentPutSchema,
  documentDeleteSchema,
  snapshotRequestSchema,
  snapshotResponseSchema,
  ghostlightAgentStateSchema,
} as const;
