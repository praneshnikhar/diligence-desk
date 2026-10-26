// Deterministic verdict logic. NO LLM in the loop: keyword heuristics over the raw miner
// output, conservatively biased towards REVIEW. Labelled as a screening heuristic in the UI.

export type StepStatus = "clear" | "flag" | "review" | "error" | "unknown";
export type Verdict = "CLEAR" | "REVIEW" | "BLOCK" | "INCOMPLETE";

const POSITIVE_NO =
  /no (sec )?(registrant|record|match(es)?|hits?|listing|finding|adverse)|none (were )?found|not (listed|found|registered|sanctioned)|zero (matches|hits)|clean|"nbHits"\s*:\s*0|"hits"\s*:\s*\[\s*\]/i;

function flagRules(stepKey: string, text: string): StepStatus {
  const t = text.slice(0, 4000);
  switch (stepKey) {
    case "sanctions": {
      // Structural san-* miner shape first: {"on_list":0|1, "sanctioned":0|1}
      const structuralHit = /"on_list"\s*:\s*1|"sanctioned"\s*:\s*1/i.test(t);
      if (structuralHit) return "flag";
      if (/"on_list"\s*:\s*0|"sanctioned"\s*:\s*0/i.test(t)) return "clear";
      // NL phrasing: "match/listed/hit" that is NOT part of a "no match" phrasing → flag
      const hit = /\bm(a|a)tch(es)?\b|\blisted\b|\bhit\b|\bidentified\b/i.test(t);
      const sanitized = POSITIVE_NO.test(t);
      const hasScore = /\b(score|TD|levenshtein|similarity)\b[^.]{0,20}(\d)/i.test(t);
      if (sanitized) return "clear";
      if (hit || hasScore) return "flag";
      return "review";
    }
    case "factcheck": {
      // FactWire-style short verdict. Structural field check first.
      const contradict = /"(verdict|answer|result)"\s*:\s*"[^"]*(false|contradicted|misleading|incorrect|unfounded|debunked)/i.test(t);
      const support = /"(verdict|answer|result)"\s*:\s*"[^"]*(true|supported|correct|accurate|verified)/i.test(t);
      if (contradict) return "flag";
      if (support) return "clear";
      return "review";
    }
    case "registry": {
      const active = /(active|registered|incorporat(ed|ion)|status\s*[:=]?\s*(active|live|in_good_standing|good))/i.test(t);
      const notFound = POSITIVE_NO.test(t) || /no record|could not (find|locate)|no such (entity|company)/i.test(t);
      if (notFound) return "flag";
      if (active) return "clear";
      return "review";
    }
    case "news": {
      // Structural check first: zero search hits beats any keyword regex (queries echo adverse terms into the JSON).
      // Covers both object responses ("nbHits":0 / "hits":[]) and miners that return a bare empty array.
      if (/^\s*\[\s*\]\s*$/.test(t) || /"nbHits"\s*:\s*0|"hits"\s*:\s*\[\s*\]/.test(t) || POSITIVE_NO.test(t)) return "clear";
      const adverse = /(fraud|lawsuit|litigation|enforcement|indict|settlement|winding[- ]?up|insolvency|ponzi|probe|investigat)/i.test(t);
      if (adverse) return "flag";
      return "review";
    }
    case "audit": {
      // GoPlus structural signals: fields are strings "0"/"1". Decide structurally when present —
      // keyword regexes false-positive on fields like "honeypot_with_same_creator":"0".
      const flagVal = (key: string) => new RegExp(`"${key}"\\s*:\\s*"(1|true)"`, "i").test(t);
      const honeypot = flagVal("is_honeypot") || flagVal("cannot_buy") || flagVal("cannot_sell_all");
      const taxHigh = [...t.matchAll(/"(?:buy|sell)_tax"\s*:\s*"(\d+(?:\.\d+)?)"|\b(?:buy|sell)_tax\b[^.\d]{0,10}(\d+(?:\.\d+)?)\s*%/gi)]
        .some((m) => parseFloat(m[1] ?? m[2] ?? "0") > 20);
      const goplusSeen = /"is_honeypot"\s*:\s*"(0|1)"/i.test(t);
      if (honeypot || taxHigh) return "flag";
      if (goplusSeen) return "clear"; // scanned by GoPlus: no honeypot, no heavy tax
      const vulnerable = /(high|critical|vulnerab|honeypot|drain|reentrancy|transfer\s*from\s*owner)/i.test(t);
      const sound = /(no (high|critical)|low risk|no issues|score\s*[:=]?\s*\d+\/100|passed)/i.test(t) && !/(high|critical|honeypot)/i.test(t);
      if (vulnerable) return "flag";
      if (sound) return "clear";
      return "review";
    }
    case "holders": {
      // Concentration heuristic: extract percentages, treat the max as the top-holder share.
      // A large absolute holder count (structural) also reads as broad distribution.
      const holders = parseInt(t.match(/"holders"\s*:\s*(\d+)/i)?.[1] ?? "0", 10);
      const pct = [...t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]));
      const top = pct.length ? Math.max(...pct) : 0;
      const explicitHigh = /(high concentration|heavily concentrated|whale (controlled|dominat)|single holder (controls|owns)|top (10|20) (holders? )?(control|own|hold)[^.]{0,30}(8\d|9\d|\d{3})\s*%)/i.test(t);
      const distributed = /(well[- ]distributed|broadly distributed|no single holder|diverse|dispersed)/i.test(t);
      if (explicitHigh || top >= 80) return "flag";
      if (distributed || holders >= 10000 || (pct.length > 0 && top < 30)) return "clear";
      return "review";
    }
    case "social": {
      const pct = [...t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]));
      const bot = pct.length ? Math.max(...pct) : 0;
      const botHigh = /(high (bot|fake|inauthentic)|predominantly (bots|automated)|coordinated inauthentic|bot[- ]?like (behaviou|activit))/i.test(t);
      const botLow = /(low (bot|fake|inauthentic)|no (significant )?(bot|automated|coordinated) (activity|pattern|behaviou)|organic engagement|predominantly (organic|human))/i.test(t);
      if (botHigh || bot >= 60) return "flag";
      if (botLow || (pct.length > 0 && bot < 25)) return "clear";
      return "review";
    }
    case "fraud": {
      // RiskWire-style: read the verdict + probability structurally when present.
      const pct = [...t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]));
      const prob = pct.length ? Math.max(...pct) : -1;
      const verdictFraud = /"verdict"\s*:\s*"[^"]*(fraud|high risk|likely)/i.test(t) || /(likely fraud|high fraud risk|probable fraud)/i.test(t);
      const verdictClean = /"verdict"\s*:\s*"[^"]*(no (fraud|concern)|low risk|unlikely)/i.test(t) || /(low fraud risk|minimal risk|no red flags)/i.test(t);
      if (verdictFraud || prob >= 50) return "flag";
      if (verdictClean || (prob >= 0 && prob < 20)) return "clear";
      return "review";
    }
    case "reserve": {
      // Reserve attestation: structural — an answer carrying reserve/backing figures attests.
      const noData = /(no (data|attestation|reserve)|could not (verify|find)|not (available|found) to)/i.test(t);
      const attested = /("answer"|"signal")\s*:\s*"[^"]*(reserves?|backing|attestat|collateral)[^"]*\d/i.test(t) || /(reserves?|backing|collateral|attestation)[^.]{0,60}\d/i.test(t);
      if (noData) return "review";
      if (attested) return "clear";
      return "review";
    }
    case "onchain": {
      // For a listing memo an unverified contract or dead liquidity is a hard stop.
      const unverified = /(not verified|unverified|source (code )?not (published|available)|no verified source|unverified contract)/i.test(t);
      const noLp = /(no (lp|liquidity pool)|liquidity (is )?(absent|removed|zero|empty))/i.test(t);
      const hasSupply = /"(?:total|circulating) supply[^"]*"\s*:|"answer"\s*:\s*"[^"]*(?:total|circulating) supply[^"]*\d/i.test(t) || /(total|circulating) supply\b[^.]{0,40}\d/i.test(t);
      if (unverified || noLp) return "flag";
      if (hasSupply) return "clear";
      return "review";
    }
    default:
      return POSITIVE_NO.test(t) ? "clear" : "unknown";
  }
}

export function assessStep(stepKey: string, rawResult: string): { status: StepStatus; excerpt: string } {
  const excerpt = rawResult.replace(/\s+/g, " ").trim().slice(0, 600);
  if (!rawResult?.trim()) return { status: "unknown", excerpt: "(no result text)" };
  let status = flagRules(stepKey, rawResult);
  if (status === "unknown") status = "review"; // never claim CLEAR without a positive signal
  return { status, excerpt };
}

export function summarize(statuses: Array<string | StepStatus>): { verdict: Verdict; confidence: string } {
  let stepStatuses = [...statuses];
  if (stepStatuses.every((s) => s === "error" || s === "unknown")) {
    return { verdict: "INCOMPLETE", confidence: "no usable answers" };
  }
  if (stepStatuses.length === 0) return { verdict: "INCOMPLETE", confidence: "no answers" };
  if (stepStatuses.includes("flag")) return { verdict: "BLOCK", confidence: "hard red flag present" };
  stepStatuses = stepStatuses.filter((s) => s !== "error" && s !== "unknown");
  const clearCount = stepStatuses.filter((s) => s === "clear").length;
  if (clearCount / stepStatuses.length >= 0.6) return { verdict: "CLEAR", confidence: "majority of independent checks agree clean" };
  return { verdict: "REVIEW", confidence: "not enough positive signals for CLEAR" };
}

export const VERDICT_DISCLAIMER =
  "Heuristic screening over machine-bought intelligence. Not legal or compliance advice.";
