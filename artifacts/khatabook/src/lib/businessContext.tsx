/**
 * BusinessContext — tracks which business the user is currently viewing.
 *
 * - Persists the selected businessId to localStorage so it survives refreshes.
 * - Exports `setExtraHeader` from the API client so every fetch automatically
 *   carries `X-Business-Id` when a non-default business is active.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { setExtraHeaders } from '@workspace/api-client-react';

const STORAGE_KEY = 'selected_business_id';

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
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  // Whenever the selected business changes, inject it as a request header
  useEffect(() => {
    if (selectedBusinessId) {
      setExtraHeaders({ 'x-business-id': selectedBusinessId });
      localStorage.setItem(STORAGE_KEY, selectedBusinessId);
    } else {
      setExtraHeaders({});
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedBusinessId]);

  const setSelectedBusiness = useCallback((id: string) => {
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
