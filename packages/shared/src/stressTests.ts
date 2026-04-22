/**
 * Stress Test Taxonomy
 *
 * Maps 1:1 to the PE Logic Tree in the Source of Truth PDF § 4.
 * Each test defines its preliminary inquiry, output variables, and
 * the input fields required from the user.
 */

export type StressTestId =
  | 'historical'
  | 'hypothetical'
  | 'factor-push'
  | 'sensitivity'
  | 'concentration'
  | 'liquidity'
  | 'valuation'
  | 'leverage'
  | 'statistical'
  | 'reverse'
  | 'operating'
  | 'fund-structure'
  | 'prime';

export interface StressTestInput {
  label: string;
  key: string;
  type: 'number' | 'text' | 'percentage';
  placeholder?: string;
  /** Tooltip or helper text shown below the field. */
  hint?: string;
}

export interface StressTestType {
  id: StressTestId;
  name: string;
  /** Single-line description of the question this test answers. */
  preliminaryInquiry: string;
  /** Headline output variables synthesized in Phase 4. */
  outputVariables: string[];
  inputs: StressTestInput[];
  /**
   * Persona archetype distribution for Phase 2 — informs Claude which
   * kinds of agents to generate for this test type. Sums to 1.0.
   */
  archetypeBias: Record<string, number>;
}

export const STRESS_TESTS: StressTestType[] = [
  {
    id: 'historical',
    name: 'Historical Scenario',
    preliminaryInquiry: 'How would the portfolio perform if past crises reoccurred?',
    outputVariables: ['Contribution rates', 'Distribution rates', 'NAV trajectories'],
    inputs: [
      { label: 'Portfolio Value ($M)', key: 'portfolioValue', type: 'number' },
      { label: 'Past Crisis Event', key: 'crisisEvent', type: 'text', placeholder: 'e.g. 2008 GFC' },
      { label: 'Holding Period (Years)', key: 'holdingPeriod', type: 'number' }
    ],
    archetypeBias: { institutionalLP: 0.3, retailInvestor: 0.2, debtHolder: 0.2, portfolioManager: 0.2, regulator: 0.1 }
  },
  {
    id: 'hypothetical',
    name: 'Hypothetical Scenario',
    preliminaryInquiry: 'What are the impacts of unprecedented macro/market events?',
    outputVariables: ['Forecasted IRR', 'Cash-on-Cash multiples', 'Terminal value projections'],
    inputs: [
      { label: 'Event Description', key: 'eventDesc', type: 'text' },
      { label: 'Macro Shift (%)', key: 'macroShift', type: 'percentage' },
      { label: 'Target Multiple', key: 'targetMultiple', type: 'number' }
    ],
    archetypeBias: { institutionalLP: 0.25, retailInvestor: 0.15, debtHolder: 0.15, portfolioManager: 0.25, regulator: 0.1, counterparty: 0.1 }
  },
  {
    id: 'factor-push',
    name: 'Stylized (Factor Push)',
    preliminaryInquiry: 'How do systematic shocks to individual factors impact the portfolio?',
    outputVariables: ['Delta in NAV', 'Interest Coverage Ratio', 'Covenant trigger status'],
    inputs: [
      { label: 'Factor Type', key: 'factorType', type: 'text', placeholder: 'e.g. Interest Rates' },
      { label: 'Shock Magnitude (bps)', key: 'magnitude', type: 'number' }
    ],
    archetypeBias: { institutionalLP: 0.2, debtHolder: 0.35, portfolioManager: 0.25, counterparty: 0.2 }
  },
  {
    id: 'sensitivity',
    name: 'Sensitivity Analysis',
    preliminaryInquiry: 'Which specific input assumptions drive the most risk?',
    outputVariables: ['Sensitivity coefficients', 'Tornado chart rankings', 'NPV/IRR variance'],
    inputs: [
      { label: 'Key Variable', key: 'keyVariable', type: 'text' },
      { label: 'Variance Range (+/- %)', key: 'range', type: 'percentage' }
    ],
    archetypeBias: { portfolioManager: 0.4, institutionalLP: 0.3, analyst: 0.2, auditor: 0.1 }
  },
  {
    id: 'concentration',
    name: 'Concentration Risk',
    preliminaryInquiry: 'How does overexposure create localized vulnerability?',
    outputVariables: ['Portfolio-level impact (%)', 'Stressed correlation coefficients'],
    inputs: [
      { label: 'Exposure Segment', key: 'segment', type: 'text' },
      { label: 'Concentration Level (%)', key: 'concentration', type: 'percentage' }
    ],
    archetypeBias: { institutionalLP: 0.35, portfolioManager: 0.3, riskOfficer: 0.2, debtHolder: 0.15 }
  },
  {
    id: 'liquidity',
    name: 'Liquidity Stress',
    preliminaryInquiry: 'Can the fund survive the timing mismatch of cash flows?',
    outputVariables: ['Net Cash Flow (Valley of Death)', 'Liquidity buffer duration', 'Forced sale discount %'],
    inputs: [
      { label: 'Cash Reserves ($M)', key: 'reserves', type: 'number' },
      { label: 'Drawdown Estimate (%)', key: 'drawdown', type: 'percentage' }
    ],
    archetypeBias: { institutionalLP: 0.3, secondaryBuyer: 0.25, debtHolder: 0.2, portfolioManager: 0.15, gp: 0.1 }
  },
  {
    id: 'valuation',
    name: 'Valuation Stress',
    preliminaryInquiry: 'How does market lag or multiple compression affect NAV?',
    outputVariables: ['Revenue multiple', 'EBITDA multiple', 'Adjusted NAV'],
    inputs: [
      { label: 'Current Multiple', key: 'currentMultiple', type: 'number' },
      { label: 'Compression Target (%)', key: 'compression', type: 'percentage' }
    ],
    archetypeBias: { portfolioManager: 0.35, auditor: 0.2, institutionalLP: 0.2, analyst: 0.15, competitor: 0.1 }
  },
  {
    id: 'leverage',
    name: 'Leverage & Credit',
    preliminaryInquiry: 'Can companies maintain coverage and avoid breaches?',
    outputVariables: ['ICR', 'FCCR', 'Debt/EBITDA ratio'],
    inputs: [
      { label: 'Debt Load ($M)', key: 'debt', type: 'number' },
      { label: 'EBITDA ($M)', key: 'ebitda', type: 'number' },
      { label: 'Interest Rate (%)', key: 'rate', type: 'percentage' }
    ],
    archetypeBias: { debtHolder: 0.4, portfolioManager: 0.25, riskOfficer: 0.15, ratingAgency: 0.2 }
  },
  {
    id: 'statistical',
    name: 'Statistical Risk',
    preliminaryInquiry: 'What is the probability of extreme losses?',
    outputVariables: ['VaR (95%/99%)', 'Expected Shortfall (CVaR)', 'Max Drawdown'],
    inputs: [
      { label: 'Confidence Level (%)', key: 'confidence', type: 'percentage' },
      { label: 'Historical Lookback (Months)', key: 'lookback', type: 'number' }
    ],
    archetypeBias: { riskOfficer: 0.4, analyst: 0.3, portfolioManager: 0.2, auditor: 0.1 }
  },
  {
    id: 'reverse',
    name: 'Reverse Stress',
    preliminaryInquiry: 'What combination of events triggers an unacceptable outcome?',
    outputVariables: ['Loss threshold breach metrics', 'Break-point scenario combinations'],
    inputs: [
      { label: 'Max Acceptable Loss ($M)', key: 'maxLoss', type: 'number' },
      { label: 'Critical Threshold (%)', key: 'threshold', type: 'percentage' }
    ],
    archetypeBias: { riskOfficer: 0.35, regulator: 0.2, portfolioManager: 0.2, institutionalLP: 0.15, counterparty: 0.1 }
  },
  {
    id: 'operating',
    name: 'Operating (Company-level)',
    preliminaryInquiry: 'How does performance deterioration affect cash runway?',
    outputVariables: ['Cash runway (months)', 'Break-even revenue', 'Fixed cost coverage'],
    inputs: [
      { label: 'Monthly Burn ($M)', key: 'burn', type: 'number' },
      { label: 'Revenue Growth (%)', key: 'growth', type: 'percentage' }
    ],
    archetypeBias: { ceo: 0.25, cfo: 0.25, employee: 0.2, customer: 0.15, supplier: 0.15 }
  },
  {
    id: 'fund-structure',
    name: 'Fund Structure',
    preliminaryInquiry: 'How do LP defaults or extensions impact fund economics?',
    outputVariables: ['Fee drag impact', 'Hurdle rate clearing probability', 'Carried interest waterfall variance'],
    inputs: [
      { label: 'LP Commitment ($M)', key: 'commitment', type: 'number' },
      { label: 'Default Probability (%)', key: 'defaultProb', type: 'percentage' }
    ],
    archetypeBias: { institutionalLP: 0.4, gp: 0.25, placementAgent: 0.15, secondaryBuyer: 0.1, consultant: 0.1 }
  },
  {
    id: 'prime',
    name: 'PRIME Framework',
    preliminaryInquiry: 'How do macro factors erode real returns?',
    outputVariables: ['Real return % vs. Nominal', 'Reinvestment rate impact'],
    inputs: [
      { label: 'Nominal Return Target (%)', key: 'nominalReturn', type: 'percentage' },
      { label: 'Inflation Forecast (%)', key: 'inflation', type: 'percentage' }
    ],
    archetypeBias: { institutionalLP: 0.3, portfolioManager: 0.25, economist: 0.2, analyst: 0.15, retailInvestor: 0.1 }
  }
];

export function getStressTest(id: string): StressTestType | undefined {
  return STRESS_TESTS.find((t) => t.id === id);
}
