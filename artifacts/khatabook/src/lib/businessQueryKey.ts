export function businessScopedQueryKey(
  queryKey: readonly unknown[],
  businessId: string | null,
): readonly unknown[] {
  return [...queryKey, { activeBusinessId: businessId ?? '__default_business__' }];
}