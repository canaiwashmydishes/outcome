import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useUserProfile } from './hooks/useUserProfile';
import { useDeals } from './hooks/useDeals';
import { useSubscription } from './hooks/useSubscription';
import { useTeams } from './hooks/useTeams';
import { usePendingInvitations } from './hooks/usePendingInvitations';
import { useIntegrations } from './hooks/useIntegrations';
import LoginScreen from './components/LoginScreen';
import DealArchive from './components/DealArchive';
import NewDealForm from './components/NewDealForm';
import DealWorkspace from './components/DealWorkspace';
import BillingView from './components/BillingView';
import PlanBadge from './components/PlanBadge';
import TeamSwitcher from './components/TeamSwitcher';
import TeamSettingsView from './components/TeamSettingsView';
import InviteAcceptScreen from './components/InviteAcceptScreen';
import ReconnectBanner from './components/ReconnectBanner';
import { acceptInvite } from './lib/functions';
import { cn } from './lib/utils';

type View = 'archive' | 'new-deal' | 'workspace' | 'billing' | 'team-settings' | 'invite-accept';

/**
 * App shell (Build A).
 *
 * State model:
 *   - `activeTeamId` is client-side session state. Defaults to profile.primaryTeamId
 *     but can be switched via TeamSwitcher. All downstream subscriptions
 *     (useDeals, useSubscription, useTeamMembers) re-scope when it changes.
 *   - Pending invitations are discovered via collection-group query and shown
 *     as a banner above the main stage.
 *   - Deep link /invite/:id hydrates into the InviteAcceptScreen view.
 */
export default function App() {
  const { user, loading, signingIn, error, login, logout } = useAuth();
  const { profile } = useUserProfile(user);
  const { teams } = useTeams(user);
  const { invitations: pendingInvites } = usePendingInvitations(user);
  const { integrations } = useIntegrations(user);

  // Active team: deep-link from URL first, then profile.primaryTeamId.
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  useEffect(() => {
    // When teams load, pick a sensible default if we don't have one yet.
    if (!activeTeamId && teams.length > 0) {
      const primary =
        profile?.primaryTeamId && teams.find((t) => t.team.id === profile.primaryTeamId)
          ? profile.primaryTeamId
          : teams[0].team.id;
      setActiveTeamId(primary);
    }
  }, [teams, profile?.primaryTeamId, activeTeamId]);

  const activeTeam = useMemo(
    () => teams.find((t) => t.team.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  );

  const { subscription } = useSubscription(activeTeamId);
  const { deals, loading: dealsLoading, rename } = useDeals(activeTeamId);

  const [view, setView] = useState<View>('archive');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  // Inline deep-link handler for /invite/:id — accept the invitation and
  // switch to that team. Kept simple (no router) to match the existing SPA.
  const [deepLinkInviteId, setDeepLinkInviteId] = useState<string | null>(null);
  const [deepLinkProcessing, setDeepLinkProcessing] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/invite\/([^/]+)/);
    if (match) setDeepLinkInviteId(match[1]);
  }, []);

  useEffect(() => {
    if (!deepLinkInviteId || !user || deepLinkProcessing) return;
    setDeepLinkProcessing(true);
    (async () => {
      try {
        const res = await acceptInvite({ invitationId: deepLinkInviteId });
        if (res.data.ok) {
          setActiveTeamId(res.data.teamId);
          setView('archive');
        }
      } catch (err) {
        setDeepLinkError((err as Error).message ?? 'Could not accept invitation.');
      } finally {
        setDeepLinkProcessing(false);
        setDeepLinkInviteId(null);
        window.history.replaceState({}, '', '/');
      }
    })();
  }, [deepLinkInviteId, user, deepLinkProcessing]);

  const openDeal = (id: string) => {
    setSelectedDealId(id);
    setView('workspace');
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-white">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm tracking-[0.2em] font-light uppercase"
        >
          Outcome99 · Initializing workspace
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={login} loading={signingIn} error={error} />;
  }

  return (
    <div className="flex h-screen w-full bg-white text-black selection:bg-black selection:text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[260px] flex-shrink-0 border-right-thin flex flex-col bg-white">
        <div className="p-6 border-bottom-thin">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em]">Outcome99</h1>
          <p className="text-[9px] mt-1 opacity-50 uppercase tracking-widest">
            M&A Red-Flag Detection Platform
          </p>
        </div>

        {/* Deal Archive (compact) */}
        <div className="flex-grow flex flex-col overflow-hidden p-6 pb-0">
          <div className="text-[10px] uppercase font-semibold mb-4 tracking-tight opacity-40 flex items-center justify-between">
            <span>Deal Archive</span>
            <span className="text-black/30 font-mono">
              {deals.length.toString().padStart(2, '0')}
            </span>
          </div>
          <div className="flex-grow overflow-y-auto minimal-scrollbar pr-1">
            <DealArchive
              deals={deals}
              loading={dealsLoading}
              onSelect={openDeal}
              onRename={rename}
              compact
              activeId={view === 'workspace' ? selectedDealId ?? undefined : undefined}
            />
          </div>
        </div>

        {/* Sidebar footer: team switcher + plan badge + new deal + user */}
        <div className="p-6 border-top-thin mt-auto space-y-3">
          <ReconnectBanner
            integrations={integrations}
            onGoToIntegrations={() => {
              if (selectedDealId) setView('workspace');
              else setView('archive');
            }}
          />
          {user && (
            <TeamSwitcher
              user={user}
              teams={teams}
              activeTeamId={activeTeamId}
              onSelect={setActiveTeamId}
            />
          )}
          <PlanBadge subscription={subscription} onClickBilling={() => setView('billing')} />
          <button
            onClick={() => setView('new-deal')}
            disabled={!activeTeamId}
            className="w-full border-thin py-2 text-[11px] uppercase font-bold hover:bg-black hover:text-white transition-colors disabled:opacity-30"
          >
            New Deal
          </button>
          <button
            onClick={() => setView('team-settings')}
            disabled={!activeTeam}
            className="w-full border-thin py-2 text-[11px] uppercase hover:bg-black hover:text-white transition-colors disabled:opacity-30"
          >
            Team Settings
          </button>
          <div className="flex items-center justify-between pt-3 border-t border-black/5">
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] text-black/50 uppercase tracking-[0.1em] truncate">
                {user.email?.split('@')[0]}
              </span>
              <button
                onClick={logout}
                className="text-[9px] uppercase tracking-widest text-black/50 hover:text-black hover:underline text-left"
              >
                Logout
              </button>
            </div>
            <Activity size={12} className="text-black/20" />
          </div>
        </div>
      </aside>

      {/* Main stage */}
      <main className="flex-grow flex flex-col overflow-hidden">
        <header className="h-14 border-bottom-thin flex items-center justify-between px-6 bg-white shrink-0">
          <div className="flex space-x-3 items-center">
            <button
              className={cn('tab', view === 'archive' ? 'tab-active' : 'opacity-40 hover:opacity-80')}
              onClick={() => setView('archive')}
            >
              Archive
            </button>
            <button
              className={cn('tab', view === 'new-deal' ? 'tab-active' : 'opacity-40 hover:opacity-80')}
              onClick={() => setView('new-deal')}
            >
              New Deal
            </button>
            {selectedDealId && (
              <button
                className={cn(
                  'tab',
                  view === 'workspace' ? 'tab-active' : 'opacity-40 hover:opacity-80'
                )}
                onClick={() => setView('workspace')}
              >
                Workspace
              </button>
            )}
            <button
              className={cn('tab', view === 'team-settings' ? 'tab-active' : 'opacity-40 hover:opacity-80')}
              onClick={() => setView('team-settings')}
            >
              Team
            </button>
            <button
              className={cn('tab', view === 'billing' ? 'tab-active' : 'opacity-40 hover:opacity-80')}
              onClick={() => setView('billing')}
            >
              Billing
            </button>
          </div>
          <div className="flex space-x-3 items-center">
            <span className="text-[10px] uppercase tracking-widest">
              Build A · <span className="font-bold">Active</span>
            </span>
            <div className="w-2 h-2 bg-black rounded-full animate-pulse" />
          </div>
        </header>

        <section className="flex-grow overflow-y-auto minimal-scrollbar">
          <div className="p-10 max-w-6xl mx-auto h-full">
            {/* Invitation banner — always shows when user has pending invites */}
            {pendingInvites.length > 0 && (
              <InviteAcceptScreen
                invitations={pendingInvites}
                onAccepted={(teamId) => {
                  setActiveTeamId(teamId);
                  setView('archive');
                }}
                onDismissAll={() => {
                  /* client-dismiss only; server state unchanged */
                }}
              />
            )}

            {deepLinkError && (
              <div className="border border-red-700 bg-red-50 p-3 text-[11px] text-red-700 mb-6">
                {deepLinkError}
              </div>
            )}

            <AnimatePresence mode="wait">
              {view === 'archive' && (
                <motion.div
                  key="archive"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col"
                >
                  {deals.length === 0 ? (
                    <div className="flex-grow flex flex-col justify-center items-center text-center space-y-8">
                      <div className="space-y-4">
                        <h2 className="text-4xl font-light tracking-tighter">Workspace ready.</h2>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-black/40">
                          Create a new deal or select one from the sidebar.
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-1 w-full max-w-2xl opacity-20">
                        {['Deal_01', 'Deal_02', 'Deal_03'].map((c) => (
                          <div key={c} className="h-32 border border-black p-4 flex items-end">
                            <span className="text-[8px] uppercase">{c}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setView('new-deal')}
                        className="minimal-button bg-black text-white hover:bg-white hover:text-black"
                      >
                        Create first deal
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.3em] text-black/40 mb-1">
                          Deal archive · {deals.length} workspace{deals.length === 1 ? '' : 's'}
                        </div>
                        <h2 className="text-3xl font-light tracking-tighter">
                          {activeTeam?.team.name ?? 'All deals'}
                        </h2>
                      </div>
                      <DealArchive
                        deals={deals}
                        loading={dealsLoading}
                        onSelect={openDeal}
                        onRename={rename}
                      />
                    </div>
                  )}
                </motion.div>
              )}

              {view === 'new-deal' && activeTeamId && (
                <motion.div
                  key="new"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <NewDealForm
                    activeTeamId={activeTeamId}
                    onCreated={openDeal}
                    onCancel={() => setView('archive')}
                    onGoBilling={() => setView('billing')}
                  />
                </motion.div>
              )}

              {view === 'workspace' && selectedDealId && (
                <motion.div
                  key={`workspace-${selectedDealId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <DealWorkspace dealId={selectedDealId} user={user} integrations={integrations} />
                </motion.div>
              )}

              {view === 'team-settings' && activeTeam && (
                <motion.div
                  key="team"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <TeamSettingsView user={user} activeTeam={activeTeam} />
                </motion.div>
              )}

              {view === 'billing' && (
                <motion.div
                  key="billing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <BillingView subscription={subscription} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </main>
    </div>
  );
}
