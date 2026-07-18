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
import { Settings, Languages, LogOut, Store, ChevronDown, ChevronUp } from 'lucide-react';
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

/**
 * Full-screen settings drawer.
 *
 * Sections:
 *   1. System Language — বাংলা / English only (Hindi removed)
 *   2. Session — লগআউট করুন
 *
 * Logout sequence (clears everything before redirecting):
 *   a. wipe React Query cache (drops all server data)
 *   b. clear in-memory pending-upload queue
 *   c. revoke Clerk session (no-op for phone users)
 *   d. clear phone_session cookie via the server's logout endpoint
 *   e. navigate to /sign-in  ← SSE disconnects automatically because
 *      RealtimeSyncManager's `enabled` prop becomes false once isAuthenticated
 *      returns false after the cache clear + session revocation.
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

  // ── Shop profile (localStorage) ───────────────────────────────────────────
  const [profile, setProfile] = useState<ShopProfile>(loadShopProfile);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Reload from storage whenever the drawer opens
  useEffect(() => {
    if (open) setProfile(loadShopProfile());
  }, [open]);

  const handleProfileField = (field: keyof ShopProfile, value: string) => {
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    saveShopProfile(updated);
  };

  // ── Language update (optimistic) ──────────────────────────────────────────
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
      // 1. Wipe all cached server data immediately.
      queryClient.clear();
      // 2. Drop any pending bill-photo upload references.
      clearAllPendingUploads();
      // 3. Revoke Clerk session token (no-op for phone-only users).
      if (isSignedIn) {
        await signOut();
      }
      // 4. Clear the httpOnly phone_session cookie on the server.
      //    Safe to call unconditionally — returns 200 even without a session.
      await phoneLogout().catch(() => {});
      // 5. Redirect. The SSE stream closes on its own because
      //    RealtimeSyncManager's `enabled` prop turns false when isAuthenticated
      //    resolves to false after the session tokens are gone.
      onOpenChange(false);
      navigate('/sign-in');
    } catch (err) {
      console.error('লগআউট ব্যর্থ হয়েছে:', err);
      setIsLoggingOut(false);
    }
  }

  const LANGUAGES = ['বাংলা', 'English'] as const;
  const currentLang = settings?.language ?? 'বাংলা';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2 text-slate-800">
            <Settings className="w-5 h-5 text-slate-500" />
            সেটিংস
          </DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-10 space-y-6 overflow-y-auto max-h-[70vh]">

          {/* ── Shop profile section ─────────────────────────────────── */}
          <div>
            <button
              type="button"
              onClick={() => setIsProfileOpen(v => !v)}
              className="w-full flex items-center justify-between py-2 group"
            >
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-slate-400" />
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  দোকানের তথ্য (PDF-এ দেখাবে)
                </p>
              </div>
              {isProfileOpen
                ? <ChevronUp className="w-4 h-4 text-slate-400" />
                : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {isProfileOpen && (
              <div className="mt-3 space-y-3">
                {([
                  { field: 'userName',     label: 'ব্যবহারকারীর নাম',              placeholder: 'উদা: সাকিল আহমেদ' },
                  { field: 'businessName', label: 'দোকান / বিজনেসের নাম (PDF হেডার)', placeholder: 'উদা: হাজারি গোল্ড' },
                  { field: 'address',      label: 'ঠিকানা (PDF ফুটার)',             placeholder: 'উদা: চকবাজার, ঢাকা' },
                  { field: 'phone',        label: 'মোবাইল নাম্বার (PDF ফুটার)',     placeholder: 'উদা: 017XXXXXXXX' },
                  { field: 'email',        label: 'জিমেইল এড্রেস',                 placeholder: 'example@gmail.com' },
                ] as const).map(({ field, label, placeholder }) => (
                  <div key={field}>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</label>
                    <input
                      type={field === 'email' ? 'email' : 'text'}
                      placeholder={placeholder}
                      value={profile[field]}
                      onChange={e => handleProfileField(field, e.target.value)}
                      className="w-full px-3 py-2.5 text-[13px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30 focus:border-[#1B3A6B]"
                    />
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 pt-1">
                  এই তথ্যগুলো শুধুমাত্র আপনার ডিভাইসে সংরক্ষিত হয়
                </p>
              </div>
            )}
          </div>

          {/* ── Divider ─────────────────────────────────────────────── */}
          <div className="border-t border-slate-100" />

          {/* ── Language section ────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Languages className="w-4 h-4 text-slate-400" />
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                সিস্টেম ভাষা
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {LANGUAGES.map((lang) => {
                const active = currentLang === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => updateSettings.mutate({ data: { language: lang } })}
                    className={`py-4 rounded-2xl border-2 text-center font-bold text-[15px] transition-all active:scale-95 ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                        : 'border-slate-100 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-2 text-center">
              বিল ও ইন্টারফেসের জন্য পছন্দের ভাষা বেছে নিন
            </p>
          </div>

          {/* ── Divider ─────────────────────────────────────────────── */}
          <div className="border-t border-slate-100" />

          {/* ── Logout section ──────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <LogOut className="w-4 h-4 text-slate-400" />
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                অ্যাকাউন্ট
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-red-100 bg-red-50 text-red-600 font-bold text-[15px] transition-all active:scale-95 hover:border-red-200 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <LogOut className="w-4 h-4" />
              {isLoggingOut ? 'লগআউট হচ্ছে…' : 'লগআউট করুন'}
            </button>
            <p className="text-[11px] text-slate-400 mt-2 text-center">
              লগআউট করলে সব ডিভাইসে সংযোগ বিচ্ছিন্ন হবে
            </p>
          </div>

        </div>
      </DrawerContent>
    </Drawer>
  );
}
