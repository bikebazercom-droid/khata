/**
 * i18n — Global language context for BanglaKhata web app.
 *
 * Architecture:
 * - Server is the source of truth (settings.language = 'বাংলা' | 'English').
 * - localStorage key 'app_lang' mirrors the value for instant first-render.
 * - useLanguage() returns { isEnglish, t, formatCurrency, formatNumber }.
 * - LanguageProvider must be placed inside QueryClientProvider (uses useGetBusinessSettings).
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useGetBusinessSettings } from '@workspace/api-client-react';
import { formatBengaliNumber } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lang = 'bn' | 'en';
const STORAGE_KEY = 'app_lang';

// ── Translation dictionary ─────────────────────────────────────────────────────
// All values must be plain strings (no functions). Complex interpolations are
// handled inline in components using isEnglish directly.

const dict = {
  bn: {
    parties: 'পার্টিস',
    settings: 'সেটিংস',
    customer: 'গ্রাহক',
    supplier: 'সরবরাহকারী',
    youWillGive: 'আপনি দেবেন',
    youWillGet: 'আপনি পাবেন',
    viewReport: 'রিপোর্ট দেখুন',
    searchCustomer: 'কাস্টমার অনুসন্ধান করুন',
    searchSupplier: 'সাপ্লায়ার অনুসন্ধান করুন',
    filter: 'ফিল্টার',
    filterAndSort: 'ফিল্টার ও বাছাই',
    filterBy: 'মাধ্যমে ফিল্টার',
    sortBy: 'মাধ্যমে বাছাই',
    all: 'সব',
    permanent: 'স্থায়ী',
    dueToday: 'আজকের বাকি',
    upcoming: 'আপকামিং',
    noDate: 'তারিখ নেই',
    noSpecificDate: 'কোনো নির্দিষ্ট তারিখ নেই',
    mostRecent: 'সর্বাধিক সাম্প্রতিক',
    highestAmount: 'সর্বোচ্চ পরিমাণ',
    byName: 'নামের দ্বারা (A–Z)',
    oldest: 'সব থেকে পুরোনো',
    lowestAmount: 'সর্বনিম্ন রাশি',
    showResults: 'ফলাফল দেখুন',
    reset: 'রিসেট',
    addStaff: 'স্টাফ যোগ করুন',
    loading: 'লোড হচ্ছে...',
    get: 'পাবেন',
    give: 'দেবেন',
    addCustomer: 'কাস্টমার যোগ করুন',
    addSupplier: 'সাপ্লায়ার যোগ করুন',
    emptyCustomer: 'কাস্টমার যোগ করুন এবং দ্রুত বকেয়া কালেকশন করুন',
    emptySupplier: 'সাপ্লায়ার যোগ করুন এবং আপনার হিসাব পরিষ্কার রাখুন',
    receiptGot: 'আপনি পেয়েছেন',
    receiptGave: 'আপনি দিয়েছেন',
    receiptBalance: 'বর্তমান ব্যালেন্স',
    settingsTitle: 'সেটিংস',
    profileInfo: 'প্রোফাইল তথ্য ও নাম যোগ',
    changeLanguage: 'ভাষা পরিবর্তন',
    loginLogout: 'লগইন / লগআউট',
    fieldUserName: 'ব্যবহারকারীর নাম',
    fieldShopName: 'দোকান / বিজনেসের নাম (PDF হেডার)',
    fieldPhone: 'মোবাইল নাম্বার (PDF ফুটার)',
    fieldEmail: 'জিমেইল এড্রেস',
    fieldAddress: 'ঠিকানা (PDF ফুটার)',
    deviceOnly: 'এই তথ্যগুলো শুধুমাত্র আপনার ডিভাইসে সংরক্ষিত হয়',
    langHint: 'বিল ও ইন্টারফেসের জন্য পছন্দের ভাষা বেছে নিন',
    logoutHint: 'লগআউট করলে সব ডিভাইসে সংযোগ বিচ্ছিন্ন হবে',
    loggingOut: 'লগআউট হচ্ছে…',
    logoutBtn: '🚪 লগআউট করুন',
    loginBtn: 'লগইন করুন',
    deleteAccount: 'খাতা ডিলিট করুন',
    deleteAccountHint: 'সমস্ত লেনদেন ও ক্যাশ মুছে যাবে — এটি পূর্বাবস্থায় ফেরানো যাবে না',
    confirmDeleteTitle: 'সম্পূর্ণ অ্যাকাউন্ট ডিলিট করবেন?',
    confirmDeleteLine1: 'আপনার সমস্ত খাতা, গ্রাহক, লেনদেন ও ডেটা চিরতরে মুছে যাবে।',
    confirmDeleteLine2: 'পরে একই Gmail/ফোন দিয়ে লগইন করলে নতুন ফাঁকা অ্যাকাউন্ট পাবেন।',
    no: 'না',
    yesDelete: 'হ্যাঁ, ডিলিট করুন',
    deleting: 'মুছছে…',
    deleteSuccess: '🎉 বাংলা খাতা: আপনার সম্পূর্ণ বাংলা খাতা (BanglaKhata) অ্যাকাউন্টটি সফলভাবে এবং চিরতরে মুছে ফেলা হয়েছে!',
    deleteError: 'অ্যাকাউন্ট ডিলিট করা যায়নি। আবার চেষ্টা করুন।',
    yourKhatas: 'আপনার বাংলা খাতাগুলো',
    khataCustomers: 'গ্রাহক',
    businessStamp: '🛡️ বিসনেস স্ট্যাম্প তৈরি করুন',
    deleteKhata: '🗑️ ডিলিট',
    confirmDeleteKhataTitle: 'খাতা ডিলিট করুন?',
    confirmDeleteKhataBody: 'এই খাতার সব গ্রাহক এবং লেনদেনের তথ্য চিরতরে মুছে যাবে।',
    cannotUndo: 'এটি পূর্বাবস্থায় ফেরানো যাবে না।',
    yesDelete2: 'হ্যাঁ, ডিলিট করুন',
    khataDeleteSuccess: '🎉 বাংলা খাতা: আপনার খাতাটি সফলভাবে এবং চিরতরে মুছে ফেলা হয়েছে!',
    khataDeleteError: 'ডিলিট করা যায়নি! আবার চেষ্টা করুন।',
    newKhataBtn: '+ নতুন বাংলা খাতা',
    creatingKhata: 'তৈরি হচ্ছে…',
    addKhata: 'যোগ করুন',
    cancelKhata: 'বাতিল',
    newKhataPlaceholder: 'নতুন খাতা বা ব্যবসার নাম লিখুন',
    createFailed: 'নতুন ব্যবসা প্রতিষ্ঠান যোগ করা যায়নি। আবার চেষ্টা করুন।',
    pdfAsOfToday: 'আজ পর্যন্ত',
    pdfTotalExpense: 'মোট খরচ(-)',
    pdfTotalCredit: 'মোট জমা(+)',
    pdfTotalBalance: 'মোট ব্যালেন্স',
    pdfPhone: 'ফোন',
    pdfName: 'নাম',
    pdfDebit: 'ডেবিট (-)',
    pdfCredit: 'ক্রেডিট (+)',
    pdfLastTx: 'সর্বশেষ লেনদেন',
    pdfGrandTotal: 'সর্বমোট',
    pdfFooterCta: 'এখনই BanglaKhata ব্যবহার শুরু করুন',
    pdfInstall: 'ইনস্টল করুন',
    pdfFooterSupport: 'সাহায্য: support@banglakhata.com',
    pdfFooterTerms: 'নিয়ম ও শর্তাবলী প্রযোজ্য',
    pdfError: 'PDF তৈরি করতে সমস্যা হয়েছে।',
    pdfSupplierNameCol: 'সরবরাহকারীর নাম',
    pdfCustomerStatement: 'গ্রাহক তালিকার স্টেটমেন্ট',
    pdfSupplierStatement: 'সরবরাহকারী তালিকার স্টেটমেন্ট',
  },
  en: {
    parties: 'Parties',
    settings: 'Settings',
    customer: 'Customer',
    supplier: 'Supplier',
    youWillGive: 'You Will Give',
    youWillGet: 'You Will Get',
    viewReport: 'View Report',
    searchCustomer: 'Search customers',
    searchSupplier: 'Search suppliers',
    filter: 'Filter',
    filterAndSort: 'Filter & Sort',
    filterBy: 'Filter by',
    sortBy: 'Sort by',
    all: 'All',
    permanent: 'Permanent',
    dueToday: 'Due today',
    upcoming: 'Upcoming',
    noDate: 'No date',
    noSpecificDate: 'No specific date',
    mostRecent: 'Most recent',
    highestAmount: 'Highest amount',
    byName: 'By name (A–Z)',
    oldest: 'Oldest',
    lowestAmount: 'Lowest amount',
    showResults: 'Show results',
    reset: 'Reset',
    addStaff: 'Add Staff',
    loading: 'Loading...',
    get: 'Get',
    give: 'Give',
    addCustomer: 'Add Customer',
    addSupplier: 'Add Supplier',
    emptyCustomer: 'Add a customer and collect dues faster',
    emptySupplier: 'Add a supplier and keep your accounts clean',
    receiptGot: 'You received',
    receiptGave: 'You gave',
    receiptBalance: 'Current Balance',
    settingsTitle: 'Settings',
    profileInfo: 'Profile Info & Name',
    changeLanguage: 'Change Language',
    loginLogout: 'Login / Logout',
    fieldUserName: 'Your Name',
    fieldShopName: 'Shop / Business Name (PDF Header)',
    fieldPhone: 'Mobile Number (PDF Footer)',
    fieldEmail: 'Email Address',
    fieldAddress: 'Address (PDF Footer)',
    deviceOnly: 'This info is only saved on your device',
    langHint: 'Choose your preferred language for bills & interface',
    logoutHint: 'Logging out will disconnect from all devices',
    loggingOut: 'Logging out…',
    logoutBtn: '🚪 Log Out',
    loginBtn: 'Log In',
    deleteAccount: 'Delete Account',
    deleteAccountHint: 'All transactions and cash will be deleted — this cannot be undone',
    confirmDeleteTitle: 'Delete complete account?',
    confirmDeleteLine1: 'All your khatas, customers, transactions & data will be permanently deleted.',
    confirmDeleteLine2: 'Logging in again with the same Gmail/phone will create a fresh empty account.',
    no: 'No',
    yesDelete: 'Yes, Delete',
    deleting: 'Deleting…',
    deleteSuccess: '🎉 BanglaKhata: Your complete BanglaKhata account has been successfully and permanently deleted!',
    deleteError: 'Could not delete account. Please try again.',
    yourKhatas: 'Your BanglaKhata Books',
    khataCustomers: 'customers',
    businessStamp: '🛡️ Create Business Stamp',
    deleteKhata: '🗑️ Delete',
    confirmDeleteKhataTitle: 'Delete Khata?',
    confirmDeleteKhataBody: 'All customers and transactions in this khata will be permanently deleted.',
    cannotUndo: 'This cannot be undone.',
    yesDelete2: 'Yes, Delete',
    khataDeleteSuccess: '🎉 BanglaKhata: Your khata has been successfully and permanently deleted!',
    khataDeleteError: 'Could not delete! Please try again.',
    newKhataBtn: '+ New BanglaKhata',
    creatingKhata: 'Creating…',
    addKhata: 'Add',
    cancelKhata: 'Cancel',
    newKhataPlaceholder: 'Enter name for new khata or business',
    createFailed: 'Could not add new business. Please try again.',
    pdfAsOfToday: 'As of today',
    pdfTotalExpense: 'Total Expenses(-)',
    pdfTotalCredit: 'Total Credits(+)',
    pdfTotalBalance: 'Total Balance',
    pdfPhone: 'Phone',
    pdfName: 'Name',
    pdfDebit: 'Debit (-)',
    pdfCredit: 'Credit (+)',
    pdfLastTx: 'Last Transaction',
    pdfGrandTotal: 'Grand Total',
    pdfFooterCta: 'Start using BanglaKhata now',
    pdfInstall: 'Install',
    pdfFooterSupport: 'Help: support@banglakhata.com',
    pdfFooterTerms: 'Terms & conditions apply',
    pdfError: 'Failed to create PDF.',
    pdfSupplierNameCol: 'Supplier Name',
    pdfCustomerStatement: 'Customer List Statement',
    pdfSupplierStatement: 'Supplier List Statement',
  },
} as const;

export type TKey = keyof typeof dict.bn;

// ── Context ────────────────────────────────────────────────────────────────────

export interface LanguageCtx {
  lang: Lang;
  isEnglish: boolean;
  t: (key: TKey) => string;
  /** Language-aware ৳ formatter: English digits in English mode, Bengali digits in Bengali mode. */
  formatCurrency: (amount: number) => string;
  /** Language-aware bare number formatter (no ৳ prefix). */
  formatNumber: (amount: number) => string;
}

const defaultCtx: LanguageCtx = {
  lang: 'bn',
  isEnglish: false,
  t: (key) => dict.bn[key],
  formatCurrency: (n) => `৳${formatBengaliNumber(n)}`,
  formatNumber: (n) => formatBengaliNumber(n),
};

const LanguageContext = createContext<LanguageCtx>(defaultCtx);

export const useLanguage = () => useContext(LanguageContext);

// ── Provider ───────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Synchronous first-render read from localStorage — avoids FOUI (flash of untranslated interface).
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });

  // Server is the authoritative source. Syncs here whenever settings load or change.
  const { data: settings } = useGetBusinessSettings();
  useEffect(() => {
    if (!settings?.language) return;
    const resolved: Lang = settings.language === 'English' ? 'en' : 'bn';
    setLang(resolved);
    try { localStorage.setItem(STORAGE_KEY, resolved); } catch { /* ignore */ }
  }, [settings?.language]);

  const value = useMemo<LanguageCtx>(() => {
    const isEnglish = lang === 'en';
    const t = (key: TKey): string =>
      ((dict[lang] as Record<string, string>)[key] ?? dict.bn[key] ?? key);

    const formatNumEn = (amount: number): string => {
      const hasDecimal = !Number.isInteger(amount);
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: hasDecimal ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(amount);
    };

    const formatNumber = (amount: number): string =>
      isEnglish ? formatNumEn(amount) : formatBengaliNumber(amount);

    const formatCurrency = (amount: number): string =>
      `৳${formatNumber(amount)}`;

    return { lang, isEnglish, t, formatCurrency, formatNumber };
  }, [lang]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
