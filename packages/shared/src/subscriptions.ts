/**
 * Subscription tiers
 *
 * v6.0 pricing replaces the per-user credit model. Billing is annual,
 * at the team level, with deal quotas and seat caps per tier.
 *
 * The quantification/scenario layer (Phase 6) is bundled into the deal
 * quota — there is no separate per-simulation charge at v6.0.
 */

export type SubscriptionTier = 'starter' | 'professional' | 'enterprise';

export type Workstream =
  | 'legal'
  | 'financial'
  | 'tax'
  | 'hr'
  | 'cyber_it'
  | 'commercial'
  | 'customer'
  | 'supplier'
  | 'operations_integration';

export interface SubscriptionDefinition {
  id: SubscriptionTier;
  name: string;
  tagline: string;
  /** Annual price in USD. null = contact sales. */
  annualPriceUSD: number | null;
  /** Deals included per year. null = unlimited. */
  dealsPerYear: number | null;
  /** Seats per team. null = unlimited within fair use. */
  seatsMax: number | null;
  /** Which of the nine workstreams are enabled. */
  workstreams: Workstream[] | 'all';
  /** Whether custom firm-specific rules can be authored on top of defaults. */
  customRules: boolean;
  /** Max personas allowed in a scenario run. 0 = scenarios disabled. */
  maxScenarioPersonas: 0 | 500 | 1000;
  /** Supported export formats. */
  exportFormats: Array<'pdf' | 'docx' | 'xlsx' | 'api'>;
  /** Integrations available to this tier. */
  integrations: Array<
    | 'manual_upload'
    | 'sharepoint'
    | 'gdrive'
    | 'dropbox'
    | 'intralinks'
    | 'datasite'
    | 'firmex'
    | 'custom_api'
  >;
  /** Portfolio-level monitoring view. */
  portfolioMonitoring: boolean;
  /** SSO/SAML available. */
  sso: boolean;
  /** Onboarding model. */
  onboarding: 'self_serve' | 'white_glove_first_deal' | 'dedicated_csm';
  /** Stripe price id — hydrated at deploy time. */
  stripePriceId?: string;
  /** Summary bullets for marketing surfaces. */
  features: string[];
}

export const SUBSCRIPTIONS: Record<SubscriptionTier, SubscriptionDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'For single deals and small deal teams.',
    annualPriceUSD: 10_000,
    dealsPerYear: 3,
    seatsMax: 5,
    workstreams: ['legal', 'financial'],
    customRules: false,
    maxScenarioPersonas: 0,
    exportFormats: ['pdf'],
    integrations: ['manual_upload'],
    portfolioMonitoring: false,
    sso: false,
    onboarding: 'self_serve',
    features: [
      '3 deal workspaces / year',
      'Up to 5 seats',
      'Legal + Financial workstreams',
      'Default red-flag library',
      'PDF export',
    ],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    tagline: 'The full diligence platform for deal teams.',
    annualPriceUSD: 30_000,
    dealsPerYear: 20,
    seatsMax: null,
    workstreams: 'all',
    customRules: true,
    maxScenarioPersonas: 500,
    exportFormats: ['pdf', 'docx', 'xlsx'],
    integrations: [
      'manual_upload',
      'sharepoint',
      'gdrive',
      'dropbox',
      'intralinks',
      'datasite',
      'firmex',
    ],
    portfolioMonitoring: false,
    sso: false,
    onboarding: 'white_glove_first_deal',
    features: [
      '10–20 deal workspaces / year',
      'Unlimited seats (fair use)',
      'All 9 workstreams',
      'Firm-specific red-flag rules',
      'Scenario testing up to 500 personas',
      'PDF, Word, Excel exports',
      'VDR + cloud storage integrations',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Unlimited deals, custom rules, SSO, and dedicated support.',
    annualPriceUSD: null,
    dealsPerYear: null,
    seatsMax: null,
    workstreams: 'all',
    customRules: true,
    maxScenarioPersonas: 1000,
    exportFormats: ['pdf', 'docx', 'xlsx', 'api'],
    integrations: [
      'manual_upload',
      'sharepoint',
      'gdrive',
      'dropbox',
      'intralinks',
      'datasite',
      'firmex',
      'custom_api',
    ],
    portfolioMonitoring: true,
    sso: true,
    onboarding: 'dedicated_csm',
    features: [
      'Unlimited deal workspaces',
      'SSO / SAML',
      'Fully custom rule engine',
      'Scenario testing up to 1,000+ personas',
      'PDF, Word, Excel, API exports',
      'Portfolio monitoring',
      'Dedicated CSM + SLA',
      'Private deployment option',
    ],
  },
};

/** Complexity tiers inside the scenario layer (Phase 6). */
export type ScenarioTier = 'low' | 'medium' | 'high';

export const SCENARIO_PERSONA_COUNT: Record<ScenarioTier, number> = {
  low: 100,
  medium: 500,
  high: 1000,
};

export const SCENARIO_ROUNDS: Record<ScenarioTier, number> = {
  low: 3,
  medium: 5,
  high: 10,
};

/**
 * Returns the maximum scenario tier available to a given subscription tier.
 * Starter: scenarios disabled.
 * Professional: up to Medium (500 personas).
 * Enterprise: up to High (1000 personas).
 */
export function maxScenarioTierFor(subscription: SubscriptionTier): ScenarioTier | null {
  switch (subscription) {
    case 'starter':
      return null;
    case 'professional':
      return 'medium';
    case 'enterprise':
      return 'high';
  }
}
