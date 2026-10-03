import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAuthMeQueryKey,
  getListBusinessesQueryKey,
  useListBusinesses,
  type BusinessSummary,
} from '@workspace/api-client-react';
import { setExtraHeaders } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { resolveAuthorizedBusiness } from '@/lib/businessSelection';

const STORAGE_KEY = 'banglakhata.mobile.selected-business-id';
const PLATFORM_HEADERS = { 'x-client-platform': Platform.OS === 'web' ? 'web' : 'mobile' };
const PRESERVED_QUERY_PATHS = new Set([
  String(getGetAuthMeQueryKey()[0]),
  String(getListBusinessesQueryKey()[0]),
]);

type BusinessScopeValue = {
  businesses: BusinessSummary[];
  selectedBusinessId: string | null;
  selectedBusinessName: string;
  canSwitchBusiness: boolean;
  isLoadingBusinesses: boolean;
  businessesError: unknown;
  isSwitcherOpen: boolean;
  openBusinessSwitcher: () => void;
  closeBusinessSwitcher: () => void;
  refreshBusinesses: () => Promise<void>;
  switchBusiness: (businessId: string) => Promise<void>;
};

const BusinessScopeContext = createContext<BusinessScopeValue | null>(null);

function setBusinessHeader(businessId: string | null) {
  setExtraHeaders({
    ...PLATFORM_HEADERS,
    ...(businessId ? { 'x-business-id': businessId } : {}),
  });
}

function clearBusinessScopedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.removeQueries({
    predicate: (query) => !PRESERVED_QUERY_PATHS.has(String(query.queryKey[0])),
  });
}

export function BusinessScopeProvider({ children }: React.PropsWithChildren) {
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [storedBusinessId, setStoredBusinessId] = useState<string | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  const businessesQuery = useListBusinesses({
    query: {
      enabled: identity?.role === 'owner',
      queryKey: [...getListBusinessesQueryKey(), identity?.userId ?? 'signed-out'],
    },
  });
  const businesses = businessesQuery.data ?? [];

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (active) setStoredBusinessId(value);
      })
      .catch(() => {
        if (active) setStoredBusinessId(null);
      })
      .finally(() => {
        if (active) setStorageLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!identity) {
      setBusinessHeader(null);
      setSelectedBusinessId(null);
      return;
    }

    if (identity.role !== 'owner') {
      setBusinessHeader(null);
      setSelectedBusinessId(identity.businessId);
      return;
    }

    if (!storageLoaded || !businessesQuery.isSuccess) return;

    const selectedBusiness = resolveAuthorizedBusiness(businesses, storedBusinessId, identity.businessId);
    const selectedId = selectedBusiness?.id ?? identity.businessId;
    const selectedIsAuthorized = businesses.some((business) => business.id === selectedId);
    const previousScopeId = selectedBusinessId ?? identity.businessId;

    setBusinessHeader(selectedIsAuthorized ? selectedId : null);
    if (previousScopeId !== selectedId) clearBusinessScopedQueries(queryClient);
    setSelectedBusinessId(selectedId);

    if (selectedIsAuthorized) {
      void AsyncStorage.setItem(STORAGE_KEY, selectedId).catch(() => undefined);
    } else {
      void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    }
  }, [
    businesses,
    businessesQuery.isSuccess,
    identity,
    queryClient,
    selectedBusinessId,
    storageLoaded,
    storedBusinessId,
  ]);

  const switchBusiness = useCallback(async (businessId: string) => {
    if (identity?.role !== 'owner' || !businesses.some((business) => business.id === businessId)) {
      throw new Error('এই খাতায় প্রবেশের অনুমতি নেই।');
    }
    if (businessId === selectedBusinessId) {
      setIsSwitcherOpen(false);
      return;
    }

    await AsyncStorage.setItem(STORAGE_KEY, businessId);
    setStoredBusinessId(businessId);
    setBusinessHeader(businessId);
    clearBusinessScopedQueries(queryClient);
    setSelectedBusinessId(businessId);
    setIsSwitcherOpen(false);
  }, [businesses, identity?.role, queryClient, selectedBusinessId]);

  const refreshBusinesses = useCallback(async () => {
    await businessesQuery.refetch();
  }, [businessesQuery.refetch]);

  const selectedBusinessName =
    businesses.find((business) => business.id === selectedBusinessId)?.name
    ?? identity?.businessName
    ?? 'আমার খাতা';

  const value = useMemo<BusinessScopeValue>(() => ({
    businesses,
    selectedBusinessId,
    selectedBusinessName,
    canSwitchBusiness: identity?.role === 'owner'
      && (businesses.length > 1 || businessesQuery.isLoading || !!businessesQuery.error),
    isLoadingBusinesses: businessesQuery.isLoading,
    businessesError: businessesQuery.error,
    isSwitcherOpen,
    openBusinessSwitcher: () => setIsSwitcherOpen(true),
    closeBusinessSwitcher: () => setIsSwitcherOpen(false),
    refreshBusinesses,
    switchBusiness,
  }), [
    businesses,
    businessesQuery.error,
    businessesQuery.isLoading,
    identity?.role,
    isSwitcherOpen,
    refreshBusinesses,
    selectedBusinessId,
    selectedBusinessName,
    switchBusiness,
  ]);

  return <BusinessScopeContext.Provider value={value}>{children}</BusinessScopeContext.Provider>;
}

export function useBusinessScope() {
  const context = useContext(BusinessScopeContext);
  if (!context) throw new Error('useBusinessScope must be used inside BusinessScopeProvider');
  return context;
}