// Party lists are already business/assignment scoped by the API. Apply the
// additional adjustment grant to both endpoints, never to just the picker.
export function canAdjustParty(staff: boolean, grants: string[], id: string): boolean {
  return !staff || grants.includes(id);
}

export function adjustmentDestinations<T extends { id: string }>(
  parties: T[], source: string, staff: boolean, grants: string[],
): T[] {
  if (!canAdjustParty(staff, grants, source)) return [];
  return parties.filter((party) => party.id !== source && canAdjustParty(staff, grants, party.id));
}

export function validAdjustmentSelection(
  selected: string | null, source: string, staff: boolean, grants: string[],
): string | null {
  return selected && selected !== source && canAdjustParty(staff, grants, source) &&
    canAdjustParty(staff, grants, selected) ? selected : null;
}