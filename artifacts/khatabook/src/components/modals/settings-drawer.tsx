import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useAuth, useUser } from '@clerk/react';
import { useRemoveOwnerPushToken } from '@workspace/api-client-react';
import { AlertTriangle, ArrowLeft, Building2, ChevronDown, EllipsisVertical, FileText, Gem, Globe2, List, LogIn, LogOut, Mail, Menu, Phone, Trash2, X } from 'lucide-react';
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
import { BusinessInvoice } from './business-invoice';
import { GoldInvoice } from './gold-invoice';
import { BusinessProfile } from './business-profile';
import { InvoiceList } from './invoice-list';
import type { InvoiceHistoryAction, InvoiceHistoryRecord } from './invoice-history';
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
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isLanguageMenuExpanded, setIsLanguageMenuExpanded] = useState(false);
  const [activeDetailsModule, setActiveDetailsModule] = useState<'profile' | 'invoice' | 'gold' | 'list'>('invoice');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceHistoryRecord>();
  const [invoiceAction, setInvoiceAction] = useState<InvoiceHistoryAction>('open');
  const [isInvoiceMenuOpen, setIsInvoiceMenuOpen] = useState(false);
  const selectDetailsModule = (module: 'profile' | 'invoice' | 'gold' | 'list') => {
    setSelectedInvoice(undefined);
    setInvoiceAction('open');
    setActiveDetailsModule(module);
    setIsInvoiceMenuOpen(false);
  };
  const openInvoice = (record: InvoiceHistoryRecord, action: InvoiceHistoryAction) => {
    setSelectedInvoice(record);
    setInvoiceAction(action);
    setActiveDetailsModule(record.type === 'Gold' ? 'gold' : 'invoice');
    setIsInvoiceMenuOpen(false);
  };

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
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
  }, [deleteConfirmation, isDeleting, isSignedIn, queryClient, onOpenChange, navigate, signOut, t]);

  const isDeleteConfirmationValid = deleteConfirmation.trim() === 'DELETE' ||
    (!!loginIdentity && deleteConfirmation.trim().toLowerCase() === loginIdentity.trim().toLowerCase());

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
      <DialogContent showCloseButton={false} className="left-auto right-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-l border-slate-200 bg-slate-50 p-0 shadow-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:w-full pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-[#1B3A6B] px-4 py-4 text-left">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t('back')}
              className="justify-self-start flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3 text-sm font-bold text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>{t('back')}</span>
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
                  aria-label={t('moreOptions')}
                  className="col-start-3 row-start-1 flex h-10 w-10 shrink-0 items-center justify-center justify-self-end rounded-xl bg-white/15 text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <EllipsisVertical className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="max-h-[calc(100dvh-7rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-700 bg-[#0F172A] p-1.5 text-slate-50 shadow-xl"
              >
                <DropdownMenuItem
                  aria-expanded={isLanguageMenuExpanded}
                  aria-controls="settings-language-options"
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsLanguageMenuExpanded((expanded) => !expanded);
                  }}
                   className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800/60 active:bg-slate-800/80 focus:bg-slate-800/80 focus:text-white data-[highlighted]:bg-slate-800/80 data-[highlighted]:text-white"
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
                    aria-label={t('languageOptions')}
                    className="ml-3 border-l border-slate-700 py-1 pl-2"
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
                      <DropdownMenuRadioItem value="bn" className="min-h-10 rounded-lg text-sm text-slate-100 transition-colors hover:bg-slate-800/60 active:bg-slate-800/80 focus:bg-slate-800/80 focus:text-white data-[highlighted]:bg-slate-800/80 data-[highlighted]:text-white">বাংলা</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="en" className="min-h-10 rounded-lg text-sm text-slate-100 transition-colors hover:bg-slate-800/60 active:bg-slate-800/80 focus:bg-slate-800/80 focus:text-white data-[highlighted]:bg-slate-800/80 data-[highlighted]:text-white">English</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </div>
                )}
                <DropdownMenuItem
                  disabled
                   className="cursor-default items-start rounded-lg px-3 py-3 opacity-100 data-[disabled]:opacity-100 focus:bg-transparent data-[highlighted]:bg-transparent"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                      {authMethod === 'phone' ? <Phone className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                      {t('loginIdentity')}
                    </span>
                    <span className="max-w-full truncate text-sm font-semibold text-slate-100">
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
                  className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white active:bg-slate-800 active:text-white focus:bg-slate-800 focus:text-white data-[highlighted]:bg-slate-800 data-[highlighted]:text-white"
                >
                  {isAuthenticated ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  {isAuthenticated ? (isLoggingOut ? t('loggingOut') : t('logoutBtn')) : t('loginBtn')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={role !== 'owner'}
                  onSelect={() => {
                    setDeleteConfirmation('');
                    setShowDeleteConfirm(true);
                  }}
                  className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-rose-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 active:bg-rose-500/10 active:text-rose-400 focus:bg-rose-500/10 focus:text-rose-400 data-[highlighted]:bg-rose-500/10 data-[highlighted]:text-rose-400"
                  title={role === 'owner' ? undefined : (lang === 'en' ? 'Only the owner can delete a ledger' : 'শুধু মালিক খাতা ডিলিট করতে পারবেন')}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('deleteAccount')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <main className="min-h-0 min-w-0 flex-1">
            {activeDetailsModule === 'profile' && <BusinessProfile />}
            {activeDetailsModule === 'invoice' && <BusinessInvoice historyRecord={selectedInvoice} autoAction={invoiceAction} viewOnly={!!selectedInvoice && invoiceAction === 'open'} onGenerated={() => setActiveDetailsModule('list')} />}
            {activeDetailsModule === 'gold' && <GoldInvoice historyRecord={selectedInvoice} autoAction={invoiceAction} viewOnly={!!selectedInvoice && invoiceAction === 'open'} onGenerated={() => setActiveDetailsModule('list')} />}
            {activeDetailsModule === 'list' && <InvoiceList onOpen={openInvoice} />}
          </main>
          <footer className="z-20 flex shrink-0 justify-start border-t border-slate-200 bg-white px-4 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))]">
            <button type="button" data-testid="button-invoice-menu" aria-expanded={isInvoiceMenuOpen} onClick={() => setIsInvoiceMenuOpen(true)} className="flex min-h-12 min-w-36 items-center justify-center gap-2 rounded-2xl bg-[#1B3A6B] px-6 text-sm font-bold text-white shadow-lg transition active:scale-95">
              <Menu className="h-5 w-5" />{lang === 'en' ? 'Menu' : 'মেনু'}
            </button>
          </footer>
          {isInvoiceMenuOpen && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45" data-testid="invoice-menu-backdrop">
            <button type="button" aria-label={lang === 'en' ? 'Close menu' : 'মেনু বন্ধ করুন'} className="absolute inset-0" onClick={() => setIsInvoiceMenuOpen(false)} />
            <section role="dialog" aria-modal="true" aria-label={lang === 'en' ? 'Invoice menu' : 'ইনভয়েস মেনু'} className="relative w-full max-w-xl rounded-t-3xl border border-slate-200 bg-white px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom-6 duration-200">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300" />
              <div className="mb-4 flex items-center justify-between"><div><h3 className="font-bold text-slate-900">{lang === 'en' ? 'Invoices' : 'ইনভয়েস'}</h3><p className="text-xs text-slate-500">{lang === 'en' ? 'Choose a section' : 'একটি বিভাগ নির্বাচন করুন'}</p></div><button type="button" aria-label={lang === 'en' ? 'Close menu' : 'মেনু বন্ধ করুন'} onClick={() => setIsInvoiceMenuOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-95"><X className="h-5 w-5" /></button></div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['profile', lang === 'en' ? 'Business Profile' : 'বিজনেস প্রোফাইল', Building2],
                  ['invoice', lang === 'en' ? 'Business Invoice' : 'বিজনেস ইনভয়েস', FileText],
                  ['gold', lang === 'en' ? 'Gold Invoice' : 'গোল্ড ইনভয়েস', Gem],
                  ['list', lang === 'en' ? 'Invoice List' : 'ইনভয়েস তালিকা', List],
                ] as const).map(([module, label, Icon]) => <button key={module} type="button" data-testid={`menu-option-${module}`} aria-current={activeDetailsModule === module ? 'page' : undefined} onClick={() => selectDetailsModule(module)} className={`flex min-h-20 items-center gap-3 rounded-2xl border px-3 text-left text-sm font-bold transition active:scale-[.98] ${activeDetailsModule === module ? 'border-amber-400 bg-amber-50 text-[#1B3A6B]' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activeDetailsModule === module ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-5 w-5" /></span>{label}</button>)}
              </div>
            </section>
          </div>}
        </div>
      </DialogContent>

      {/* ── Confirmation dialog ──────────────────────────────────── */}
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(nextOpen) => {
          if (isDeleting) return;
          setShowDeleteConfirm(nextOpen);
          if (!nextOpen) setDeleteConfirmation('');
        }}
      >
        <AlertDialogContent className="max-w-sm rounded-2xl border border-slate-200 p-5">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center justify-center gap-2 text-center text-[17px] text-slate-900">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-rose-600" />
              {t('confirmDeleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-center text-[14px] leading-relaxed text-slate-600">
              {t('confirmDeleteWarning')}
            </AlertDialogDescription>
            <div className="space-y-2 text-sm">
              <p className="text-slate-700">
                {t('deleteAccountIdentity')} <span className="font-semibold text-slate-900">{loginIdentity || t('noLogin')}</span>
              </p>
              <label htmlFor="delete-account-confirmation" className="block font-medium text-slate-700">
                {t('deleteAccountPrompt')}
              </label>
              <input
                id="delete-account-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={t('deleteAccountPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                disabled={isDeleting}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 disabled:bg-slate-100"
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-3 mt-2">
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteConfirmation('');
              }}
              disabled={isDeleting}
              className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-slate-100 py-3 text-[15px] font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
            >
              {t('deleteCancel')}
            </button>
            <button
              type="button"
              onClick={() => { void handleConfirmDelete(); }}
              disabled={isDeleting || !isDeleteConfirmationValid}
              className="min-h-11 flex-1 rounded-xl bg-rose-600 py-3 text-[15px] font-bold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? t('deleting') : t('deleteConfirm')}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Dialog>
  );
}
