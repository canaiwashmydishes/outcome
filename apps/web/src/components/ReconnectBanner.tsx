import { AlertTriangle } from 'lucide-react';
import type { Integration, IntegrationProvider } from '@outcome99/shared';

interface Props {
  integrations: Partial<Record<IntegrationProvider, Integration>>;
  onGoToIntegrations: () => void;
}

const LABELS: Record<IntegrationProvider, string> = {
  gdrive: 'Google Drive',
  sharepoint: 'SharePoint',
  dropbox: 'Dropbox',
  intralinks: 'Intralinks',
  datasite: 'Datasite',
  firmex: 'Firmex',
};

/**
 * Sidebar banner that appears above the plan badge whenever any
 * integration is in 'expired' or 'error' state. Clicking navigates to
 * the ingestion view where the user can reconnect.
 */
export default function ReconnectBanner({ integrations, onGoToIntegrations }: Props) {
  const broken = Object.values(integrations).filter(
    (i): i is Integration => !!i && (i.status === 'expired' || i.status === 'error')
  );
  if (broken.length === 0) return null;

  const names = broken.map((i) => LABELS[i.provider]).join(', ');

  return (
    <button
      onClick={onGoToIntegrations}
      className="w-full border-thin border-red-700 bg-red-50 p-3 text-left hover:bg-red-100 transition-colors"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={12} className="text-red-700 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-widest font-bold text-red-700 mb-0.5">
            Reconnect required
          </div>
          <div className="text-[10px] text-red-900 leading-tight truncate">
            {names}
          </div>
        </div>
      </div>
    </button>
  );
}
