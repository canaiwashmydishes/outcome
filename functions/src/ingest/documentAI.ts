import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { logger } from 'firebase-functions/v2';
import { getIngestConfig } from '../lib/ingestConfig.js';

/**
 * Google Document AI wrapper.
 *
 * Uses the batch (async) processor because:
 *   - Inline processing is capped at 30 pages per request.
 *   - Batch handles up to 500 pages and returns JSON to a GCS output path.
 *   - Batch works through long-running operations we can poll from Cloud
 *     Tasks without tying up a function invocation.
 *
 * For documents ≤30 pages we prefer the `processDocument` (sync) path —
 * faster and simpler. We make that choice per-document based on page count
 * (estimated from MIME type + file size for non-PDFs; exact page count
 * from PDF metadata read server-side when possible).
 */

export interface OcrResult {
  text: string;
  pageCount: number;
  /** Per-page text, indexed 1-based. Empty array if the processor didn't
   *  return page-level splits (e.g. plain text files where one page = whole). */
  pages: Array<{ pageNumber: number; text: string }>;
}

let _client: DocumentProcessorServiceClient | null = null;
function getClient(): DocumentProcessorServiceClient {
  if (!_client) _client = new DocumentProcessorServiceClient();
  return _client;
}

/**
 * Runs OCR on a single document using the sync processor. Suitable for
 * documents up to ~30 pages. Larger documents should use batchProcessOcr
 * which returns a long-running operation (not implemented in v1 — we
 * cap per-file size, and if a real 500+ page document shows up we'll
 * handle it in a follow-up build).
 *
 * `contentBase64` is the file bytes as base64 (what the Document AI API
 * expects inline).
 */
export async function processOcrSync(params: {
  contentBase64: string;
  mimeType: string;
}): Promise<OcrResult> {
  const cfg = getIngestConfig();
  const client = getClient();
  const name = `projects/${cfg.projectId}/locations/${cfg.documentAi.location}/processors/${cfg.documentAi.processorId}`;

  logger.info('Document AI sync OCR request', {
    processor: name,
    mimeType: params.mimeType,
    bytes: Math.floor((params.contentBase64.length * 3) / 4),
  });

  const [response] = await client.processDocument({
    name,
    rawDocument: {
      content: params.contentBase64,
      mimeType: params.mimeType,
    },
  });

  const doc = response.document;
  if (!doc) throw new Error('Document AI returned no document.');

  const text = doc.text ?? '';
  const pagesRaw = doc.pages ?? [];
  const pages: OcrResult['pages'] = pagesRaw.map((page, idx) => {
    // Reassemble per-page text by slicing textAnchors on the doc-level text.
    const segments = page.layout?.textAnchor?.textSegments ?? [];
    let pageText = '';
    for (const seg of segments) {
      const start = Number(seg.startIndex ?? 0);
      const end = Number(seg.endIndex ?? 0);
      if (end > start) pageText += text.slice(start, end);
    }
    return {
      pageNumber: page.pageNumber ?? idx + 1,
      text: pageText,
    };
  });

  return {
    text,
    pageCount: pages.length || 1,
    pages,
  };
}
