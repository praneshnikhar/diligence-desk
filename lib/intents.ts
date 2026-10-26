// Mission definitions — each mission = one engine, several paid intents, one outcome.
// Steps with `requires` are skipped when that input field is empty.

export type Field = {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
};

export type Step = {
  key: string;
  intent: string;
  label: string;
  build: (input: Record<string, string>) => string;
  requires?: string; // field name; step skipped when absent/empty
};

export type Mission = {
  slug: "legal" | "exchange" | "stablecoin";
  name: string;
  missionNo: number;
  blurb: string;
  outcome: string;
  fields: Field[];
  steps: Step[];
};

export const MISSIONS: Record<Mission["slug"], Mission> = {
  legal: {
    slug: "legal",
    name: "Legal diligence pack",
    missionNo: 4,
    blurb:
      "Overnight multi-jurisdiction diligence on a company or counterparty: registry, sanctions, filings, adverse news, claim checks — every item priced and receipted.",
    outcome: "A signed diligence dossier with a cost line",
    fields: [
      { name: "company", label: "Company / counterparty", placeholder: "e.g. Croesus Capital Ltd", required: true },
      { name: "owner", label: "Beneficial owner (optional)", placeholder: "person or entity to screen alongside the company" },
    ],
    steps: [
      {
        key: "registry",
        intent: "CORPORATE_REGISTRY_LOOKUP",
        label: "Corporate registry",
        build: (i) =>
          `Is "${i.company}" listed in national corporate registries? Return incorporation status, jurisdiction(s), registration date, registered agent, and any beneficial ownership data you can find for "${i.company}".`,
      },
      {
        key: "sanctions",
        intent: "SANCTIONS_SCREENING_MATCH",
        label: "Sanctions screening",
        build: (i) =>
          `Screen the company "${i.company}"${
            i.owner ? ` and its beneficial owner "${i.owner}"` : ""
          } against OFAC SDN, EU consolidated and UN consolidated financial sanctions lists. Report exact and fuzzy matches with match scores and sources. If there are no hits say so explicitly.`,
      },
      {
        key: "filings",
        intent: "REGULATORY_FILING_MONITOR",
        label: "Statutory filings",
        build: (i) =>
          `Has "${i.company}" or an entity of the same name filed recent statutory disclosures with a financial oversight portal (sec.gov EDGAR, HKEX news, equivalent filings)? List the most recent filings with dates and types, or state that none were found.`,
      },
      {
        key: "news",
        intent: "WEB_SEARCH",
        label: "Adverse news",
        build: (i) =>
          `Search the live web for adverse news about the company "${i.company}": litigation, enforcement actions, fraud allegations, sanctions, winding-up petitions, or reputational red flags. Summarise the strongest findings with sources.`,
      },
      {
        key: "factcheck",
        intent: "FACT_CHECK",
        label: "Claim verification",
        build: (i) =>
          `Fact-check this claim with supporting evidence: "The company ${i.company} is a legitimate operating business with no history of fraud, enforcement action or regulatory censure." Report whether the claim is supported, contradicted or unverified.`,
      },
    ],
  },

  exchange: {
    slug: "exchange",
    name: "Exchange listing memo",
    missionNo: 1,
    blurb:
      "A venue desk asks whether to list (or touch) a token. Parallel audit, holder concentration, social authenticity, sanctions on the treasury wallet, and an on-chain sanity read.",
    outcome: "A signed listing risk memo with a cost line",
    fields: [
      { name: "contract", label: "Token contract address", placeholder: "0x…", required: true },
      { name: "wallet", label: "Treasury / creator wallet (optional)", placeholder: "0x…" },
      { name: "social", label: "Project X / Twitter handle (optional)", placeholder: "@project" },
    ],
    steps: [
      {
        key: "audit",
        intent: "SMART_CONTRACT_AUDIT",
        label: "Contract audit",
        build: (i) =>
          `Inspect the smart contract at ${i.contract} for reentrancy, access control, integer overflow, hidden mint or blacklisting powers, and drainer or honeypot patterns. Summarise findings and severity.`,
      },
      {
        key: "holders",
        intent: "TOKEN_HOLDER_COUNT",
        label: "Holder concentration",
        build: (i) =>
          `For token ${i.contract}: how many distinct addresses hold it, what does the distribution look like, and what share do the top 10 holders control? Report the numbers.`,
      },
      {
        key: "social",
        intent: "SOCIAL_BOT_DETECTION",
        label: "Social authenticity",
        requires: "social",
        build: (i) =>
          `Assess whether the social media following of ${i.social} shows automated or coordinated inauthentic behaviour: post frequency anomalies, follower graph clusters, coordinated posting. Report the estimate with reasoning.`,
      },
      {
        key: "sanctions",
        intent: "SANCTIONS_SCREENING_MATCH",
        label: "Treasury sanctions",
        requires: "wallet",
        build: (i) =>
          `Screen the wallet ${i.wallet} against known sanctions lists (OFAC, EU, UN) and illicit-address databases. Report any match with the list, name and score.`,
      },
      {
        key: "onchain",
        intent: "ONCHAIN_METRIC_VERIFY",
        label: "On-chain sanity",
        build: (i) =>
          `Verify on-chain facts for token contract ${i.contract}: total supply, decimals, LP presence if identifiable, and whether the contract is verified / source published. Report exact values.`,
      },
    ],
  },

  stablecoin: {
    slug: "stablecoin",
    name: "Compliance proof on a payment",
    missionNo: 2,
    blurb:
      "Before an agent pays a counterparty, it buys screening and risk checks and attaches the verified result as a proof — the payment carries its own compliance evidence.",
    outcome: "A payment that carries its own compliance proof",
    fields: [
      { name: "payee", label: "Payee (company or wallet)", placeholder: "Company Ltd or 0x…", required: true },
      { name: "amount", label: "Amount (USD)", placeholder: "5,000", required: true },
      {
        name: "wallet",
        label: "Payee wallet (optional — enables sanctions pass)",
        placeholder: "0x…",
      },
    ],
    steps: [
      {
        key: "sanctions",
        intent: "SANCTIONS_SCREENING_MATCH",
        label: "Sanctions screening",
        requires: "wallet",
        build: (i) =>
          `Screen the wallet ${i.wallet} and the entity "${i.payee}" against OFAC SDN, EU and UN consolidated sanctions lists. Report exact and fuzzy matches with scores, or state no hits.`,
      },
      {
        key: "registry",
        intent: "CORPORATE_REGISTRY_LOOKUP",
        label: "Counterparty registry",
        build: (i) =>
          `Is "${i.payee}" recorded in national corporate registries? Return incorporation status, jurisdiction, registered agent and beneficial ownership data if available. If the name resolves to nothing, say so.`,
      },
      {
        key: "fraud",
        intent: "FRAUD_RISK",
        label: "Payment fraud risk",
        build: (i) =>
          `Score the fraud risk of a payment of $${i.amount} USD to counterparty "${i.payee}". Consider counterparty type, amount velocity patterns typical of fraud and any known red flag categories. Return a probability estimate with reasoning.`,
      },
    ],
  },
};

export const MISSION_SLUGS = Object.keys(MISSIONS) as Array<Mission["slug"]>;
