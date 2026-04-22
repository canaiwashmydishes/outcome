import { logger } from 'firebase-functions/v2';
import type {
  ProviderAdapter,
  ProviderFile,
  ProviderFileBytes,
} from '../lib/adapters.js';
import type { IntegrationProvider, ProviderItem } from '@outcome99/shared';

/**
 * Google Drive adapter (Build B2).
 *
 * Implementation notes:
 *   - Uses the raw Drive v3 REST API with fetch. Keeps deps light — no
 *     googleapis SDK. All calls carry an Authorization: Bearer token.
 *   - Lists with q="'{folderId}' in parents and trashed=false" and
 *     supportsAllDrives/includeItemsFromAllDrives/corpora='allDrives' so
 *     shared drives work out of the box.
 *   - Paginates via nextPageToken with pageSize=1000 (API max).
 *   - Native Workspace files (Docs/Sheets/Slides) export to Office formats
 *     via files.export. Regular binary files download via alt=media.
 *   - Shortcuts are resolved by following shortcutDetails.targetId to the
 *     underlying file before download.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** Workspace MIME types that need files.export rather than alt=media. */
const WORKSPACE_EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
  // drawing, form, etc. aren't useful as diligence documents — we skip them
  // in walkSubtree rather than attempting to export.
};

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // API returns as string
  parents?: string[];
  shortcutDetails?: { targetId: string; targetMimeType: string };
}

export class GoogleDriveAdapter implements ProviderAdapter {
  readonly provider: IntegrationProvider = 'gdrive';

  constructor(private accessToken: string) {}

  async listFolder(folderId: string | undefined): Promise<{
    items: ProviderItem[];
    breadcrumb: Array<{ id: string; name: string }>;
  }> {
    const actualFolderId = folderId ?? 'root';
    const items: ProviderItem[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: `'${actualFolderId}' in parents and trashed=false`,
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,size,parents,shortcutDetails)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await this.api(`/files?${params.toString()}`);
      const data = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };

      for (const f of data.files ?? []) {
        // Skip unusable Workspace files (drawings, forms) so the browser
        // doesn't show things that will fail at download time.
        if (isUnexportableWorkspaceFile(f.mimeType)) continue;

        items.push({
          id: f.id,
          name: f.name,
          kind: f.mimeType === FOLDER_MIME ? 'folder' : 'file',
          mimeType: f.mimeType,
          sizeBytes: f.size ? Number(f.size) : undefined,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    // Sort folders first, then files, then alphabetical.
    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const breadcrumb = await this.resolveBreadcrumb(actualFolderId);
    return { items, breadcrumb };
  }

  async *walkSubtree(rootFolderId: string): AsyncGenerator<ProviderFile> {
    yield* this.walk(rootFolderId, '');
  }

  private async *walk(folderId: string, basePath: string): AsyncGenerator<ProviderFile> {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,size,shortcutDetails)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.api(`/files?${params.toString()}`);
      const data = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };

      for (const f of data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) {
          const nested = basePath ? `${basePath}/${f.name}` : f.name;
          yield* this.walk(f.id, nested);
        } else if (f.mimeType === SHORTCUT_MIME) {
          // Shortcuts point to a file elsewhere; only follow file shortcuts
          // (not folder shortcuts) to avoid infinite loops.
          const t = f.shortcutDetails;
          if (t && t.targetMimeType !== FOLDER_MIME && !isUnexportableWorkspaceFile(t.targetMimeType)) {
            const { mimeType, sizeBytes } = resolveExportMime(t.targetMimeType, undefined);
            yield {
              id: t.targetId,
              name: f.name,
              mimeType,
              sizeBytes: sizeBytes ?? 0,
              folderPath: basePath,
            };
          }
        } else if (!isUnexportableWorkspaceFile(f.mimeType)) {
          const { mimeType, sizeBytes } = resolveExportMime(
            f.mimeType,
            f.size ? Number(f.size) : undefined
          );
          yield {
            id: f.id,
            name: f.name,
            mimeType,
            sizeBytes: sizeBytes ?? 0,
            folderPath: basePath,
          };
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  async downloadFile(fileId: string): Promise<ProviderFileBytes> {
    // First resolve the file's real mime type so we know whether to export
    // or alt=media download.
    const metaRes = await this.api(
      `/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`
    );
    const meta = (await metaRes.json()) as DriveFile;

    if (meta.mimeType === SHORTCUT_MIME) {
      throw new Error(`Refusing to download shortcut ${fileId}; resolve target first.`);
    }

    const workspaceMapping = WORKSPACE_EXPORT_MAP[meta.mimeType];
    if (workspaceMapping) {
      const exportRes = await this.api(
        `/files/${fileId}/export?mimeType=${encodeURIComponent(workspaceMapping.mime)}`
      );
      const bytes = Buffer.from(await exportRes.arrayBuffer());
      // Append the extension if the original name doesn't have it.
      const filename = meta.name.toLowerCase().endsWith(`.${workspaceMapping.ext}`)
        ? meta.name
        : `${meta.name}.${workspaceMapping.ext}`;
      return { bytes, mimeType: workspaceMapping.mime, filename };
    }

    const res = await this.api(`/files/${fileId}?alt=media&supportsAllDrives=true`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, mimeType: meta.mimeType, filename: meta.name };
  }

  async resolveAccountLabel(): Promise<string | undefined> {
    try {
      const res = await this.api('/about?fields=user(emailAddress,displayName)');
      const data = (await res.json()) as {
        user?: { emailAddress?: string; displayName?: string };
      };
      return data.user?.emailAddress ?? data.user?.displayName;
    } catch (err) {
      logger.warn('gdrive: resolveAccountLabel failed', { err: String(err) });
      return undefined;
    }
  }

  /**
   * Build a breadcrumb by walking parents from the current folder up to root.
   * Capped at 20 hops so a malformed circular link can't hang us.
   */
  private async resolveBreadcrumb(
    folderId: string
  ): Promise<Array<{ id: string; name: string }>> {
    if (folderId === 'root') return [{ id: 'root', name: 'My Drive' }];

    const crumbs: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined = folderId;
    for (let i = 0; i < 20 && cursor && cursor !== 'root'; i++) {
      try {
        const res = await this.api(
          `/files/${cursor}?fields=id,name,parents&supportsAllDrives=true`
        );
        const f = (await res.json()) as DriveFile;
        crumbs.unshift({ id: f.id, name: f.name });
        cursor = f.parents?.[0];
      } catch {
        break;
      }
    }
    crumbs.unshift({ id: 'root', name: 'My Drive' });
    return crumbs;
  }

  private async api(pathAndQuery: string): Promise<Response> {
    const url = `https://www.googleapis.com/drive/v3${pathAndQuery}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`gdrive API ${res.status}: ${body.slice(0, 400)}`);
    }
    return res;
  }
}

function isUnexportableWorkspaceFile(mimeType: string): boolean {
  // Workspace apps that don't map to Office formats — skip them silently.
  return (
    mimeType.startsWith('application/vnd.google-apps.') &&
    mimeType !== FOLDER_MIME &&
    mimeType !== SHORTCUT_MIME &&
    !WORKSPACE_EXPORT_MAP[mimeType]
  );
}

function resolveExportMime(
  driveMime: string,
  size: number | undefined
): { mimeType: string; sizeBytes?: number } {
  const mapping = WORKSPACE_EXPORT_MAP[driveMime];
  if (mapping) return { mimeType: mapping.mime }; // size unknown for exports
  return { mimeType: driveMime, sizeBytes: size };
}
