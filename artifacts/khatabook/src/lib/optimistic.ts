/**
 * Shared helpers for optimistic React Query cache updates across the app's
 * mutation flows (create ledger entry, create party, delete party, etc.).
 *
 * Pattern: every mutation applies its expected effect to the cache
 * synchronously in `onMutate` (so the UI reflects the final state in the
 * same tick the user acts, with zero loading/spinner state), snapshots the
 * previous cache values for rollback, and silently reconciles with the
 * server's authoritative response via `invalidateQueries` in `onSettled`
 * (a background refetch, invisible to the user). If the request fails,
 * `onError` restores the snapshot — the only user-visible sign of a failure
 * is the optimistic change quietly reverting; errors are logged to the
 * console for debugging rather than surfaced via toast/spinner, per the
 * "zero loading UI" requirement.
 */
import { BalanceType, type DashboardSummary, type Party } from '@workspace/api-client-react';

/** Party balance expressed as a signed number: positive = "you will get". */
export function signedBalance(party: Pick<Party, 'currentBalance' | 'balanceType'>) {
  return party.balanceType === BalanceType.YOU_WILL_GET ? party.currentBalance : -party.currentBalance;
}

/** Applies a signed delta (positive = party owes shop owner more) to a party's balance fields. */
export function applyBalanceDelta<T extends Pick<Party, 'currentBalance' | 'balanceType'>>(party: T, delta: number): T {
  const nextSigned = signedBalance(party) + delta;
  return {
    ...party,
    currentBalance: Math.abs(nextSigned),
    balanceType: nextSigned >= 0 ? BalanceType.YOU_WILL_GET : BalanceType.YOU_WILL_GIVE,
  };
}

/** How much a single party's current balance contributes to each dashboard aggregate. */
export function summaryContribution(party: Pick<Party, 'currentBalance' | 'balanceType'> | undefined) {
  if (!party) return { get: 0, give: 0 };
  return party.balanceType === BalanceType.YOU_WILL_GET
    ? { get: party.currentBalance, give: 0 }
    : { get: 0, give: party.currentBalance };
}

/** Shifts the dashboard summary's aggregate totals by the difference between a party's before/after balance. */
export function shiftSummaryForPartyChange(
  summary: DashboardSummary,
  before: Pick<Party, 'currentBalance' | 'balanceType'> | undefined,
  after: Pick<Party, 'currentBalance' | 'balanceType'> | undefined
): DashboardSummary {
  const beforeContribution = summaryContribution(before);
  const afterContribution = summaryContribution(after);
  return {
    ...summary,
    youWillGet: summary.youWillGet - beforeContribution.get + afterContribution.get,
    youWillGive: summary.youWillGive - beforeContribution.give + afterContribution.give,
  };
}
