export type WorkerStatus = 'active' | 'pending' | 'suspended';

export function isValidWorkerIdentity(identity: string): boolean {
  const value = identity.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    /^(?:\+?88)?01[3-9]\d{8}$/.test(value);
}

export function toggleAccessId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function nextWorkerStatus(status: WorkerStatus): 'active' | 'suspended' {
  return status === 'suspended' ? 'active' : 'suspended';
}

export function workerStatusLabel(status: WorkerStatus): string {
  if (status === 'active') return 'সক্রিয়';
  if (status === 'pending') return 'পেন্ডিং';
  return 'সাসপেন্ড';
}