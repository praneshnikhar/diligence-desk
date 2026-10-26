// Deterministic verdict logic. NO LLM in the loop: keyword heuristics over the raw miner
// output, conservatively biased towards REVIEW. Labelled as a screening heuristic in the UI.

export type StepStatus = "clear" | "flag" | "review" | "error" | "unknown";
export type Verdict = "CLEAR" | "REVIEW" | "BLOCK" | "INCOMPLETE";

const POSITIVE_NO = /no (match|matches|hits|hit|listing|record|adverse|findings?)|not (listed|found|sanctioned)|zero (matches|hits)|clean/i;

function flagRules(stepKey: string, text: string): StepStatus {
  const t = text.slice(0, 4000);
  switch (stepKey) {
    case "sanctions": {
      // "match/listed/hit" that is NOT part of a "no match" phrasing → flag
      const hit = /\bm(a|a)tch(es)?\b|\blisted\b|\bhit\b|\bidentified\b/i.test(t);
      const sanitized = POSITIVE_NO.test(t);
      const hasScore = /\b(score|TD|levenshtein|similarity)\b[^.]{0,20}(\d)/i.test(t);
      if (sanitized) return "clear";
      if (hit || hasScore) return "flag";
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
      const adverse = /(fraud|lawsuit|litigation|enforcement|indict|settlement|winding[- ]?up|insolvency|ponzi|probe|investigat)/i.test(t);
      if (adverse) return "flag";
      if (POSITIVE_NO.test(t)) return "clear";
      return "review";
    }
    case "audit": {
      const vulnerable = /(high|critical|vulnerab|honeypot|drain|reentrancy|transfer\s*from\s*owner)/i.test(t);
      const sound = /(no (high|critical)|low risk|no issues|score\s*[:=]?\s*\d+\/100|passed)/i.test(t) && !/(high|critical|honeypot)/i.test(t);
      if (vulnerable) return "flag";
      if (sound) return "clear";
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

export function summarize(statuses: StepStatus[]): { verdict: Verdict; confidence: string } {
  let stepStatuses = [...statuses];
  if (stepStatuses.every((s) => s === "error" || s === "unknown")) {
    return { verdict: "INCOMPLETE", confidence: "no usable answers" };
  }
  if (stepStatuses.length === 0) return { verdict: "INCOMPLETE", confidence: "no answers" };
  if (stepStatuses.includes("flag")) return { verdict: "BLOCK", confidence: "hard red flag present" };
  if (stepStatuses.filter((s) => s === "clear").length === stepStatuses.filter((s) => s === "review" || s === "clear").length) {
    // all answered steps agree on clear → can say CLEAR only if >half answerable steps are clear
  }
  stepStatuses = stepStatuses.filter((s) => s !== "error" && s !== "unknown");
  const clearCount = stepStatuses.filter((s) => s === "clear").length;
  if (clearCount / stepStatuses.length >= 0.6) return { verdict: "CLEAR", confidence: "majority of independent checks agree clean" };
  return { verdict: "REVIEW", confidence: "not enough positive signals for CLEAR" };
}

export const VERDICT_DISCLAIMER =
  "Heuristic screening over machine-bought intelligence. Not legal or compliance advice.";
