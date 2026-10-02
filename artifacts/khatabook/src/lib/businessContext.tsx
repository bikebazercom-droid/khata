/**
 * BusinessContext — tracks which business the user is currently viewing.
 *
 * - Persists the selected businessId to localStorage so it survives refreshes.
 * - Exports `setExtraHeader` from the API client so every fetch automatically
 *   carries `X-Business-Id` when a non-default business is active.
 */
import { createContext, useCallback, useContext, useState } from 'react';
import { setExtraHeaders } from '@workspace/api-client-react';

const STORAGE_KEY = 'selected_business_id';
const initialSelectedBusinessId =
  typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);

// Set the header before child query hooks can make their first request. A
// React effect is too late: queries start during the initial render.
setExtraHeaders(initialSelectedBusinessId
  ? { 'x-business-id': initialSelectedBusinessId }
  : {});

export interface BusinessInfo {
  id: string;
  name: string;
  partyCount: number;
  createdAt?: string;
}

interface BusinessContextValue {
  selectedBusinessId: string | null;
  setSelectedBusiness: (id: string) => void;
  businesses: BusinessInfo[];
  setBusinesses: (b: BusinessInfo[]) => void;
  isSwitcherOpen: boolean;
  openSwitcher: () => void;
  closeSwitcher: () => void;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessContextProvider({ children }: { children: React.ReactNode }) {
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(
    () => initialSelectedBusinessId,
  );
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  const setSelectedBusiness = useCallback((id: string) => {
    // Update the request scope synchronously so a query triggered by the next
    // render cannot run with the previous account's header.
    setExtraHeaders({ 'x-business-id': id });
    localStorage.setItem(STORAGE_KEY, id);
    setSelectedBusinessId(id);
  }, []);

  const openSwitcher  = useCallback(() => setIsSwitcherOpen(true), []);
  const closeSwitcher = useCallback(() => setIsSwitcherOpen(false), []);

  return (
    <BusinessContext.Provider value={{
      selectedBusinessId,
      setSelectedBusiness,
      businesses,
      setBusinesses,
      isSwitcherOpen,
      openSwitcher,
      closeSwitcher,
    }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinessContext() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusinessContext must be used inside BusinessContextProvider');
  return ctx;
}
