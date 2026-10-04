import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useAuth } from '@clerk/react';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { phoneLogout } from '@/lib/phoneAuth';
import { clearAllPendingUploads } from '@/lib/pendingUploads';
import { useLanguage } from '@/lib/i18n';
import { useAppAuth } from '@/App';
import { revokeNetworkWrites } from '@/lib/useAuthConnectivity';

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
 *   1. 👤 Profile info  — shop/user info stored in localStorage; feeds the PDF engine
 *   2. 🌐 Language      — system language saved to the server (optimistic)
 *   3. 🔐 Login/Logout  — full logout sequence (cache wipe → Clerk → cookie → /sign-in)
 */
export function SettingsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const { isSignedIn } = useAuth();
  const { isAuthenticated, role } = useAppAuth();
  const { selectedBusinessId } = useBusinessContext();
  const { data: settings } = useGetBusinessSettings({
    query: { enabled: role === 'owner', queryKey: businessScopedQueryKey(getGetBusinessSettingsQueryKey(), selectedBusinessId) },
  });
  const [, navigate] = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const toggleMenu = (menu: ActiveMenu) =>
    setActiveMenu(prev => (prev === menu ? null : menu));

  const [profile, setProfile] = useState<ShopProfile>(loadShopProfile);

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

  const updateSettings = useUpdateBusinessSettings({
    mutation: {
      onMutate: async ({ data }) => {
        const settingsKey = businessScopedQueryKey(getGetBusinessSettingsQueryKey(), selectedBusinessId);
        const previousSettings = queryClient.getQueryData<BusinessSettings>(settingsKey);
        if (previousSettings) {
          queryClient.setQueryData<BusinessSettings>(settingsKey, { ...previousSettings, ...data });
        }
        return { settingsKey, previousSettings };
      },
      onError: (err, _vars, context) => {
        console.error('Language change failed:', err);
        if (context) queryClient.setQueryData(context.settingsKey, context.previousSettings);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
      },
    },
  });

  const handleConfirmDelete = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch('/api/user/account', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      queryClient.clear();
      revokeNetworkWrites();
      clearAllPendingUploads();
      localStorage.clear();
      setShowDeleteConfirm(false);
      onOpenChange(false);

      toast.success(t('deleteSuccess'), {
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

      setTimeout(async () => {
        try {
          // The account no longer exists; another authenticated API call here
          // would provision a replacement account before Clerk signs out.
          if (isSignedIn) await signOut();
          await phoneLogout().catch(() => {});
        } catch {}
        navigate('/sign-in');
      }, 1500);
    } catch (err) {
      console.error('[account-nuke] failed:', err);
      toast.error(t('deleteError'));
      setIsDeleting(false);
    }
  }, [isDeleting, isSignedIn, queryClient, onOpenChange, navigate, signOut, t]);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const logoutEvent = await fetch('/api/auth/logout-event', { method: 'POST', credentials: 'include' });
      if (!logoutEvent.ok && logoutEvent.status !== 401) {
        throw new Error('The server could not confirm logout');
      }
      await phoneLogout();
      if (isSignedIn) await signOut();
      queryClient.clear();
      revokeNetworkWrites();
      localStorage.removeItem('selected_business_id');
      clearAllPendingUploads();
      onOpenChange(false);
      navigate('/sign-in');
    } catch (err) {
      console.error('Logout failed:', err);
      toast.error('লগআউট নিশ্চিত করা যায়নি। আবার চেষ্টা করুন।');
      setIsLoggingOut(false);
    }
  }

  const rowHeader = (menu: ActiveMenu) =>
    `w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border text-sm font-semibold text-slate-700 transition-all active:scale-[0.98] ${
      activeMenu === menu
        ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
        : 'bg-slate-50 border-slate-200'
    }`;

  const rowBody = 'mt-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 space-y-3';

  const profileFields = [
    { field: 'userName'    as const, label: t('fieldUserName'),  placeholder: 'উদা: সাকিল আহমেদ',      type: 'text'  },
    { field: 'businessName'as const, label: t('fieldShopName'),  placeholder: 'উদা: বাংলা খাতা স্টোর', type: 'text'  },
    { field: 'phone'       as const, label: t('fieldPhone'),     placeholder: 'উদা: 017XXXXXXXX',       type: 'text'  },
    { field: 'email'       as const, label: t('fieldEmail'),     placeholder: 'example@gmail.com',      type: 'email' },
    { field: 'address'     as const, label: t('fieldAddress'),   placeholder: 'উদা: চকবাজার, ঢাকা',    type: 'text'  },
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-slate-800">{t('settingsTitle')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-10 space-y-2 overflow-y-auto max-h-[75vh]">

          {/* ── Row 1: Profile ──────────────────────────────────────────── */}
          {role === 'owner' && (
            <div>
              <button type="button" onClick={() => toggleMenu('profile')} className={rowHeader('profile')}>
                <span className="flex items-center gap-2">
                  <span>👤</span>
                  <span className={activeMenu === 'profile' ? 'text-white' : 'text-slate-700'}>
                    {t('profileInfo')}
                  </span>
                </span>
                {activeMenu === 'profile'
                  ? <ChevronUp className="w-4 h-4 shrink-0 text-white" />
                  : <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />}
              </button>

              {activeMenu === 'profile' && (
                <div className={rowBody}>
                  {profileFields.map(({ field, label, placeholder, type }) => (
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
                    {t('deviceOnly')}
                  </p>
                </div>
              )}
            </div>
          )}

          {role === 'owner' && (
            <button
              type="button"
              onClick={() => { onOpenChange(false); navigate('/access'); }}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 transition-all active:scale-[0.98]"
            >
              <span>খাতা অ্যাক্সেস ও কার্যকলাপ</span>
              <span aria-hidden="true">›</span>
            </button>
          )}

          {/* ── Row 2: Auth ─────────────────────────────────────────────── */}
          <div>
            <button type="button" onClick={() => toggleMenu('auth')} className={rowHeader('auth')}>
              <span className="flex items-center gap-2">
                <span>🔐</span>
                <span className={activeMenu === 'auth' ? 'text-white' : 'text-slate-700'}>
                  {t('loginLogout')}
                </span>
              </span>
              {activeMenu === 'auth'
                ? <ChevronUp className="w-4 h-4 shrink-0 text-white" />
                : <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />}
            </button>

            {activeMenu === 'auth' && (
              <div className={rowBody}>
                {isAuthenticated ? (
                  <>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-red-100 bg-red-50 text-red-600 font-bold text-[15px] transition-all active:scale-95 hover:border-red-200 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isLoggingOut ? t('loggingOut') : t('logoutBtn')}
                    </button>
                    <p className="text-[11px] text-slate-400 text-center">
                      {t('logoutHint')}
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => { onOpenChange(false); navigate('/sign-in'); }}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-emerald-100 bg-emerald-50 text-emerald-700 font-bold text-[15px] transition-all active:scale-95"
                  >
                    {t('loginBtn')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Row 4: Delete Account ───────────────────────────────────── */}
          {role === 'owner' && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-red-200 bg-red-50 text-red-600 font-bold text-sm transition-all active:scale-[0.98] hover:bg-red-100"
              >
                <span className="text-base">🗑️</span>
                {t('deleteAccount')}
              </button>
              <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                {t('deleteAccountHint')}
              </p>
            </div>
          )}

        </div>
      </DrawerContent>

      {/* ── Confirmation dialog ──────────────────────────────────── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-[17px]">{t('confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-slate-600 text-[14px] leading-relaxed">
              {t('confirmDeleteLine1')}{'\n'}
              {t('confirmDeleteLine2')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-3 mt-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
              className="flex-1 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-700 font-bold text-[15px] active:scale-95 transition-transform disabled:opacity-50"
            >
              {t('no')}
            </button>
            <button
              type="button"
              onClick={() => { void handleConfirmDelete(); }}
              disabled={isDeleting}
              className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold text-[15px] active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isDeleting ? t('deleting') : t('yesDelete')}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Drawer>
  );
}
