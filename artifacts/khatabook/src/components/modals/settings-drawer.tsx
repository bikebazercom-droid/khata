import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useAuth } from '@clerk/react';
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
  type BusinessSettings,
} from '@workspace/api-client-react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { phoneLogout } from '@/lib/phoneAuth';
import { clearAllPendingUploads } from '@/lib/pendingUploads';

/** Shape stored in localStorage under PROFILE_KEY */
export interface ShopProfile {
  userName: string;
  businessName: string;
  address: string;
  phone: string;
  email: string;
}

export const PROFILE_KEY = 'user_settings_profile';

export function loadShopProfile(): ShopProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as ShopProfile;
  } catch {}
  return { userName: '', businessName: '', address: '', phone: '', email: '' };
}

function saveShopProfile(profile: ShopProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event('settingsUpdated'));
}

type ActiveMenu = 'profile' | 'language' | 'auth' | null;

/**
 * Settings drawer — three collapsible accordion rows (one open at a time):
 *   1. 👤 প্রোফাইল তথ্য  — shop/user info stored in localStorage; feeds the PDF engine
 *   2. 🌐 ভাষা পরিবর্তন  — system language saved to the server (optimistic)
 *   3. 🔐 লগইন / লগআউট  — full logout sequence (cache wipe → Clerk → cookie → /sign-in)
 */
export function SettingsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: settings } = useGetBusinessSettings();
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const { isSignedIn } = useAuth();
  const [, navigate] = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Which accordion row is currently expanded (only one at a time)
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const toggleMenu = (menu: ActiveMenu) =>
    setActiveMenu(prev => (prev === menu ? null : menu));

  // ── Shop profile (localStorage) ───────────────────────────────────────────
  const [profile, setProfile] = useState<ShopProfile>(loadShopProfile);

  // Reload from storage and collapse all rows whenever the drawer opens
  useEffect(() => {
    if (open) {
      setProfile(loadShopProfile());
      setActiveMenu(null);
    }
  }, [open]);

  const handleProfileField = (field: keyof ShopProfile, value: string) => {
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    saveShopProfile(updated);
  };

  // ── Language update (optimistic, server-persisted) ────────────────────────
  const updateSettings = useUpdateBusinessSettings({
    mutation: {
      onMutate: async ({ data }) => {
        const settingsKey = getGetBusinessSettingsQueryKey();
        const previousSettings = queryClient.getQueryData<BusinessSettings>(settingsKey);
        if (previousSettings) {
          queryClient.setQueryData<BusinessSettings>(settingsKey, { ...previousSettings, ...data });
        }
        return { settingsKey, previousSettings };
      },
      onError: (err, _vars, context) => {
        console.error('ভাষা পরিবর্তন ব্যর্থ হয়েছে:', err);
        if (context) queryClient.setQueryData(context.settingsKey, context.previousSettings);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
      },
    },
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      queryClient.clear();
      clearAllPendingUploads();
      if (isSignedIn) await signOut();
      await phoneLogout().catch(() => {});
      onOpenChange(false);
      navigate('/sign-in');
    } catch (err) {
      console.error('লগআউট ব্যর্থ হয়েছে:', err);
      setIsLoggingOut(false);
    }
  }

  const currentLang = settings?.language ?? 'বাংলা';

  // ── Shared accordion row styles ───────────────────────────────────────────
  const rowHeader = (menu: ActiveMenu) =>
    `w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border text-sm font-semibold text-slate-700 transition-all active:scale-[0.98] ${
      activeMenu === menu
        ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
        : 'bg-slate-50 border-slate-200'
    }`;

  const rowBody = 'mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 space-y-3';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-slate-800">সেটিংস</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-10 space-y-2 overflow-y-auto max-h-[75vh]">

          {/* ── Row 1: Profile ──────────────────────────────────────────── */}
          <div>
            <button type="button" onClick={() => toggleMenu('profile')} className={rowHeader('profile')}>
              <span className="flex items-center gap-2">
                <span>👤</span>
                <span className={activeMenu === 'profile' ? 'text-white' : 'text-slate-700'}>
                  প্রোফাইল তথ্য ও নাম যোগ
                </span>
              </span>
              {activeMenu === 'profile'
                ? <ChevronUp className="w-4 h-4 shrink-0 text-white" />
                : <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />}
            </button>

            {activeMenu === 'profile' && (
              <div className={rowBody}>
                {([
                  { field: 'userName',     label: 'ব্যবহারকারীর নাম',                  placeholder: 'উদা: সাকিল আহমেদ',   type: 'text'  },
                  { field: 'businessName', label: 'দোকান / বিজনেসের নাম (PDF হেডার)', placeholder: 'উদা: হাজারি গোল্ড',  type: 'text'  },
                  { field: 'phone',        label: 'মোবাইল নাম্বার (PDF ফুটার)',         placeholder: 'উদা: 017XXXXXXXX',   type: 'text'  },
                  { field: 'email',        label: 'জিমেইল এড্রেস',                     placeholder: 'example@gmail.com',  type: 'email' },
                  { field: 'address',      label: 'ঠিকানা (PDF ফুটার)',                 placeholder: 'উদা: চকবাজার, ঢাকা', type: 'text'  },
                ] as const).map(({ field, label, placeholder, type }) => (
                  <div key={field}>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={profile[field]}
                      onChange={e => handleProfileField(field, e.target.value)}
                      className="w-full px-3 py-2.5 text-[13px] border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30 focus:border-[#1B3A6B]"
                    />
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 pt-1">
                  এই তথ্যগুলো শুধুমাত্র আপনার ডিভাইসে সংরক্ষিত হয়
                </p>
              </div>
            )}
          </div>

          {/* ── Row 2: Language ─────────────────────────────────────────── */}
          <div>
            <button type="button" onClick={() => toggleMenu('language')} className={rowHeader('language')}>
              <span className="flex items-center gap-2">
                <span>🌐</span>
                <span className={activeMenu === 'language' ? 'text-white' : 'text-slate-700'}>
                  ভাষা পরিবর্তন
                </span>
              </span>
              {activeMenu === 'language'
                ? <ChevronUp className="w-4 h-4 shrink-0 text-white" />
                : <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />}
            </button>

            {activeMenu === 'language' && (
              <div className={rowBody}>
                <div className="grid grid-cols-2 gap-3">
                  {(['বাংলা', 'English'] as const).map((lang) => {
                    const active = currentLang === lang;
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => updateSettings.mutate({ data: { language: lang } })}
                        className={`py-3.5 rounded-2xl border-2 text-center font-bold text-[14px] transition-all active:scale-95 ${
                          active
                            ? 'border-[#1B3A6B] bg-[#1B3A6B] text-white shadow-md'
                            : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 text-center">
                  বিল ও ইন্টারফেসের জন্য পছন্দের ভাষা বেছে নিন
                </p>
              </div>
            )}
          </div>

          {/* ── Row 3: Auth ─────────────────────────────────────────────── */}
          <div>
            <button type="button" onClick={() => toggleMenu('auth')} className={rowHeader('auth')}>
              <span className="flex items-center gap-2">
                <span>🔐</span>
                <span className={activeMenu === 'auth' ? 'text-white' : 'text-slate-700'}>
                  লগইন / লগআউট
                </span>
              </span>
              {activeMenu === 'auth'
                ? <ChevronUp className="w-4 h-4 shrink-0 text-white" />
                : <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />}
            </button>

            {activeMenu === 'auth' && (
              <div className={rowBody}>
                {isSignedIn ? (
                  <>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-red-100 bg-red-50 text-red-600 font-bold text-[15px] transition-all active:scale-95 hover:border-red-200 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isLoggingOut ? 'লগআউট হচ্ছে…' : '🚪 লগআউট করুন'}
                    </button>
                    <p className="text-[11px] text-slate-400 text-center">
                      লগআউট করলে সব ডিভাইসে সংযোগ বিচ্ছিন্ন হবে
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => { onOpenChange(false); navigate('/sign-in'); }}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-emerald-100 bg-emerald-50 text-emerald-700 font-bold text-[15px] transition-all active:scale-95"
                  >
                    লগইন করুন
                  </button>
                )}
              </div>
            )}
          </div>

        </div>
      </DrawerContent>
    </Drawer>
  );
}
