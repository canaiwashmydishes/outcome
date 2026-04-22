import type {
  ProviderAdapter,
  ProviderFile,
  ProviderFileBytes,
} from '../lib/adapters.js';
import type { IntegrationProvider, ProviderItem } from '@outcome99/shared';

/**
 * Reference VDR stub adapter (Build B2).
 *
 * This adapter exists so the UI, callables, and orchestrator can be tested
 * end-to-end without depending on production VDR partnerships. It returns
 * a plausible-looking folder tree with mock file references.
 *
 * Build B2.5 replaces this with provider-specific implementations for
 * Intralinks, Datasite, and Firmex once partner agreements are in place.
 *
 * IMPORTANT: downloadFile throws — the stub is for browsing only. The
 * orchestrator treats downloadFile failures as per-doc failures, so if a
 * user somehow reaches import against a stub provider, individual docs
 * fail cleanly rather than the job silently hanging.
 */

const MOCK_TREE: Record<string, Array<{ id: string; name: string; kind: 'folder' | 'file' }>> = {
  root: [
    { id: 'f_legal', name: '01_Legal', kind: 'folder' },
    { id: 'f_financial', name: '02_Financial', kind: 'folder' },
    { id: 'f_tax', name: '03_Tax', kind: 'folder' },
    { id: 'f_hr', name: '04_HR', kind: 'folder' },
    { id: 'f_commercial', name: '05_Commercial', kind: 'folder' },
  ],
  f_legal: [
    { id: 'd_material_contracts', name: 'Material Contracts', kind: 'folder' },
    { id: 'd_bylaws.pdf', name: 'Bylaws.pdf', kind: 'file' },
    { id: 'd_shareholder_agreement.pdf', name: 'Shareholder Agreement.pdf', kind: 'file' },
  ],
  d_material_contracts: [
    { id: 'd_top10_customer.pdf', name: 'Top 10 Customer Contract.pdf', kind: 'file' },
    { id: 'd_key_supplier.pdf', name: 'Key Supplier MSA.pdf', kind: 'file' },
  ],
  f_financial: [
    { id: 'd_qoe.pdf', name: 'Quality of Earnings.pdf', kind: 'file' },
    { id: 'd_audited_fs.pdf', name: 'Audited Financial Statements 2024.pdf', kind: 'file' },
  ],
  f_tax: [
    { id: 'd_tax_return_2024.pdf', name: 'Federal Tax Return 2024.pdf', kind: 'file' },
  ],
  f_hr: [
    { id: 'd_headcount.xlsx', name: 'Headcount Report.xlsx', kind: 'file' },
  ],
  f_commercial: [
    { id: 'd_customer_concentration.xlsx', name: 'Customer Concentration Analysis.xlsx', kind: 'file' },
  ],
};

const DISPLAY_NAMES: Record<string, string> = {
  root: 'Data Room',
  f_legal: '01_Legal',
  f_financial: '02_Financial',
  f_tax: '03_Tax',
  f_hr: '04_HR',
  f_commercial: '05_Commercial',
  d_material_contracts: 'Material Contracts',
};

export class VdrStubAdapter implements ProviderAdapter {
  constructor(public readonly provider: IntegrationProvider) {}

  async listFolder(folderId: string | undefined): Promise<{
    items: ProviderItem[];
    breadcrumb: Array<{ id: string; name: string }>;
  }> {
    const id = folderId ?? 'root';
    const children = MOCK_TREE[id] ?? [];
    const items: ProviderItem[] = children.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      mimeType: c.kind === 'file' ? inferMime(c.name) : undefined,
      sizeBytes: c.kind === 'file' ? 500_000 : undefined,
    }));

    const breadcrumb =
      id === 'root'
        ? [{ id: 'root', name: DISPLAY_NAMES.root }]
        : [
            { id: 'root', name: DISPLAY_NAMES.root },
            { id, name: DISPLAY_NAMES[id] ?? id },
          ];
    return { items, breadcrumb };
  }

  async *walkSubtree(rootFolderId: string): AsyncGenerator<ProviderFile> {
    yield* this.walk(rootFolderId, '');
  }

  private async *walk(folderId: string, basePath: string): AsyncGenerator<ProviderFile> {
    const children = MOCK_TREE[folderId] ?? [];
    for (const c of children) {
      if (c.kind === 'folder') {
        const nested = basePath ? `${basePath}/${c.name}` : c.name;
        yield* this.walk(c.id, nested);
      } else {
        yield {
          id: c.id,
          name: c.name,
          mimeType: inferMime(c.name),
          sizeBytes: 500_000,
          folderPath: basePath,
        };
      }
    }
  }

  async downloadFile(_fileId: string): Promise<ProviderFileBytes> {
    throw new Error(
      `${this.provider} integration is not yet available. Production connector ships in Build B2.5.`
    );
  }

  async resolveAccountLabel(): Promise<string | undefined> {
    return `${this.provider} (stub)`;
  }
}

function inferMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}
