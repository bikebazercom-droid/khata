import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useAuth, useUser } from '@clerk/react';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
  useRemoveOwnerPushToken,
  type BusinessSettings,
} from '@workspace/api-client-react';
import { ArrowLeft, ChevronDown, ChevronUp, LogIn, LogOut, Mail, Phone, Settings } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { phoneLogout } from '@/lib/phoneAuth';
import { clearOfflineIdentity, markLocalLogoutPending, readOfflineIdentity } from '@/lib/offlineSession';
import { clearPersistedQueries } from '@/lib/queryPersister';
import { clearAllPendingUploads } from '@/lib/pendingUploads';
import { useLanguage } from '@/lib/i18n';
import { useAppAuth } from '@/App';
import { revokeNetworkWrites } from '@/lib/useAuthConnectivity';
import {
  NATIVE_AUTH_LOGOUT_MESSAGE,
  postNativeAuthMessage,
  STORED_OWNER_PUSH_TOKEN_KEY,
} from '@/lib/nativePushBridge';

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

type ActiveMenu = 'auth' | null;

/**
 * More sidebar with the active login identity and account/settings actions.
 * Logout clears local state and revokes the server session before redirecting.
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
  const { isAuthenticated, role, phone, authMethod } = useAppAuth();
  const { user: clerkUser } = useUser();
  const removeOwnerPushToken = useRemoveOwnerPushToken();
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
  const loginIdentity = authMethod === 'phone'
    ? phone || readOfflineIdentity()?.phone
    : clerkUser?.primaryEmailAddress?.emailAddress ||
      clerkUser?.primaryPhoneNumber?.phoneNumber ||
      clerkUser?.emailAddresses[0]?.emailAddress ||
      clerkUser?.phoneNumbers[0]?.phoneNumber;

  useEffect(() => {
    if (open) {
      setProfile(loadShopProfile());
      setActiveMenu(null);
    }
  }, [open]);

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
    const offlineIdentity = readOfflineIdentity();
    try {
      const res = await fetch('/api/user/account', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      postNativeAuthMessage(NATIVE_AUTH_LOGOUT_MESSAGE);
      queryClient.clear();
      revokeNetworkWrites();
      clearAllPendingUploads();
      clearOfflineIdentity();
      void clearPersistedQueries(offlineIdentity?.userId).catch(() => {});
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
    const offlineIdentity = readOfflineIdentity();
    if (!navigator.onLine) {
      markLocalLogoutPending();
      clearOfflineIdentity();
      void clearPersistedQueries(offlineIdentity?.userId).catch(() => {});
      queryClient.clear();
      revokeNetworkWrites();
      clearAllPendingUploads();
      localStorage.removeItem(STORED_OWNER_PUSH_TOKEN_KEY);
      localStorage.removeItem('selected_business_id');
      postNativeAuthMessage(NATIVE_AUTH_LOGOUT_MESSAGE);
      if (isSignedIn) await signOut().catch(() => {});
      onOpenChange(false);
      navigate('/sign-in');
      toast.info('এই ডিভাইস থেকে লগআউট হয়েছে। সংযোগ ফিরলে সার্ভার সেশন বাতিল হবে।');
      setIsLoggingOut(false);
      return;
    }
    try {
      const storedPushToken = localStorage.getItem(STORED_OWNER_PUSH_TOKEN_KEY);
      if (storedPushToken) {
        try {
          const tokenInput = JSON.parse(storedPushToken) as {
            token?: string;
            platform?: 'android' | 'ios';
          };
          if (
            typeof tokenInput.token === 'string' &&
            (tokenInput.platform === 'android' || tokenInput.platform === 'ios')
          ) {
            await removeOwnerPushToken.mutateAsync({ data: {
              token: tokenInput.token,
              platform: tokenInput.platform,
            } });
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            localStorage.removeItem(STORED_OWNER_PUSH_TOKEN_KEY);
          } else {
            throw error;
          }
        }
        localStorage.removeItem(STORED_OWNER_PUSH_TOKEN_KEY);
      }
      const logoutEvent = await fetch('/api/auth/logout-event', { method: 'POST', credentials: 'include' });
      if (!logoutEvent.ok && logoutEvent.status !== 401) {
        throw new Error('The server could not confirm logout');
      }
      await phoneLogout();
      if (isSignedIn) await signOut();
      postNativeAuthMessage(NATIVE_AUTH_LOGOUT_MESSAGE);
      queryClient.clear();
      revokeNetworkWrites();
      clearOfflineIdentity();
      void clearPersistedQueries(offlineIdentity?.userId).catch(() => {});
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="left-auto right-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-l border-slate-200 bg-slate-50 p-0 shadow-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:w-[420px] pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-[#1B3A6B] px-4 py-4 text-left">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="ড্যাশবোর্ডে ফিরে যান"
              className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3 text-sm font-bold text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>ফিরে যান</span>
            </button>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold text-white">আরো</DialogTitle>
              <p className="text-xs text-white/70">সেটিংস ও অ্যাকাউন্ট</p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-6 pt-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Login status">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              {authMethod === 'phone' ? <Phone className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              লগইন অবস্থা
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {isAuthenticated ? loginIdentity || (authMethod === 'phone' ? 'ফোন নম্বরে লগইন' : 'ইমেইলে লগইন') : 'লগইন করা নেই'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {isAuthenticated ? 'বর্তমানে সক্রিয় অ্যাকাউন্ট' : 'অ্যাকাউন্ট ব্যবহার করতে লগইন করুন'}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Settings className="h-4 w-4 text-[#1B3A6B]" />
              সেটিংস
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-medium text-slate-500">সক্রিয় খাতা</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{settings?.storeName || profile.businessName || 'বাংলাখাতা'}</div>
              <div className="mt-1 text-xs text-slate-500">{role === 'owner' ? 'মালিক অ্যাকাউন্ট' : 'স্টাফ অ্যাকাউন্ট'}</div>
            </div>
          </section>

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
                {isAuthenticated ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
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
      </DialogContent>

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

    </Dialog>
  );
}
