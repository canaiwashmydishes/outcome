# Outcome99 — Build A Handoff

**Build A — Team Management.** The platform is now multi-tenant in practice: users can create teams beyond their personal workspace, invite collaborators, manage roles, and switch between teams. Every deal is now unambiguously team-scoped, with role-checked access at the callable boundary.

65 source files, 87 KB zipped. 14 net files added vs. Build 0.

---

## What ships in Build A

### New Cloud Functions callables

| Callable | Access | Purpose |
|---|---|---|
| `createTeam` | Any signed-in user | Creates a new team, caller becomes partner-owner, Starter subscription attached |
| `inviteMember` | Partners only | Creates a pending invitation with seat-quota + duplicate-check |
| `acceptInvite` | Invited email | Claims a pending invite, becomes active member |
| `revokeInvite` | Partners only | Marks an invite revoked |
| `changeMemberRole` | Partners only | Changes a member's role; last-partner guard prevents lockout |
| `removeMember` | Partners only | Deletes team membership; last-partner guard prevents lockout |
| `archiveDeal` | Partners only | Soft-hides a deal (no quota refund) |

### Updated callables

- `createDeal` now accepts an optional `teamId` (falls back to primary team), enforces partner-or-associate role, records the caller's real role in the audit event (no more hardcoded `'partner'` from Build 0), and accepts `expectedCloseDate` + `riskAppetiteNotes` on the deal meta.

### New web components

- `TeamSwitcher.tsx` — sidebar dropdown. Shows all teams the user is an active member of, with role badges. Inline "New Team" flow with validation.
- `TeamSettingsView.tsx` — the full member/invitation manager. Invite form, member list with inline role dropdown, remove-member button, pending invite list with copy-link + revoke.
- `InviteAcceptScreen.tsx` — banner shown when the user has pending invites addressed to their email. Supports accepting multiple.
- `NewDealForm.tsx` — extended with expected close date and risk appetite notes.

### New web hooks

- `useTeams` — collection-group query returning every team the user is an active member of. Sorts owner-teams first.
- `usePendingInvitations` — collection-group query for pending invites addressed to the user's email.
- `useTeamMembers` — real-time members + invitations for a specific team.

### Refactored web hooks

- `useDeals` — now accepts explicit `teamId` instead of `profile`. Filters out archived deals.
- `useSubscription` — now accepts explicit `teamId` instead of `profile`.

Both changes enable the team switcher. All downstream hooks re-scope transparently when the active team changes.

### Schema changes

- `Invitation` type added (`teams/{teamId}/invitations/{invitationId}`).
- `DealMeta` extended with `expectedCloseDate` and `riskAppetiteNotes`.
- `Deal` extended with `archivedAt` and `archivedBy`.
- Audit event enum expanded: `team_created`, `deal_archived`, `deal_restored`, `member_invite_revoked`, `member_invite_accepted`.
- All new callable request/response shapes exported from `@outcome99/shared`.

### Firestore changes

- `firestore.rules` adds `invitations` subcollection with dual-read permission: readable by team partners OR by users whose auth email matches the invitation's email field.
- `firestore.indexes.json` adds a collection-group index on `invitations` (email + status + invitedAt), a per-collection index on invitations for the settings view, and an archived-deal filter index.

---

## Design decisions worth flagging

**Active team as client-side state.** The user's `primaryTeamId` on their profile stays as a default pointer, but the actual active team is just React state. Switching teams re-scopes `useDeals`, `useSubscription`, `useTeamMembers` in real-time via their `teamId` params. This kept the change surgical and avoided any profile-storage refactors. Deep-links (`/invite/:id`) also flow through this same state.

**Invitation discovery uses collection-group queries.** A user with a pending invite doesn't yet know which team they're being invited to. Rather than maintain a denormalized `userInvitations/{uid}` collection, I used a collection-group query over all `invitations` subcollections filtered by `email`. The Firestore rule allows read when `resource.data.email == request.auth.token.email`, which keeps leakage impossible. Indexed, fast, and zero denormalization.

**Invite links are opaque document IDs.** No HMAC signing, no tokens — the invitation ID is the link. Security comes from (a) the Firestore rule requiring an email match and (b) `acceptInvite` re-verifying the email match server-side. This is the same model Notion, Linear, and Figma use.

**Email delivery explicitly deferred to Build H.** Invite links are generated and displayed in the UI (copy button); the user shares manually. Once we have Stripe + transactional email (Postmark/Resend) in Build H, the same invite creation path will also send an email. The callable returns the link today so nothing is locked.

**Last-partner guard.** Both `changeMemberRole` and `removeMember` reject operations that would leave a team with zero active partners. This prevents the "accidentally locked out of your own team" foot-gun.

**Seat quota check at invite time.** `inviteMember` counts active members + pending invites against `subscription.seatsMax`. Starter has 5 seats, Professional unlimited (fair use), Enterprise unlimited. Idempotent: re-inviting the same email returns the existing pending invite id rather than creating a duplicate.

**`archiveDeal` does not refund quota.** Annual deal quotas are commitments. Archiving hides a deal from default views but keeps the audit trail intact and doesn't give a user the ability to churn through deals by archiving-and-recreating.

---

## Role-based access in Build A (and what's deferred)

Build A captures role information and enforces roles at the callable boundary for team-management actions. The full RBAC enforcement across every surface — e.g., observers being read-only on findings, external counsel having scoped access — is Build G. In Build A:

| Role | Can create deals | Can invite/manage team | Can archive deals |
|---|---|---|---|
| Partner | ✅ | ✅ | ✅ |
| Associate | ✅ | ❌ | ❌ |
| External Counsel | ❌ | ❌ | ❌ |
| Consultant | ❌ | ❌ | ❌ |
| Observer | ❌ | ❌ | ❌ |

Firestore rules enforce read scope (team membership) on every collection; write enforcement for Findings, documents, followups, etc. stays `false` until those phases activate in Builds B through F and route through server callables.

---

## Deploy and test

### Setup
Same as Build 0 — unzip, `npm install`, `npm run build:shared`, then:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

(The indexes file has three new entries; the deploy will provision them, which takes 1–3 minutes the first time.)

### Walkthrough to verify

1. **Sign in.** Personal team created automatically, sidebar shows team switcher with one team, plan badge shows Starter.
2. **Click team switcher → New team.** Enter a name, click Create. New team appears, selected automatically. Plan badge resets (separate subscription for the new team).
3. **Switch back to personal team.** Deal archive re-scopes.
4. **Click Team Settings.** See yourself listed as partner. Click the Invite form, enter a test email + role, click Invite. A "Share this invite link" banner appears with copy button.
5. **Copy the invite link.** Open a private browsing window. Paste the link, sign in as a different Google account whose email matches.
6. **The deep-link handler runs.** The invite is accepted, the active team switches to the one you were invited to, `/invite/:id` is cleaned from the URL.
7. **Back in the original window,** open Team Settings. The new member appears in the Active members list. Change their role via the dropdown — observe it updates in real-time.
8. **Try to demote yourself (the last partner).** The server rejects with "Cannot demote the last partner. Promote another member to partner first." — verify in the error bar.
9. **Promote the new member to partner,** then demote yourself to associate. Observe the Team Settings view now hides the invite form (you're no longer partner).
10. **Create a deal in each team,** verify they show up in only one team's archive at a time.
11. **Archive a deal** (requires a small UI addition — for Build A the callable exists but no button surfaces it yet; use the Firebase console or test via `archiveDeal` directly to verify the audit event lands).

### Firestore verification

- `teams/{teamId}/invitations/{inviteId}` — pending invites with `expiresAt` set 14 days out
- `teams/{teamId}/members/{uid}` — active members with their role
- `teamAuditLog/{eventId}` — one entry per team-management action
- `deals/{dealId}` — `archivedAt` field present after archive

---

## What isn't in Build A

Deliberate deferrals:

- **Archive UI button.** The `archiveDeal` callable is live but there's no visible "Archive" button in the Deal Workspace yet. I'd rather add it alongside the Build D issue tracker UX work when we have the full deal-actions menu designed.
- **Email delivery.** Invites show as copy-able links. Build H integrates transactional email and same call site triggers the send.
- **SSO / SAML.** Build G, Enterprise tier.
- **Role-based read scopes beyond team membership.** E.g., observer read-only on findings. Build G.
- **Per-role activity feeds.** Post-v1.
- **Team deletion.** Intentionally omitted for v1 — partners can remove all members and stop using a team, but hard-delete is a big audit-impact decision. Defer.

---

## Delivery

`outcome99-builda.zip` contains the complete Build A source. Unzip, install, deploy rules and indexes, test the team flow.

Next up: **Build B — Document Ingestion.** Bulk upload, Google Document AI OCR, classification by workstream via Claude Sonnet, dedup by hash. This is the first build where the product does something genuinely new to a user's data. Estimated 2 weeks.
