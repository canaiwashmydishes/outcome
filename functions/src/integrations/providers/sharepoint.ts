import { logger } from 'firebase-functions/v2';
import type {
  ProviderAdapter,
  ProviderFile,
  ProviderFileBytes,
} from '../lib/adapters.js';
import type { IntegrationProvider, ProviderItem } from '@outcome99/shared';

/**
 * SharePoint / OneDrive adapter via Microsoft Graph (Build B2).
 *
 * Model differences from Drive/Dropbox:
 *   - Graph uses /me/drive/items/{id}/children for personal OneDrive and
 *     /drives/{drive-id}/items/{id}/children for SharePoint document libraries.
 *     We default to the user's OneDrive (`/me/drive`) in v1 — a follow-up can
 *     add a drive picker for users who need a specific SharePoint site.
 *   - Folder id = driveItem id. Root is special-cased as "root".
 *   - Downloads follow a 302 redirect to a short-lived Azure Blob URL.
 *     fetch() follows redirects by default, so we don't need to handle it
 *     explicitly.
 *   - Items have `folder` (present for folders) and `file` (present for files)
 *     facets, not a single mimeType. We derive a file's mime from `file.mimeType`.
 */

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount: number };
  file?: { mimeType: string };
  parentReference?: { id: string; path?: string };
}

export class SharePointAdapter implements ProviderAdapter {
  readonly provider: IntegrationProvider = 'sharepoint';

  constructor(private accessToken: string) {}

  async listFolder(folderId: string | undefined): Promise<{
    items: ProviderItem[];
    breadcrumb: Array<{ id: string; name: string }>;
  }> {
    const pathSegment =
      !folderId || folderId === 'root' ? 'root' : `items/${folderId}`;
    const items: ProviderItem[] = [];
    let nextLink: string | undefined = `/me/drive/${pathSegment}/children?$top=999`;

    while (nextLink) {
      const res = await this.graph(nextLink);
      const data = (await res.json()) as {
        value?: GraphDriveItem[];
        '@odata.nextLink'?: string;
      };
      for (const it of data.value ?? []) {
        items.push(graphToProviderItem(it));
      }
      // nextLink is a full URL; strip the base to stay path-relative.
      nextLink = data['@odata.nextLink']
        ? stripGraphBase(data['@odata.nextLink'])
        : undefined;
    }

    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const breadcrumb = await this.resolveBreadcrumb(folderId);
    return { items, breadcrumb };
  }

  async *walkSubtree(rootFolderId: string): AsyncGenerator<ProviderFile> {
    yield* this.walk(rootFolderId, '');
  }

  private async *walk(folderId: string, basePath: string): AsyncGenerator<ProviderFile> {
    const pathSegment = folderId === 'root' ? 'root' : `items/${folderId}`;
    let nextLink: string | undefined = `/me/drive/${pathSegment}/children?$top=999`;
    while (nextLink) {
      const res = await this.graph(nextLink);
      const data = (await res.json()) as {
        value?: GraphDriveItem[];
        '@odata.nextLink'?: string;
      };
      for (const it of data.value ?? []) {
        if (it.folder) {
          const nested = basePath ? `${basePath}/${it.name}` : it.name;
          yield* this.walk(it.id, nested);
        } else if (it.file) {
          yield {
            id: it.id,
            name: it.name,
            mimeType: it.file.mimeType,
            sizeBytes: it.size ?? 0,
            folderPath: basePath,
          };
        }
      }
      nextLink = data['@odata.nextLink'] ? stripGraphBase(data['@odata.nextLink']) : undefined;
    }
  }

  async downloadFile(fileId: string): Promise<ProviderFileBytes> {
    // Grab metadata for mime type + filename, then stream bytes.
    const metaRes = await this.graph(`/me/drive/items/${fileId}`);
    const meta = (await metaRes.json()) as GraphDriveItem;
    if (!meta.file) throw new Error(`SharePoint item ${fileId} is not a file.`);

    // /content yields a 302 to a blob URL; fetch follows redirects.
    const contentRes = await this.graph(`/me/drive/items/${fileId}/content`);
    const bytes = Buffer.from(await contentRes.arrayBuffer());
    return {
      bytes,
      mimeType: meta.file.mimeType,
      filename: meta.name,
    };
  }

  async resolveAccountLabel(): Promise<string | undefined> {
    try {
      const res = await this.graph('/me');
      const data = (await res.json()) as {
        userPrincipalName?: string;
        displayName?: string;
        mail?: string;
      };
      return data.mail ?? data.userPrincipalName ?? data.displayName;
    } catch (err) {
      logger.warn('sharepoint: resolveAccountLabel failed', { err: String(err) });
      return undefined;
    }
  }

  private async resolveBreadcrumb(
    folderId: string | undefined
  ): Promise<Array<{ id: string; name: string }>> {
    if (!folderId || folderId === 'root') {
      return [{ id: 'root', name: 'OneDrive' }];
    }
    const crumbs: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined = folderId;
    for (let i = 0; i < 20 && cursor && cursor !== 'root'; i++) {
      try {
        const res = await this.graph(`/me/drive/items/${cursor}`);
        const it = (await res.json()) as GraphDriveItem;
        crumbs.unshift({ id: it.id, name: it.name });
        cursor = it.parentReference?.id;
        // When we reach the drive root the parentReference.id still yields a
        // value but further lookups would start from below the /drive root.
        // Stop when we see an id that matches the drive root signature.
        if (cursor && cursor.startsWith('root')) cursor = undefined;
      } catch {
        break;
      }
    }
    crumbs.unshift({ id: 'root', name: 'OneDrive' });
    return crumbs;
  }

  private async graph(path: string): Promise<Response> {
    const url = `https://graph.microsoft.com/v1.0${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`graph ${res.status}: ${body.slice(0, 400)}`);
    }
    return res;
  }
}

function graphToProviderItem(it: GraphDriveItem): ProviderItem {
  if (it.folder) {
    return {
      id: it.id,
      name: it.name,
      kind: 'folder',
      childCount: it.folder.childCount,
    };
  }
  return {
    id: it.id,
    name: it.name,
    kind: 'file',
    mimeType: it.file?.mimeType,
    sizeBytes: it.size,
  };
}

function stripGraphBase(fullUrl: string): string {
  // Turn "https://graph.microsoft.com/v1.0/me/drive/..." back into
  // "/me/drive/...". The graph() helper re-prefixes the base.
  return fullUrl.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '');
}
