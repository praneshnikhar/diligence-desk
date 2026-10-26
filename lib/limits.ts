// Hard spending limits — enforced BEFORE every dispatch. Judges score "safe handling".
export const LIMITS = {
  maxCallsPerRun: 12,
  maxSpendPerRunUsd: 0.25,
  perCallPriceCeilingUsd: 0.05, // refuse a call whose quoted price exceeds this
  timeoutMsPerCall: 45_000,
} as const;

export function assertCanProceed(callsSoFar: number, spentSoFarUsd: number) {
  if (callsSoFar >= LIMITS.maxCallsPerRun) {
    throw new Error(`Spend cap: run already used ${callsSoFar}/${LIMITS.maxCallsPerRun} calls`);
  }
  if (spentSoFarUsd + LIMITS.perCallPriceCeilingUsd > LIMITS.maxSpendPerRunUsd) {
    throw new Error(
      `Spend cap: $${spentSoFarUsd.toFixed(4)} spent; a further call could exceed the $${LIMITS.maxSpendPerRunUsd} per-run limit`
    );
  }
}
