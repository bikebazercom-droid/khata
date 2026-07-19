import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useBusinessContext, type BusinessInfo } from '@/lib/businessContext';
import { setExtraHeaders } from '@workspace/api-client-react';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?';
}

const AVATAR_COLORS = ['#1B3A6B', '#0052B4', '#065F46', '#7C3AED', '#B45309', '#DC2626'];

export function BusinessSwitcherDrawer() {
  const {
    selectedBusinessId,
    setSelectedBusiness,
    businesses,
    setBusinesses,
    isSwitcherOpen,
    closeSwitcher,
  } = useBusinessContext();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // When set to a business ID, show the delete confirmation panel instead of the list
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Fetch business list whenever the drawer opens ──────────────────────────
  const fetchBusinesses = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/businesses', { credentials: 'include' });
      if (!res.ok) return;
      const data: BusinessInfo[] = await res.json();
      setBusinesses(data);
      if (!selectedBusinessId && data.length > 0) {
        setSelectedBusiness(data[0]!.id);
      }
    } catch (err) {
      console.error('Failed to fetch businesses:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBusinessId, setBusinesses, setSelectedBusiness]);

  useEffect(() => {
    if (isSwitcherOpen) {
      void fetchBusinesses();
      setIsAddingNew(false);
      setNewName('');
      setConfirmDeleteId(null);
    }
  }, [isSwitcherOpen, fetchBusinesses]);

  // ── Switch active business ─────────────────────────────────────────────────
  async function handleSwitch(id: string) {
    if (id === selectedBusinessId) { closeSwitcher(); return; }
    setSelectedBusiness(id);
    localStorage.setItem('selected_business_id', id);
    setExtraHeaders({ 'x-business-id': id });
    queryClient.clear();
    await queryClient.invalidateQueries();
    closeSwitcher();
  }

  // ── Create new business ────────────────────────────────────────────────────
  async function handleCreate() {
    if (!newName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error('create failed');
      const created: BusinessInfo = await res.json();
      setNewName('');
      setIsAddingNew(false);
      setBusinesses([...businesses, created]);
      await handleSwitch(created.id);
    } catch (err) {
      console.error('Failed to create business:', err);
      alert('নতুন ব্যবসা প্রতিষ্ঠান যোগ করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setIsCreating(false);
    }
  }

  // ── Confirm delete ─────────────────────────────────────────────────────────
  async function handleConfirmDelete() {
    const targetId = confirmDeleteId;
    if (!targetId || isDeleting) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/businesses/${targetId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errMsg = await response.text();
        throw new Error(errMsg);
      }

      // Sync localStorage / header before reload
      if (targetId === selectedBusinessId) {
        const remaining = businesses.filter((b) => b.id !== targetId);
        if (remaining.length > 0) {
          localStorage.setItem('selected_business_id', remaining[0]!.id);
          setExtraHeaders({ 'x-business-id': remaining[0]!.id });
        } else {
          localStorage.removeItem('selected_business_id');
          setExtraHeaders({});
        }
      }

      queryClient.clear();
      toast.success('🎉 বাংলা খাতা: আপনার খাতাটি সফলভাবে এবং চিরতরে মুছে ফেলা হয়েছে!', {
        duration: 2500,
        style: {
          background: '#1E3A8A',
          color: '#ffffff',
          fontWeight: '600',
          padding: '16px',
          borderRadius: '12px',
          fontSize: '15px',
        },
      });
      setTimeout(() => { window.location.reload(); }, 1500);
    } catch (err) {
      console.error('FATAL CRASH DURING DELETION:', err);
      toast.error('ডিলিট করা যায়নি! আবার চেষ্টা করুন।');
      setIsDeleting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Drawer open={isSwitcherOpen} onOpenChange={(open) => { if (!open) closeSwitcher(); }}>
      <DrawerContent>

        {/* ── Delete confirmation (replaces list entirely) ── */}
        {confirmDeleteId ? (
          <div className="px-5 pt-6 pb-8 flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center text-3xl">
              🗑️
            </div>
            <p className="text-[18px] font-bold text-slate-800">খাতা ডিলিট করুন?</p>
            <p className="text-[14px] text-slate-500 leading-snug">
              এই খাতার সব গ্রাহক এবং লেনদেনের তথ্য চিরতরে মুছে যাবে।
              <br />
              <span className="font-semibold text-red-600">এটি পূর্বাবস্থায় ফেরানো যাবে না।</span>
            </p>

            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              {/* না — cancel */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                disabled={isDeleting}
                style={{
                  flex: 1,
                  backgroundColor: '#F3F4F6',
                  color: '#1F2937',
                  border: 'none',
                  padding: '14px 0',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer',
                  opacity: isDeleting ? 0.6 : 1,
                }}
              >
                না
              </button>

              {/* হ্যাঁ, ডিলিট করুন — confirm */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleConfirmDelete(); }}
                disabled={isDeleting}
                style={{
                  flex: 1,
                  backgroundColor: '#DC2626',
                  color: '#ffffff',
                  border: 'none',
                  padding: '14px 0',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer',
                  opacity: isDeleting ? 0.6 : 1,
                }}
              >
                {isDeleting ? 'মুছছে…' : 'হ্যাঁ, ডিলিট করুন'}
              </button>
            </div>
          </div>

        ) : (

          /* ── Business list ── */
          <div className="px-4 pb-6 pt-2 space-y-3 max-h-[80vh] overflow-y-auto">

            <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-1">
              আপনার খাতাবুকগুলো
            </p>

            {isLoading ? (
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {businesses.map((biz, idx) => {
                  const isActive = biz.id === selectedBusinessId;
                  const color = AVATAR_COLORS[idx % AVATAR_COLORS.length]!;
                  return (
                    <div
                      key={biz.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleSwitch(biz.id)}
                      onKeyDown={(e) => e.key === 'Enter' && void handleSwitch(biz.id)}
                      className="rounded-xl border-2 p-4 cursor-pointer transition-all active:scale-[0.98]"
                      style={{ borderColor: isActive ? '#0052B4' : '#E5E7EB' }}
                    >
                      {/* Top row: avatar + name + radio */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-[15px] shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {initials(biz.name)}
                          </div>
                          <div>
                            <p className="text-[17px] font-bold text-slate-800 leading-tight">{biz.name}</p>
                            <p className="text-[13px] text-slate-400 mt-0.5">{biz.partyCount} গ্রাহক</p>
                          </div>
                        </div>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: isActive ? '#0052B4' : 'transparent',
                            border: isActive ? 'none' : '2px solid #9CA3AF',
                          }}
                        >
                          {isActive && <span className="text-white text-xs font-bold">✓</span>}
                        </div>
                      </div>

                      {/* Bottom action row — active card only */}
                      {isActive && (
                        <div
                          className="mt-3 flex gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            className="flex-1 flex items-center justify-between rounded-lg px-3 py-2.5 text-[14px] font-bold"
                            style={{ backgroundColor: '#F0F4FF', color: '#0052B4', border: '1px solid #DBEAFE' }}
                          >
                            <span>🛡️ বিসনেস স্ট্যাম্প তৈরি করুন</span>
                            <span>&gt;&gt;</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(biz.id);
                            }}
                            className="rounded-lg px-3 py-2.5 text-[13px] font-bold transition-colors"
                            style={{
                              backgroundColor: '#FEF2F2',
                              color: '#DC2626',
                              border: '1px solid #FECACA',
                            }}
                          >
                            🗑️ ডিলিট
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add new form / button */}
            {isAddingNew ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <input
                  type="text"
                  autoFocus
                  placeholder="নতুন খাতা বা ব্যবসার নাম লিখুন"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
                  className="w-full px-3 py-2.5 text-[14px] border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0052B4]/30"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={isCreating || !newName.trim()}
                    className="flex-1 py-2.5 rounded-xl text-white font-bold text-[14px] disabled:opacity-60"
                    style={{ backgroundColor: '#0052B4' }}
                  >
                    {isCreating ? 'তৈরি হচ্ছে…' : 'যোগ করুন'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsAddingNew(false); setNewName(''); }}
                    className="flex-1 py-2.5 rounded-xl bg-slate-200 text-slate-700 font-bold text-[14px]"
                  >
                    বাতিল
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingNew(true)}
                className="w-full py-3.5 rounded-xl text-white font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                style={{ backgroundColor: '#0052B4' }}
              >
                + নতুন বাংলা খাতা
              </button>
            )}

          </div>
        )}

      </DrawerContent>
    </Drawer>
  );
}
