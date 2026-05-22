/** AGENT_CONTEXT — סיכום מצב לקוח עבור שכבת האייג'נטים (§4.x, §5.6). */

export interface CustomerContextSummary {
  customerId: string;
  identity: {
    israelId: string;
    fullName: string;
    birthDate?: string;
    city?: string;
    ageYears?: number;
  };
  authorization: {
    hasActive: boolean;
    expiresInDays?: number;
    scope?: string;
  };
  portfolio: {
    accountsCount: number;
    activeAccountsCount: number;
    totalAssets: number;
    manufacturers: string[]; // distinct manufacturer names
    products: string[];      // distinct product codes
  };
  recentActivity: {
    lastDepositMonth?: string;
    lastDepositAmount?: number;
    last12MonthsTotal: number;
    activeTerminations: number;
  };
  rejects: {
    openCount: number;
    criticalCount: number;
    highCount: number;
    overdueCount: number;
    bySource: Record<string, number>; // INTERNAL / MANUFACTURER / CLEARING / DISCREPANCY
  };
}

export interface AgentContextRow {
  customerId: string;
  summary: CustomerContextSummary;
  embedding: number[];
  riskFlags: string[];
  opportunityFlags: string[];
  refreshedAt: string;
  version: number;
  summaryHash: string;
}

export interface BriefingResult {
  customerId: string;
  briefing: string;             // Hebrew narrative
  model: string;
  generatedAt: string;
  cacheRead?: number;
  cacheCreation?: number;
  inputTokens?: number;
  outputTokens?: number;
  fallback?: boolean;           // true אם השתמשנו במוק (ANTHROPIC_API_KEY חסר)
}
