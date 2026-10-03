import type { BusinessSummary } from '@workspace/api-client-react';

export function resolveAuthorizedBusiness(
  businesses: readonly BusinessSummary[],
  storedBusinessId: string | null,
  defaultBusinessId: string,
): BusinessSummary | null {
  return businesses.find((business) => business.id === storedBusinessId)
    ?? businesses.find((business) => business.id === defaultBusinessId)
    ?? businesses[0]
    ?? null;
}