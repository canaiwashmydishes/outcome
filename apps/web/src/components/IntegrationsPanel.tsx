import { useState } from 'react';
import { Cloud, Plug, Check, AlertTriangle, ArrowUpRight } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Integration, IntegrationProvider } from '@outcome99/shared';
import { connectProvider, disconnectProvider, requestVdrAccess } from '../lib/functions';
import ProviderBrowser from './ProviderBrowser';
import { cn, formatRelativeTime } from '../lib/utils';

interface ProviderMeta {
  id: IntegrationProvider;
  displayName: string;
  category: 'cloud_storage' | 'vdr';
  blurb: string;
}

const PROVIDERS: ProviderMeta[] = [
  { id: 'gdrive', displayName: 'Google Drive', category: 'cloud_storage', blurb: 'Import folders from Drive & Shared Drives.' },
  { id: 'sharepoint', displayName: 'SharePoint', category: 'cloud_storage', blurb: 'Import from OneDrive & SharePoint document libraries.' },
  { id: 'dropbox', displayName: 'Dropbox', category: 'cloud_storage', blurb: 'Import folders from Dropbox Business or Personal.' },
  { id: 'intralinks', displayName: 'Intralinks', category: 'vdr', blurb: 'Production VDR adapter ships in B2.5. Request access.' },
  { id: 'datasite', displayName: 'Datasite', category: 'vdr', blurb: 'Production VDR adapter ships in B2.5. Request access.' },
  { id: 'firmex', displayName: 'Firmex', category: 'vdr', blurb: 'Production VDR adapter ships in B2.5. Request access.' },
];

interface Props {
  user: User;
  dealId: string;
  integrations: Partial<Record<IntegrationProvider, Integration>>;
}

export default function IntegrationsPanel({ user, dealId, integrations }: Props) {
  const [browsing, setBrowsing] = useState<IntegrationProvider | null>(null);
  const [pending, setPending] = useState<IntegrationProvider | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const handleConnect = async (provider: IntegrationProvider) => {
    setPending(provider);
    setNote(null);
    try {
      const res = await connectProvider({
        provider,
        returnTo: window.location.pathname,
      });
      if (!res.data.ok) throw new Error('Connect failed.');
      // Redirect the user to the provider's authorization page. The
      // oauthCallback HTTP function handles the return leg.
      window.location.href = res.data.authorizationUrl;
    } catch (err) {
      setNote(
        err instanceof Error ? err.message : `Could not start ${provider} connection.`
      );
      setPending(null);
    }
  };

  const handleDisconnect = async (provider: IntegrationProvider) => {
    if (!confirm(`Disconnect ${provider}? Active imports will finish but new ones will require reconnecting.`)) return;
    setPending(provider);
    setNote(null);
    try {
      await disconnectProvider({ provider });
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setPending(null);
    }
  };

  const handleRequestVdr = async (provider: 'intralinks' | 'datasite' | 'firmex') => {
    setPending(provider);
    setNote(null);
    try {
      await requestVdrAccess({ provider });
      setNote(`Access request sent for ${provider}. You'll hear from us shortly.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 font-bold flex items-center gap-2">
            <Cloud size={12} />
            Import from
          </div>
        </div>

        {note && (
          <div className="border-thin bg-black/[0.02] p-3 text-[11px] mb-3">{note}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-black border-thin">
          {PROVIDERS.map((p) => (
            <ProviderCard
              key={p.id}
              meta={p}
              integration={integrations[p.id]}
              pending={pending === p.id}
              onConnect={() => handleConnect(p.id)}
              onDisconnect={() => handleDisconnect(p.id)}
              onImport={() => setBrowsing(p.id)}
              onRequestVdr={() =>
                handleRequestVdr(p.id as 'intralinks' | 'datasite' | 'firmex')
              }
            />
          ))}
        </div>
      </section>

      {browsing && (
        <ProviderBrowser
          user={user}
          dealId={dealId}
          provider={browsing}
          onClose={() => setBrowsing(null)}
        />
      )}
    </>
  );
}

function ProviderCard({
  meta,
  integration,
  pending,
  onConnect,
  onDisconnect,
  onImport,
  onRequestVdr,
}: {
  meta: ProviderMeta;
  integration?: Integration;
  pending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onImport: () => void;
  onRequestVdr: () => void;
}) {
  const isVdr = meta.category === 'vdr';
  const status = integration?.status ?? 'disconnected';
  const connected = status === 'connected';
  const expired = status === 'expired' || status === 'error';

  return (
    <div className={cn('bg-white p-5 flex flex-col gap-4', pending && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-grow">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold">{meta.displayName}</h3>
            {isVdr && (
              <span className="text-[8px] uppercase tracking-widest px-1.5 py-0.5 border border-black/30 text-black/50">
                VDR
              </span>
            )}
          </div>
          <p className="text-[11px] text-black/60 leading-relaxed">{meta.blurb}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {connected && integration?.accountLabel && (
        <div className="text-[9px] uppercase tracking-widest text-black/40 font-mono truncate">
          {integration.accountLabel}
          {integration.connectedAt && (
            <span className="ml-2 normal-case tracking-normal">
              · connected {formatRelativeTime(integration.connectedAt as never)}
            </span>
          )}
        </div>
      )}

      {expired && integration?.lastError && (
        <div className="text-[10px] text-red-700 leading-tight">
          {integration.lastError}
        </div>
      )}

      <div className="flex gap-2 mt-auto">
        {isVdr ? (
          <button
            onClick={onRequestVdr}
            disabled={pending}
            className="flex-1 minimal-button border border-black hover:bg-black hover:text-white disabled:opacity-30"
          >
            Request access
          </button>
        ) : connected ? (
          <>
            <button
              onClick={onImport}
              disabled={pending}
              className="flex-1 minimal-button bg-black text-white hover:bg-white hover:text-black disabled:opacity-30 flex items-center justify-center gap-1.5"
            >
              Import <ArrowUpRight size={10} />
            </button>
            <button
              onClick={onDisconnect}
              disabled={pending}
              className="px-3 py-2 text-[9px] uppercase tracking-widest border border-black/20 hover:border-black"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={onConnect}
            disabled={pending}
            className="flex-1 minimal-button bg-black text-white hover:bg-white hover:text-black disabled:opacity-30"
          >
            {pending ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Integration['status'] | 'disconnected' }) {
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold">
        <Check size={10} />
        Connected
      </div>
    );
  }
  if (status === 'expired' || status === 'error') {
    return (
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-red-700">
        <AlertTriangle size={10} />
        Reconnect
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-black/40">
      <Plug size={10} />
      Not connected
    </div>
  );
}
