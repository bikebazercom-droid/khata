import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PartyRole } from '@workspace/api-client-react';
import { useBusinessContext } from '@/lib/businessContext';

export interface OwnerParty {
  id: string;
  name: string;
  role: PartyRole;
}

export interface Worker {
  id: string;
  identity: string; // phone or email
  status: 'active' | 'suspended' | 'pending';
  partyIds: string[];
  adjustmentPartyIds: string[];
  lastLogin: string | null;
  lastLogout: string | null;
  invitedAt: string | null;
}

export interface ActivityEntry {
  id: string;
  partyId: string;
  partyName: string;
  partyRole: string;
  actorId: string;
  actorIdentity: string;
  type: string;
  amount: number | null;
  description: string;
  createdAt: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
}

export interface CreateWorkerPayload {
  email?: string;
  phone?: string;
  partyIds: string[];
  adjustmentPartyIds: string[];
}

export interface UpdateWorkerPayload {
  partyIds?: string[];
  adjustmentPartyIds?: string[];
  status?: 'active' | 'suspended';
}

export function useOwnerParties() {
  const { selectedBusinessId } = useBusinessContext();
  return useQuery({
    queryKey: ['owner-parties', selectedBusinessId],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<OwnerParty[]> => {
      const res = await fetch(`/api/owner/parties`, {
        credentials: "include",
        headers: {
          'X-Business-Id': selectedBusinessId || ''
        }
      });
      if (!res.ok) throw new Error('Failed to fetch parties');
      return res.json();
    },
  });
}

export function useOwnerWorkers() {
  const { selectedBusinessId } = useBusinessContext();
  return useQuery({
    queryKey: ['owner-workers', selectedBusinessId],
    queryFn: async (): Promise<Worker[]> => {
      const res = await fetch(`/api/owner/workers`, {
        credentials: "include",
        headers: {
          'X-Business-Id': selectedBusinessId || ''
        }
      });
      if (!res.ok) throw new Error('Failed to fetch workers');
      const data = await res.json();
      return data.workers || [];
    },
  });
}

export function useOwnerActivity() {
  const { selectedBusinessId } = useBusinessContext();
  return useQuery({
    queryKey: ['owner-activity', selectedBusinessId],
    queryFn: async (): Promise<ActivityResponse> => {
      const res = await fetch(`/api/owner/activity`, {
        credentials: "include",
        headers: {
          'X-Business-Id': selectedBusinessId || ''
        }
      });
      if (!res.ok) throw new Error('Failed to fetch activity');
      return res.json();
    },
    staleTime: 60 * 1000, // finite freshness
  });
}

export function useCreateWorker() {
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessContext();
  return useMutation({
    mutationFn: async (payload: CreateWorkerPayload): Promise<Worker> => {
      const res = await fetch(`/api/owner/workers`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Business-Id': selectedBusinessId || ''
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create worker');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-workers', selectedBusinessId] });
    }
  });
}

export function useUpdateWorker() {
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessContext();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateWorkerPayload }): Promise<Worker> => {
      const res = await fetch(`/api/owner/workers/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'X-Business-Id': selectedBusinessId || ''
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update worker');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-workers', selectedBusinessId] });
    }
  });
}

export function useDeleteWorker() {
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessContext();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/owner/workers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-Business-Id': selectedBusinessId || '' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'স্টাফ মুছতে সমস্যা হয়েছে');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-workers', selectedBusinessId] });
      queryClient.invalidateQueries({ queryKey: ['owner-activity', selectedBusinessId] });
    },
  });
}
