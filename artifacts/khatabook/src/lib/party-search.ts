export interface SearchableParty {
  name: string;
  phone: string;
}

export function filterPartiesBySearch<T extends SearchableParty>(
  parties: readonly T[],
  search: string,
): T[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return [...parties];
  return parties.filter((party) =>
    party.name.toLocaleLowerCase().includes(term) ||
    party.phone.toLocaleLowerCase().includes(term),
  );
}
