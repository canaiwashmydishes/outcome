/**
 * Data Model (v6.0)
 *
 * Type definitions for every Firestore document in the v6.0 schema.
 * This is the contract between web, functions, and Cloud Run services.
 *
 * Firestore Timestamp is represented as `unknown` so both the web SDK
 * and admin SDK can stamp their own Timestamp type at boundaries.
 *
 * Conventions:
 *   - All documents carry `createdAt` and `updatedAt`.
 *   - IDs are URL-safe: ^[a-zA-Z0-9_\-]{1,128}$.
 *   - Fields that are populated by later phases are marked optional.
 */

import type { SubscriptionTier, Workstream, ScenarioTier } from './subscriptions.js';
import type { StressTestId } from './stressTests.js';

// ============================================================================
// Users and Teams
// ============================================================================

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  /** The user's primary team. Every user has at least a personal team. */
  primaryTeamId: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type TeamMemberRole =
  | 'partner'
  | 'associate'
  | 'external_counsel'
  | 'consultant'
  | 'observer';

export interface Team {
  id?: string;
  name: string;
  billingEmail: string;
  ownerId: string;
  stripeCustomerId?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface TeamMember {
  /** uid of the member. */
  uid: string;
  role: TeamMemberRole;
  invitedBy: string;
  invitedAt: unknown;
  joinedAt?: unknown;
  status: 'invited' | 'active' | 'suspended';
}

/**
 * A pending invitation to a team. Lives at teams/{teamId}/invitations/{invitationId}.
 * Created by `inviteMember`, consumed by `acceptInvite`.
 *
 * Invitation tokens are opaque 32-char ids used as the document id, so the
 * invite link is simply /invite/{invitationId}. We do not sign tokens
 * because acceptInvite requires an authenticated user whose email matches
 * the invite target, which is the access control.
 */
export interface Invitation {
  id?: string;
  teamId: string;
  /** Email the invite was sent to. Match enforced at accept-time. */
  email: string;
  role: TeamMemberRole;
  invitedBy: string; // uid
  invitedByEmail: string;
  invitedAt: unknown;
  /** Epoch ms expiry. Default 14 days from creation. */
  expiresAt: number;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  acceptedBy?: string;
  acceptedAt?: unknown;
  revokedAt?: unknown;
}

export interface Subscription {
  id?: string;
  teamId: string;
  tier: SubscriptionTier;
  stripeSubscriptionId?: string;
  dealsIncluded: number | null; // null = unlimited
  dealsUsedThisYear: number;
  seatsMax: number | null;
  anniversaryDate: number; // epoch ms — resets dealsUsedThisYear
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  createdAt: unknown;
  updatedAt: unknown;
}

// ============================================================================
// Integrations (Build B2)
// ============================================================================

/**
 * Providers that can be connected for data-room import.
 *
 * Cloud storage providers (gdrive, sharepoint, dropbox) are live in Build B2.
 * VDR providers (intralinks, datasite, firmex) have placeholder UI in B2 and
 * are implemented in Build B2.5 once partner access is in place.
 */
export type IntegrationProvider =
  | 'gdrive'
  | 'sharepoint'
  | 'dropbox'
  | 'intralinks'
  | 'datasite'
  | 'firmex';

export type IntegrationCategory = 'cloud_storage' | 'vdr';

export type IntegrationStatus =
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'error';

/**
 * Per-user integration connection. Lives at `users/{uid}/integrations/{provider}`.
 *
 * Token storage note (Build G hardening target): access/refresh tokens sit
 * in Firestore under strict rules (user can read own; server can write). In
 * Build G we migrate to Google Secret Manager with per-user keys.
 */
export interface Integration {
  id?: string;
  uid: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** Display name returned by the provider (email, username). */
  accountLabel?: string;
  /** Encrypted or raw access token. Present only when status = 'connected'. */
  accessToken?: string;
  /** Encrypted or raw refresh token. Present for providers that issue them. */
  refreshToken?: string;
  /** Epoch ms when accessToken expires. */
  accessTokenExpiresAt?: number;
  /** Scopes granted on the last auth. */
  scopes?: string[];
  /** Last error message if status = 'error' or 'expired'. */
  lastError?: string;
  connectedAt?: unknown;
  disconnectedAt?: unknown;
  updatedAt: unknown;
}

/**
 * A browsable file/folder surfaced by a provider adapter. Used by the
 * ProviderBrowser modal; not persisted.
 */
export interface ProviderItem {
  id: string; // provider-native id or path
  name: string;
  kind: 'folder' | 'file';
  mimeType?: string;
  sizeBytes?: number;
  /** For folders only — convenience child count if the provider exposes it. */
  childCount?: number;
  /** Provider-specific breadcrumb/path string for display. */
  displayPath?: string;
}

/**
 * Orchestrator task state. One row per import job — a user picked a folder
 * in a provider and told us to bring it in. Lives at
 * `deals/{dealId}/imports/{importId}`.
 */
export type IntegrationImportStatus =
  | 'queued'
  | 'listing'
  | 'dispatching'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface IntegrationImport {
  id?: string;
  dealId: string;
  provider: IntegrationProvider;
  initiatedBy: string;
  /** The folder the user selected — provider-native id or path. */
  rootItemId: string;
  rootItemName: string;
  status: IntegrationImportStatus;
  totalFilesDiscovered: number;
  totalFilesDispatched: number;
  failureReason?: string;
  startedAt: unknown;
  completedAt?: unknown;
}

/**
 * VDR access request. Written by requestVdrAccess; admin UI picks these up
 * in Build H. Lives at `vdrAccessRequests/{id}`.
 */
export interface VdrAccessRequest {
  id?: string;
  uid: string;
  email: string;
  teamId: string;
  provider: 'intralinks' | 'datasite' | 'firmex';
  note?: string;
  status: 'open' | 'contacted' | 'provisioned' | 'dismissed';
  requestedAt: unknown;
}

// ============================================================================
// Deals
// ============================================================================

export type DealStructure =
  | 'asset_purchase'
  | 'stock_purchase'
  | 'merger'
  | 'carve_out'
  | 'recapitalization'
  | 'minority_investment'
  | 'other';

export type PhaseName =
  | 'ingestion'
  | 'research'
  | 'extraction'
  | 'detection'
  | 'followup'
  | 'scenario'
  | 'synthesis_export';

export type PhaseStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface DealMeta {
  name: string;
  targetCompany: string;
  sector: string;
  sizeUSD: number | null;
  structure: DealStructure;
  geography: string;
  expectedCloseDate?: string; // ISO date
  /**
   * Free-form notes about the team's risk appetite for this deal. Feeds
   * into Phase 2 (Contextual Research) so Claude Opus can bias severity
   * thresholds toward the team's posture.
   */
  riskAppetiteNotes?: string;
}

export interface Deal {
  id?: string;
  teamId: string;
  createdBy: string;
  meta: DealMeta;
  /** Which of the seven phases are at what status. */
  phaseStatus: Record<PhaseName, PhaseStatus>;
  /** Output of Phase 2 — what rules and workstreams are active for this deal. */
  contextMap?: Record<string, unknown>;
  activeWorkstreams?: Workstream[];
  activeRules?: Array<{ ruleId: string; version: number }>;
  complexityEstimate?: ScenarioTier;
  /** When set, the deal is hidden from default views. The quota consumed at
   *  creation is NOT refunded — annual deals are annual commitments. */
  archivedAt?: unknown;
  archivedBy?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

// ============================================================================
// Documents (Phase 1 output)
// ============================================================================

export type DocumentSourceChannel =
  | 'manual_upload'
  | 'sharepoint'
  | 'gdrive'
  | 'dropbox'
  | 'intralinks'
  | 'datasite'
  | 'firmex';

/**
 * Per-document lifecycle:
 *   queued       — doc row created, upload URL issued, awaiting client upload
 *   uploaded     — client confirmed upload, Cloud Task enqueued
 *   ocr_in_progress — Document AI batch in flight
 *   classifying  — OCR done, Claude Sonnet call in flight
 *   completed    — terminal, ready for Phase 2 consumption
 *   failed       — terminal (with failureReason); does not block Phase 1 completion
 *   skipped_duplicate — deduped against an earlier doc (see `duplicateOf`)
 */
export type DocumentStatus =
  | 'queued'
  | 'uploaded'
  | 'ocr_in_progress'
  | 'classifying'
  | 'completed'
  | 'failed'
  | 'skipped_duplicate';

export interface DealDocument {
  id?: string;
  dealId: string;
  name: string;
  storagePath: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  pages: number;
  sourceChannel: DocumentSourceChannel;
  /** Status of this doc through the Phase 1 pipeline. */
  status: DocumentStatus;
  /** Populated when status = 'failed'. Human-readable reason. */
  failureReason?: string;
  /** Folder path from drag-and-drop (e.g. "01_Legal/Material Contracts"). */
  folderPath?: string;
  /** Classifier output — the workstream this document belongs to. */
  workstream?: Workstream;
  /** Classifier confidence score 0.0–1.0. */
  classifierConfidence?: number;
  /** Classifier's one-line rationale for the workstream choice. */
  classifierRationale?: string;
  /** OCR text, stored only when small enough; otherwise refers to storage. */
  ocrText?: string;
  ocrStoragePath?: string;
  /** Duplicate of another doc by hash — link to canonical. */
  duplicateOf?: string;
  uploadedBy: string;
  createdAt: unknown;
  uploadedAt?: unknown;
  processedAt?: unknown;
}

// ============================================================================
// Issues (Phase 3 output — pre-flag candidates)
// ============================================================================

export interface IssueCitation {
  documentId: string;
  pageNum: number;
  clauseRef?: string;
  snippet: string;
}

export interface Issue {
  id?: string;
  dealId: string;
  workstream: Workstream;
  title: string;
  description: string;
  sourceDocuments: IssueCitation[];
  confidence: number;
  extractorVersion: string;
  extractedAt: unknown;
}

// ============================================================================
// Findings (Phase 4 output — materialized red flags)
// ============================================================================

export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DealImpactTag =
  | 'price_chip'
  | 'escrow'
  | 'indemnity'
  | 'confirmatory_diligence'
  | 'integration_plan'
  | 'walk_away';

export type FindingStatus =
  | 'open'
  | 'under_review'
  | 'resolved'
  | 'needs_seller_response'
  | 'dismissed';

export interface QuantifiedImpact {
  /** Basis-point impact on the headline metric (EBITDA, valuation). */
  basisPoints?: number;
  /** Dollar amount of impact. */
  dollarImpact?: number;
  /** The headline metric impacted. */
  metric?: string;
  /** 0.0–1.0 confidence in the quantified impact. */
  confidence?: number;
  /** Source scenario id. */
  scenarioId?: string;
  /** Optional range expression (e.g. "12% to 18%"). */
  rangeExpression?: string;
}

export interface Finding {
  id?: string;
  dealId: string;
  workstream: Workstream;
  title: string;
  description: string;
  rationale: string;
  sourceDocuments: IssueCitation[];
  confidenceScore: number;
  modelVersion: string;
  ruleVersion?: string;
  severity: FindingSeverity;
  likelihood: number;
  dealImpactTag: DealImpactTag;
  status: FindingStatus;
  owner?: string; // uid
  quantifiedImpact?: QuantifiedImpact;
  detectedAt: unknown;
  updatedAt: unknown;
}

// ============================================================================
// Follow-up requests (Phase 5 output)
// ============================================================================

export type FollowupStatus = 'draft' | 'sent' | 'received' | 'closed';

export interface Followup {
  id?: string;
  dealId: string;
  workstream: Workstream;
  priority: 1 | 2 | 3;
  text: string;
  linkedFindingIds: string[];
  sellerDueDate?: string;
  status: FollowupStatus;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

// ============================================================================
// Scenarios (Phase 6 output — Claude-native swarm)
// ============================================================================

export interface ScenarioPersona {
  id: string;
  name: string;
  role: string;
  archetype: string;
  persona: string;
  traits: string[];
  preferences: string;
  influence?: number;
}

export interface Scenario {
  id?: string;
  dealId: string;
  findingId: string;
  tier: ScenarioTier;
  personaCount: number;
  stressTestType: StressTestId;
  agents?: ScenarioPersona[];
  swarmProgress?: number;
  convergenceData?: unknown;
  quantifiedImpact?: QuantifiedImpact;
  report?: string;
  runStatus: 'queued' | 'running' | 'completed' | 'failed';
  failureReason?: string;
  startedBy: string;
  startedAt: unknown;
  completedAt?: unknown;
}

// ============================================================================
// Exports (Phase 7 output)
// ============================================================================

export type ExportType =
  | 'ic_memo'
  | 'top_10_pack'
  | 'unresolved_tracker'
  | 'valuation_implications'
  | 'integration_implications'
  | 'followup_list'
  | 'deal_summary';

export type ExportFormat = 'pdf' | 'docx' | 'xlsx';

export interface Export {
  id?: string;
  dealId: string;
  type: ExportType;
  format: ExportFormat;
  storagePath: string;
  version: number;
  generatedBy: string;
  generatedAt: unknown;
  /** Hash of the audit log state at export time — for tamper detection. */
  auditHashAtGeneration: string;
}

// ============================================================================
// Deal-scoped chat (replaces v5.0 Oracle)
// ============================================================================

export interface DealMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  author?: string; // uid of author for user messages
  createdAt: unknown;
}

// ============================================================================
// Audit log — immutable, write-once
// ============================================================================

export type AuditEventType =
  | 'deal_created'
  | 'deal_archived'
  | 'deal_restored'
  | 'document_uploaded'
  | 'document_viewed'
  | 'document_reprocessed'
  | 'document_failed'
  | 'ingestion_started'
  | 'ingestion_completed'
  | 'integration_connected'
  | 'integration_disconnected'
  | 'integration_token_refreshed'
  | 'integration_error'
  | 'import_initiated'
  | 'import_completed'
  | 'import_failed'
  | 'vdr_access_requested'
  | 'finding_created'
  | 'finding_status_changed'
  | 'finding_owner_assigned'
  | 'finding_severity_changed'
  | 'finding_impact_tag_changed'
  | 'finding_dismissed'
  | 'followup_sent'
  | 'scenario_run'
  | 'export_generated'
  | 'team_created'
  | 'member_invited'
  | 'member_invite_revoked'
  | 'member_invite_accepted'
  | 'member_role_changed'
  | 'member_removed';

export interface AuditEvent {
  id?: string;
  dealId?: string;
  teamId: string;
  actorId: string;
  actorRole: TeamMemberRole | 'system';
  eventType: AuditEventType;
  targetType?: 'deal' | 'document' | 'finding' | 'followup' | 'scenario' | 'export' | 'member' | 'team' | 'invitation' | 'integration' | 'import' | 'vdr_access_request';
  targetId?: string;
  /** Serialized diff — {before, after} snapshot. */
  diff?: { before?: unknown; after?: unknown };
  rationale?: string; // required for dismissals
  ipAddress?: string;
  sessionId?: string;
  timestamp: unknown;
}

// ============================================================================
// Entitlement error
// ============================================================================

export class QuotaExceededError extends Error {
  readonly code = 'quota-exceeded';
  constructor(
    public quota: 'deals_per_year' | 'seats' | 'scenario_personas' | 'workstream_not_included',
    public detail: string
  ) {
    super(`Quota exceeded: ${quota} — ${detail}`);
  }
}

// ============================================================================
// Request / response shapes for Cloud Functions callables
// ============================================================================

export interface CreateDealRequest {
  meta: DealMeta;
  /** Optional — falls back to caller's primary team. */
  teamId?: string;
}

export interface CreateDealResponse {
  ok: boolean;
  dealId: string;
}

export interface ArchiveDealRequest {
  dealId: string;
}

export interface ArchiveDealResponse {
  ok: boolean;
}

export interface CreateTeamRequest {
  name: string;
  billingEmail: string;
}

export interface CreateTeamResponse {
  ok: boolean;
  teamId: string;
}

export interface InviteMemberRequest {
  teamId: string;
  email: string;
  role: TeamMemberRole;
}

export interface InviteMemberResponse {
  ok: boolean;
  invitationId: string;
  inviteLink: string;
}

export interface AcceptInviteRequest {
  invitationId: string;
}

export interface AcceptInviteResponse {
  ok: boolean;
  teamId: string;
}

export interface RevokeInviteRequest {
  teamId: string;
  invitationId: string;
}

export interface RevokeInviteResponse {
  ok: boolean;
}

export interface ChangeMemberRoleRequest {
  teamId: string;
  memberUid: string;
  role: TeamMemberRole;
}

export interface ChangeMemberRoleResponse {
  ok: boolean;
}

export interface RemoveMemberRequest {
  teamId: string;
  memberUid: string;
}

export interface RemoveMemberResponse {
  ok: boolean;
}

// ----- Build B: Document Ingestion -----

export interface InitiateDocumentUploadRequest {
  dealId: string;
  /** Original filename from the client. */
  name: string;
  /** Relative folder path from drag-and-drop (without the filename). Empty if top-level. */
  folderPath?: string;
  /** File size in bytes. Used to enforce upload ceiling. */
  sizeBytes: number;
  /** MIME type from client; server validates against an allow list. */
  mimeType: string;
  /** Client-computed SHA-256 of the file for dedup. */
  sha256: string;
}

export interface InitiateDocumentUploadResponse {
  ok: boolean;
  /**
   * - 'upload' — upload to the returned signed URL then call finalizeDocumentUpload.
   * - 'duplicate' — content is already ingested on this deal; no upload needed.
   *                documentId points to the canonical doc.
   */
  action: 'upload' | 'duplicate';
  documentId: string;
  uploadUrl?: string;
  uploadHeaders?: Record<string, string>;
  canonicalDocumentId?: string;
}

export interface FinalizeDocumentUploadRequest {
  dealId: string;
  documentId: string;
}

export interface FinalizeDocumentUploadResponse {
  ok: boolean;
}

// ----- Build B2: Integrations -----

export interface ConnectProviderRequest {
  provider: IntegrationProvider;
  /** Optional URL to return the user to after OAuth completes. */
  returnTo?: string;
}

export interface ConnectProviderResponse {
  ok: boolean;
  /** URL the client should redirect the user to for OAuth consent. */
  authorizationUrl: string;
  /** Opaque state value the client should hold for CSRF verification when
   *  the callback returns. */
  state: string;
}

export interface DisconnectProviderRequest {
  provider: IntegrationProvider;
}

export interface DisconnectProviderResponse {
  ok: boolean;
}

export interface ListProviderFolderRequest {
  provider: IntegrationProvider;
  /** Folder id/path; omit to list the provider's root. */
  folderId?: string;
}

export interface ListProviderFolderResponse {
  ok: boolean;
  items: ProviderItem[];
  /** Breadcrumb of the current location — last element is current folder. */
  breadcrumb: Array<{ id: string; name: string }>;
}

export interface InitiateImportRequest {
  dealId: string;
  provider: IntegrationProvider;
  /** The folder in the provider the user selected. */
  rootItemId: string;
  rootItemName: string;
}

export interface InitiateImportResponse {
  ok: boolean;
  importId: string;
}

export interface RequestVdrAccessRequest {
  provider: 'intralinks' | 'datasite' | 'firmex';
  note?: string;
}

export interface RequestVdrAccessResponse {
  ok: boolean;
}
