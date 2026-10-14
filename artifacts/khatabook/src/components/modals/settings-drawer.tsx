import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useAuth, useUser } from '@clerk/react';
import { useRemoveOwnerPushToken } from '@workspace/api-client-react';
import { ArrowLeft, ChevronDown, EllipsisVertical, Globe2, LogIn, LogOut, Mail, Phone, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { phoneLogout } from '@/lib/phoneAuth';
import { clearOfflineIdentity, markLocalLogoutPending, readOfflineIdentity } from '@/lib/offlineSession';
import { clearPersistedQueries } from '@/lib/queryPersister';
import { clearAllPendingUploads } from '@/lib/pendingUploads';
import { useLanguage } from '@/lib/i18n';
import { markLanguageSelection, saveLanguagePreference } from '@/lib/language-preference';
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

/**
 * Minimal More drawer; account actions are grouped in the header menu.
 * Logout clears local state and revokes the server session before redirecting.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang, setLang } = useLanguage();
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const { isSignedIn } = useAuth();
  const { isAuthenticated, role, phone, authMethod, userId } = useAppAuth();
  const { user: clerkUser } = useUser();
  const removeOwnerPushToken = useRemoveOwnerPushToken();
  const [, navigate] = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isLanguageMenuExpanded, setIsLanguageMenuExpanded] = useState(false);

  const loginIdentity = authMethod === 'phone'
    ? phone || readOfflineIdentity()?.phone
    : clerkUser?.primaryEmailAddress?.emailAddress ||
      clerkUser?.primaryPhoneNumber?.phoneNumber ||
      clerkUser?.emailAddresses[0]?.emailAddress ||
      clerkUser?.phoneNumbers[0]?.phoneNumber;

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="left-auto right-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-l border-slate-200 bg-slate-50 p-0 shadow-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:w-[420px] pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-[#1B3A6B] px-4 py-4 text-left">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="ড্যাশবোর্ডে ফিরে যান"
              className="justify-self-start flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3 text-sm font-bold text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>ফিরে যান</span>
            </button>
            <DialogTitle className="col-start-2 row-start-1 whitespace-nowrap text-center text-lg font-bold text-white">
              {t('moreTitle')}
            </DialogTitle>
            <DropdownMenu
              open={isMoreMenuOpen}
              onOpenChange={(nextOpen) => {
                setIsMoreMenuOpen(nextOpen);
                if (!nextOpen) setIsLanguageMenuExpanded(false);
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="আরও অপশন"
                  className="col-start-3 row-start-1 flex h-10 w-10 shrink-0 items-center justify-center justify-self-end rounded-xl bg-white/15 text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <EllipsisVertical className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="max-h-[calc(100dvh-7rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border-slate-200 bg-white p-1.5 shadow-xl"
              >
                <DropdownMenuItem
                  aria-expanded={isLanguageMenuExpanded}
                  aria-controls="settings-language-options"
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsLanguageMenuExpanded((expanded) => !expanded);
                  }}
                  className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 focus:bg-slate-100"
                >
                  <Globe2 className="h-4 w-4" />
                  Language / ভাষা
                  <ChevronDown
                    aria-hidden="true"
                    className={`ml-auto h-4 w-4 shrink-0 transition-transform duration-200 ${isLanguageMenuExpanded ? 'rotate-180' : ''}`}
                  />
                </DropdownMenuItem>
                {isLanguageMenuExpanded && (
                  <div
                    id="settings-language-options"
                    role="group"
                    aria-label="Language options"
                    className="ml-3 border-l border-slate-200 py-1 pl-2"
                  >
                    <DropdownMenuRadioGroup
                      value={lang}
                      onValueChange={(value) => {
                        if (value !== 'bn' && value !== 'en') return;
                        setLang(value);
                        if (!userId) return;
                        markLanguageSelection(userId, value);
                        void saveLanguagePreference(value).catch((syncError) => {
                          console.warn('Language choice saved locally; account sync is pending:', syncError);
                        });
                      }}
                    >
                      <DropdownMenuRadioItem value="bn" className="min-h-10 rounded-lg text-sm">বাংলা</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="en" className="min-h-10 rounded-lg text-sm">English</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </div>
                )}
                <DropdownMenuItem
                  disabled
                  className="cursor-default items-start rounded-lg px-3 py-3 opacity-100 data-[disabled]:opacity-100 focus:bg-transparent"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      {authMethod === 'phone' ? <Phone className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                      {t('loginIdentity')}
                    </span>
                    <span className="max-w-full truncate text-sm font-semibold text-slate-800">
                      {isAuthenticated ? loginIdentity || (authMethod === 'phone' ? t('phoneLoginFallback') : t('emailLoginFallback')) : t('noLogin')}
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isLoggingOut}
                  onSelect={() => {
                    if (isAuthenticated) void handleLogout();
                    else {
                      onOpenChange(false);
                      navigate('/sign-in');
                    }
                  }}
                  className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 focus:bg-slate-100"
                >
                  {isAuthenticated ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  {isAuthenticated ? (isLoggingOut ? t('loggingOut') : t('logoutBtn')) : t('loginBtn')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={role !== 'owner'}
                  onSelect={() => setShowDeleteConfirm(true)}
                  className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-red-600 focus:bg-red-50 focus:text-red-700"
                  title={role === 'owner' ? undefined : (lang === 'en' ? 'Only the owner can delete a ledger' : 'শুধু মালিক খাতা ডিলিট করতে পারবেন')}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('deleteAccount')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        <div className="flex-1" />
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
