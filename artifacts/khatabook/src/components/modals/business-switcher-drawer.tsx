import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

export function BusinessSwitcherDrawer() {
  const { selectedBusinessId, setSelectedBusiness, businesses, setBusinesses, isSwitcherOpen, closeSwitcher } = useBusinessContext();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Fetch business list whenever the drawer opens
  const fetchBusinesses = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/businesses', { credentials: 'include' });
      if (!res.ok) return;
      const data: BusinessInfo[] = await res.json();
      setBusinesses(data);

      // Auto-select the first business if nothing selected yet
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
    }
  }, [isSwitcherOpen, fetchBusinesses]);

  async function handleSwitch(id: string) {
    if (id === selectedBusinessId) { closeSwitcher(); return; }

    // 1. Update state + localStorage immediately
    setSelectedBusiness(id);
    localStorage.setItem('selected_business_id', id);

    // 2. Push header to the API client right now (before any re-fetch fires)
    setExtraHeaders({ 'x-business-id': id });

    // 3. Hard-clear the entire query cache so stale data from the old
    //    business is never served to the next render, then re-fetch everything
    queryClient.clear();
    await queryClient.invalidateQueries();

    // 4. Close the panel
    closeSwitcher();
  }

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

      // 1. Reset form before switching so it's gone when the drawer re-opens
      setNewName('');
      setIsAddingNew(false);

      // 2. Append to list via functional updater (avoids stale closure over businesses)
      setBusinesses((prev) => [...prev, created]);

      // 3. Fully await the switch so cache flush + header change complete before returning
      await handleSwitch(created.id);
    } catch (err) {
      console.error('Failed to create business:', err);
      alert('নতুন ব্যবসা প্রতিষ্ঠান যোগ করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setIsCreating(false);
    }
  }

  const AVATAR_COLORS = ['#1B3A6B', '#0052B4', '#065F46', '#7C3AED', '#B45309', '#DC2626'];

  return (
    <Drawer open={isSwitcherOpen} onOpenChange={(open) => !open && closeSwitcher()}>
      <DrawerContent>
        <div className="px-4 pb-6 pt-2 space-y-3 max-h-[80vh] overflow-y-auto">

          {/* Title */}
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
                    onClick={() => handleSwitch(biz.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSwitch(biz.id)}
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
                      {/* Radio indicator */}
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

                    {/* Business stamp CTA — only for active */}
                    {isActive && (
                      <div
                        className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 text-[14px] font-bold"
                        style={{ backgroundColor: '#F0F4FF', color: '#0052B4', border: '1px solid #DBEAFE' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>🛡️ বিসনেস স্ট্যাম্প তৈরি করুন</span>
                        <span>&gt;&gt;</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Inline "add new" form */}
          {isAddingNew ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <input
                type="text"
                autoFocus
                placeholder="নতুন খাতা বা ব্যবসার নাম লিখুন"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="w-full px-3 py-2.5 text-[14px] border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0052B4]/30"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
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
      </DrawerContent>
    </Drawer>
  );
}
