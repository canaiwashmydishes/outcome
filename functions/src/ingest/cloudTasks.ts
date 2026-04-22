import { CloudTasksClient, protos } from '@google-cloud/tasks';
import { logger } from 'firebase-functions/v2';
import { getIngestConfig } from '../lib/ingestConfig.js';

/**
 * Cloud Tasks wrapper.
 *
 * One task per document. Each task is an HTTP request to our
 * processDocument function, carrying a JSON body with
 * `{dealId, documentId}`. Cloud Tasks handles retries (with backoff),
 * concurrency capping, and rate-limiting — we don't need to build any
 * of that ourselves.
 *
 * The OIDC token ensures only Cloud Tasks itself can invoke the
 * processDocument endpoint.
 */

let _client: CloudTasksClient | null = null;
function getClient(): CloudTasksClient {
  if (!_client) _client = new CloudTasksClient();
  return _client;
}

export interface EnqueueDocumentPayload {
  dealId: string;
  documentId: string;
}

export async function enqueueDocumentProcessing(
  payload: EnqueueDocumentPayload
): Promise<void> {
  const cfg = getIngestConfig();
  const client = getClient();

  const queuePath = client.queuePath(
    cfg.projectId,
    cfg.cloudTasks.location,
    cfg.cloudTasks.queue
  );

  const task: protos.google.cloud.tasks.v2.ITask = {
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: cfg.cloudTasks.processDocumentUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      oidcToken: {
        serviceAccountEmail: cfg.cloudTasks.invokerServiceAccount,
      },
    },
    // Give each task a generous deadline — OCR + classification on a
    // large doc can legitimately take 2 minutes.
    dispatchDeadline: { seconds: 240 },
  };

  try {
    await client.createTask({ parent: queuePath, task });
    logger.info('Document enqueued for processing', {
      dealId: payload.dealId,
      documentId: payload.documentId,
    });
  } catch (err) {
    logger.error('Failed to enqueue document', {
      err: String(err),
      dealId: payload.dealId,
      documentId: payload.documentId,
    });
    throw err;
  }
}

/**
 * Enqueue an import orchestrator task. One per import job — the task
 * handler paginates the provider and dispatches per-doc child tasks.
 */
export interface EnqueueImportOrchestratorPayload {
  dealId: string;
  importId: string;
}

export async function enqueueImportOrchestrator(
  payload: EnqueueImportOrchestratorPayload
): Promise<void> {
  const cfg = getIngestConfig();
  const client = getClient();

  const queuePath = client.queuePath(
    cfg.projectId,
    cfg.cloudTasks.location,
    cfg.cloudTasks.queue
  );

  const task: protos.google.cloud.tasks.v2.ITask = {
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: cfg.cloudTasks.importOrchestratorUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      oidcToken: {
        serviceAccountEmail: cfg.cloudTasks.invokerServiceAccount,
      },
    },
    // Orchestrator task can run for many minutes while walking large
    // subtrees; give it the Cloud Tasks maximum dispatch deadline.
    dispatchDeadline: { seconds: 1800 },
  };

  try {
    await client.createTask({ parent: queuePath, task });
    logger.info('Import orchestrator enqueued', {
      dealId: payload.dealId,
      importId: payload.importId,
    });
  } catch (err) {
    logger.error('Failed to enqueue import orchestrator', {
      err: String(err),
      dealId: payload.dealId,
      importId: payload.importId,
    });
    throw err;
  }
}
