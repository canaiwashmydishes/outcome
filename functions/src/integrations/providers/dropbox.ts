import { logger } from 'firebase-functions/v2';
import type {
  ProviderAdapter,
  ProviderFile,
  ProviderFileBytes,
} from '../lib/adapters.js';
import type { IntegrationProvider, ProviderItem } from '@outcome99/shared';

/**
 * Dropbox adapter (Build B2).
 *
 * Model differences from Drive/Graph:
 *   - Paths rather than IDs. The "folder id" we expose is actually the full
 *     path — "" for root, "/Data Room" for a folder. This keeps the
 *     adapter interface consistent.
 *   - list_folder returns a first page + a cursor; list_folder/continue
 *     paginates until has_more = false.
 *   - Downloads go through content.dropboxapi.com with the request body
 *     in a Dropbox-API-Arg header (JSON-encoded) instead of query params.
 *   - Dropbox names MIME types weakly; we infer from file extension on
 *     the way out because list entries don't carry mimeType.
 */

interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  id?: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
}

interface ListFolderResult {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
}

export class DropboxAdapter implements ProviderAdapter {
  readonly provider: IntegrationProvider = 'dropbox';

  constructor(private accessToken: string) {}

  async listFolder(folderId: string | undefined): Promise<{
    items: ProviderItem[];
    breadcrumb: Array<{ id: string; name: string }>;
  }> {
    const path = !folderId || folderId === 'root' ? '' : folderId;
    const items: ProviderItem[] = [];

    let result = await this.rpc<ListFolderResult>('/2/files/list_folder', {
      path,
      recursive: false,
      include_deleted: false,
    });

    while (true) {
      for (const e of result.entries) {
        if (e['.tag'] === 'folder') {
          items.push({
            id: e.path_display ?? e.path_lower ?? `/${e.name}`,
            name: e.name,
            kind: 'folder',
          });
        } else if (e['.tag'] === 'file') {
          items.push({
            id: e.path_display ?? e.path_lower ?? `/${e.name}`,
            name: e.name,
            kind: 'file',
            mimeType: inferMimeFromName(e.name),
            sizeBytes: e.size,
          });
        }
      }
      if (!result.has_more) break;
      result = await this.rpc<ListFolderResult>('/2/files/list_folder/continue', {
        cursor: result.cursor,
      });
    }

    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      items,
      breadcrumb: buildBreadcrumb(path),
    };
  }

  async *walkSubtree(rootFolderId: string): AsyncGenerator<ProviderFile> {
    // Dropbox's list_folder has a `recursive: true` mode — use it for the
    // walk so we paginate once rather than per-subfolder.
    const rootPath = !rootFolderId || rootFolderId === 'root' ? '' : rootFolderId;

    let result = await this.rpc<ListFolderResult>('/2/files/list_folder', {
      path: rootPath,
      recursive: true,
      include_deleted: false,
    });

    while (true) {
      for (const e of result.entries) {
        if (e['.tag'] === 'file') {
          const displayPath = e.path_display ?? e.path_lower ?? '';
          // folderPath is the path relative to the imported root, with
          // leading slashes and the filename itself stripped.
          let folderPath = '';
          if (displayPath.startsWith(rootPath)) {
            folderPath = displayPath.slice(rootPath.length);
          } else {
            folderPath = displayPath;
          }
          folderPath = folderPath.replace(/^\/+/, '');
          // Strip filename.
          const lastSlash = folderPath.lastIndexOf('/');
          folderPath = lastSlash >= 0 ? folderPath.slice(0, lastSlash) : '';

          yield {
            id: displayPath,
            name: e.name,
            mimeType: inferMimeFromName(e.name),
            sizeBytes: e.size ?? 0,
            folderPath,
          };
        }
      }
      if (!result.has_more) break;
      result = await this.rpc<ListFolderResult>('/2/files/list_folder/continue', {
        cursor: result.cursor,
      });
    }
  }

  async downloadFile(fileId: string): Promise<ProviderFileBytes> {
    // Downloads go to content.dropboxapi.com, with the path passed via the
    // Dropbox-API-Arg header as JSON.
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: fileId }),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`dropbox download ${res.status}: ${body.slice(0, 400)}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const name = fileId.split('/').pop() ?? fileId;
    return {
      bytes,
      mimeType: inferMimeFromName(name),
      filename: name,
    };
  }

  async resolveAccountLabel(): Promise<string | undefined> {
    try {
      const data = await this.rpc<{
        email?: string;
        name?: { display_name?: string };
      }>('/2/users/get_current_account', null);
      return data.email ?? data.name?.display_name;
    } catch (err) {
      logger.warn('dropbox: resolveAccountLabel failed', { err: String(err) });
      return undefined;
    }
  }

  private async rpc<T>(path: string, body: unknown): Promise<T> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    };
    // Dropbox RPC endpoints take JSON bodies; pass null/undefined when the
    // endpoint accepts no args (get_current_account).
    if (body !== null && body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    const res = await fetch(`https://api.dropboxapi.com${path}`, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`dropbox ${res.status}: ${text.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  }
}

function buildBreadcrumb(path: string): Array<{ id: string; name: string }> {
  const crumbs: Array<{ id: string; name: string }> = [{ id: 'root', name: 'Dropbox' }];
  if (!path) return crumbs;
  const segments = path.split('/').filter(Boolean);
  let cumulative = '';
  for (const seg of segments) {
    cumulative += `/${seg}`;
    crumbs.push({ id: cumulative, name: seg });
  }
  return crumbs;
}

function inferMimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };
  return map[ext] ?? 'application/octet-stream';
}
