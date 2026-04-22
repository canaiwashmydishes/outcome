/**
 * Cloud Functions entry point (v6.0, Build B2).
 *
 * Build B2 surface:
 *   Auth:
 *     - beforeCreate, ensureUserProfile
 *   Deals:
 *     - createDeal, archiveDeal
 *     - initiateDocumentUpload, finalizeDocumentUpload
 *     - processDocument (HTTP, Cloud Tasks worker)
 *     - sweepIngestionStatus (scheduled)
 *   Teams:
 *     - createTeam, inviteMember, acceptInvite, revokeInvite,
 *       changeMemberRole, removeMember
 *   Integrations (B2):
 *     - connectProvider, oauthCallback (HTTP)
 *     - disconnectProvider, listProviderFolder
 *     - initiateImport, importOrchestrator (HTTP, Cloud Tasks worker)
 *     - requestVdrAccess
 */

export { beforeCreate, ensureUserProfile } from './auth/onUserCreate.js';

export { createDeal } from './deals/createDeal.js';
export { archiveDeal } from './deals/archiveDeal.js';
export { initiateDocumentUpload } from './deals/initiateDocumentUpload.js';
export { finalizeDocumentUpload } from './deals/finalizeDocumentUpload.js';
export { processDocument } from './deals/processDocument.js';
export { sweepIngestionStatus } from './deals/sweepIngestionStatus.js';

export { createTeam } from './teams/createTeam.js';
export { inviteMember } from './teams/inviteMember.js';
export { acceptInvite } from './teams/acceptInvite.js';
export { revokeInvite } from './teams/revokeInvite.js';
export { changeMemberRole } from './teams/changeMemberRole.js';
export { removeMember } from './teams/removeMember.js';

export { connectProvider } from './integrations/connectProvider.js';
export { oauthCallback } from './integrations/oauthCallback.js';
export { disconnectProvider } from './integrations/disconnectProvider.js';
export { listProviderFolder } from './integrations/listProviderFolder.js';
export { initiateImport } from './integrations/initiateImport.js';
export { importOrchestrator } from './integrations/importOrchestrator.js';
export { requestVdrAccess } from './integrations/requestVdrAccess.js';
