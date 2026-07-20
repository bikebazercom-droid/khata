/**
 * i18n — Global language context for BanglaKhata mobile app.
 * Mirror of the web i18n lib; uses SecureStore instead of localStorage.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useGetBusinessSettings } from '@workspace/api-client-react';
import * as SecureStore from 'expo-secure-store';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lang = 'bn' | 'en';
const STORAGE_KEY = 'app_lang';

// ── Translation dictionary ─────────────────────────────────────────────────────

const dict = {
  bn: {
    parties: 'পার্টিস',
    settings: 'সেটিংস',
    customer: 'গ্রাহক',
    supplier: 'সরবরাহকারী',
    youWillGive: 'আপনি দেবেন',
    youWillGet: 'আপনি পাবেন',
    viewReport: 'রিপোর্ট দেখুন',
    all: 'সব',
    get: 'পাবেন',
    give: 'দেবেন',
    addCustomer: 'কাস্টমার যোগ করুন',
    addSupplier: 'সাপ্লায়ার যোগ করুন',
    netBalance: 'নেট ব্যালেন্স',
    overallReceive: 'সামগ্রিকভাবে আপনি পাবেন',
    overallPay: 'সামগ্রিকভাবে আপনি দেবেন',
    recent: 'সাম্প্রতিক',
    seeAll: 'সব দেখুন',
    noRecent: 'কোনো সাম্প্রতিক লেনদেন নেই',
    loadingStore: 'লোড হচ্ছে…',
    myShop: 'আমার দোকান',
    customerLabel: 'গ্রাহক',
    supplierLabel: 'সরবরাহকারী',
    mobileSettingsTitle: 'সেটিংস',
    businessSection: 'ব্যবসা',
    storeNameLabel: 'দোকানের নাম',
    languageLabel: 'ভাষা',
    accountSection: 'অ্যাকাউন্ট',
    signOutLabel: 'সাইন আউট',
    aboutSection: 'সম্পর্কে',
    appNameMobile: 'বাংলা খাতা',
    savingLabel: 'সংরক্ষণ হচ্ছে…',
    saveChanges: 'সংরক্ষণ করুন',
    cancel: 'বাতিল',
    entryDetails: 'বিস্তারিত প্রবেশিকা',
    currentBalance: 'বর্তমান ব্যালেন্স',
    editEntry: 'এন্ট্রি এডিট করুন',
    smsNotSent: '📋 SMS পাঠানো হয়নি',
    entryBackedUp: '☁️ এন্ট্রি ব্যাক আপ করা হয়েছে',
    secureLabel: '✔️ 100% নিরাপদ ও সুরক্ষিত',
    deleteEntryBtn: 'মুছে ফেলুন',
    shareEntryBtn: 'শেয়ার করুন',
    reentry: 'এন্ট্রি সংশোধন (Re-entry)',
    amountLabel: 'টাকার পরিমাণ (৳)',
    descLabel: 'বিবরণ / ডিটেলস',
    notePlaceholder: 'নোট (ঐচ্ছিক)',
    saving: 'সংরক্ষণ হচ্ছে…',
    save: 'সংরক্ষণ করুন',
    deleteEntryTitle: 'এন্ট্রি মুছুন',
    deleteEntryMsg: 'এই এন্ট্রিটি স্থায়ীভাবে মুছে যাবে। আপনি কি নিশ্চিত?',
    cancelAlert: 'বাতিল',
    deleteAlert: 'মুছুন',
    balGave: 'আপনি দিয়েছেন',
    balGot: 'আপনি পেয়েছেন',
    shareGave: 'দিয়েছেন',
    shareGot: 'পেয়েছেন',
    langHint: 'ইন্টারফেসের জন্য পছন্দের ভাষা বেছে নিন',
    // ── User-requested keys (Screenshot_20 / Screenshot_21) ──
    report: 'রিপোর্ট',
    reminder: 'রিমাইন্ডার',
    sms: 'এসএমএস',
    entry: 'এন্ট্রি',
    youGave: 'আপনি দিয়েছেন',
    youReceived: 'আপনি পেয়েছেন',
    today: 'আজ',
    gaveBtn: 'আপনি দিয়েছেন ৳',
    receivedBtn: 'আপনি পেয়েছেন ৳',
    receivedFrom: 'আপনি পেয়েছেন ৳ থেকে',
    placeholderDetails: 'বিস্তারিত লিখুন (পণ্য, বিল নং, পরিমাণ ইত্যাদি)',
    attachBill: 'বিল সংযুক্ত করুন',
    confirmEntry: 'এন্ট্রি নিশ্চিত করুন',
    // ── TransactionSheet ──
    recordTransaction: 'লেনদেন রেকর্ড করুন',
    youGot: 'আপনি পেয়েছেন',
    youGaveLabel: '▲ আপনি দিয়েছেন',
    youGotLabel: '▼ আপনি পেয়েছেন',
    changePhoto: 'ছবি পরিবর্তন করুন',
    attachBillPhoto: 'বিল ছবি সংযুক্ত করুন',
    recordYouGave: 'দিয়েছেন রেকর্ড করুন',
    recordYouGot: 'পেয়েছেন রেকর্ড করুন',
    camera: 'ক্যামেরা',
    photoLibrary: 'ফটো লাইব্রেরি',
    // ── ReminderSheet ──
    sendReminderBtn: 'রিমাইন্ডার পাঠান',
    reminderMsgPlaceholder: 'রিমাইন্ডার বার্তা…',
    send: 'পাঠান',
    sendingOpen: 'খুলছে…',
    // ── LedgerRow ──
    tapToClose: 'বন্ধ করতে চাপুন',
    youGaveTag: '▲ আপনি দিয়েছেন',
    youGotTag: '▼ আপনি পেয়েছেন',
    descYouGave: 'আপনি দিয়েছেন',
    descYouGot: 'আপনি পেয়েছেন',
    balLabel: 'জের',
    // ── PartyDetailScreen ──
    back: 'পেছনে',
    currentBalanceLabel: 'বর্তমান ব্যালেন্স',
    youWillGetArrow: '↑ আপনি পাবেন',
    youWillGiveArrow: '↓ আপনি দেবেন',
    dueDate: 'বকেয়ার তারিখ',
    transactionHistory: 'লেনদেনের ইতিহাস',
    noTransactionsYet: 'এখনো কোনো লেনদেন নেই',
    partyNotFound: 'পার্টি পাওয়া যায়নি',
    goBack: 'পেছনে যান',
    // ── parties.tsx ──
    partiesTitle: 'পার্টিস',
    customersTab: 'গ্রাহকরা',
    suppliersTab: 'সরবরাহকারীরা',
    searchCustomersPlaceholder: 'গ্রাহক খুঁজুন…',
    searchSuppliersPlaceholder: 'সরবরাহকারী খুঁজুন…',
    nameLabel: 'নাম *',
    enterNamePlaceholder: 'নাম লিখুন',
    phoneOptional: 'ফোন (ঐচ্ছিক)',
    openingBalanceOptional: 'শুরুর ব্যালেন্স (ঐচ্ছিক)',
    balanceTypeLabel: 'ব্যালেন্সের ধরন',
    adding: 'যোগ করা হচ্ছে…',
    add: 'যোগ করুন',
    noResults: 'কোনো ফলাফল নেই',
    tryDifferentSearch: 'ভিন্ন শব্দে চেষ্টা করুন',
    willGet: 'পাবেন',
    willGive: 'দেবেন',
    noTransactions: 'কোনো লেনদেন নেই',
    justNow: 'এইমাত্র',
  },
  en: {
    parties: 'Parties',
    settings: 'Settings',
    customer: 'Customer',
    supplier: 'Supplier',
    youWillGive: 'You Will Give',
    youWillGet: 'You Will Get',
    viewReport: 'View Report',
    all: 'All',
    get: 'Get',
    give: 'Give',
    addCustomer: 'Add Customer',
    addSupplier: 'Add Supplier',
    netBalance: 'Net Balance',
    overallReceive: 'Overall you will receive',
    overallPay: 'Overall you must pay',
    recent: 'Recent',
    seeAll: 'See all',
    noRecent: 'No recent transactions',
    loadingStore: 'Loading…',
    myShop: 'My Shop',
    customerLabel: 'Customer',
    supplierLabel: 'Supplier',
    mobileSettingsTitle: 'Settings',
    businessSection: 'BUSINESS',
    storeNameLabel: 'Store Name',
    languageLabel: 'Language',
    accountSection: 'ACCOUNT',
    signOutLabel: 'Sign Out',
    aboutSection: 'ABOUT',
    appNameMobile: 'BanglaKhata',
    savingLabel: 'Saving…',
    saveChanges: 'Save Changes',
    cancel: 'Cancel',
    entryDetails: 'Entry Details',
    currentBalance: 'Current Balance',
    editEntry: 'Edit Entry',
    smsNotSent: '📋 SMS Not Sent',
    entryBackedUp: '☁️ Entry backed up',
    secureLabel: '✔️ 100% Safe & Secure',
    deleteEntryBtn: 'Delete',
    shareEntryBtn: 'Share',
    reentry: 'Edit Entry (Re-entry)',
    amountLabel: 'Amount (৳)',
    descLabel: 'Description / Details',
    notePlaceholder: 'Note (optional)',
    saving: 'Saving…',
    save: 'Save',
    deleteEntryTitle: 'Delete Entry',
    deleteEntryMsg: 'This entry will be permanently deleted. Are you sure?',
    cancelAlert: 'Cancel',
    deleteAlert: 'Delete',
    balGave: 'You gave',
    balGot: 'You received',
    shareGave: 'gave',
    shareGot: 'received',
    langHint: 'Choose your preferred language for the interface',
    // ── User-requested keys (Screenshot_20 / Screenshot_21) ──
    report: 'Report',
    reminder: 'Reminder',
    sms: 'SMS',
    entry: 'Entry',
    youGave: 'You Gave',
    youReceived: 'You Received',
    today: 'Today',
    gaveBtn: 'You Gave ৳',
    receivedBtn: 'You Received ৳',
    receivedFrom: 'You received ৳ from',
    placeholderDetails: 'Enter details (item, bill no, quantity etc.)',
    attachBill: 'Attach Bill',
    confirmEntry: 'Confirm Entry',
    // ── TransactionSheet ──
    recordTransaction: 'Record Transaction',
    youGot: 'You Got',
    youGaveLabel: '▲ YOU GAVE',
    youGotLabel: '▼ YOU GOT',
    changePhoto: 'Change photo',
    attachBillPhoto: 'Attach bill photo',
    recordYouGave: 'Record You Gave',
    recordYouGot: 'Record You Got',
    camera: 'Camera',
    photoLibrary: 'Photo Library',
    // ── ReminderSheet ──
    sendReminderBtn: 'Send Reminder',
    reminderMsgPlaceholder: 'Reminder message…',
    send: 'Send',
    sendingOpen: 'Opening…',
    // ── LedgerRow ──
    tapToClose: 'Tap to close',
    youGaveTag: '▲ YOU GAVE',
    youGotTag: '▼ YOU GOT',
    descYouGave: 'You gave',
    descYouGot: 'You got',
    balLabel: 'Bal.',
    // ── PartyDetailScreen ──
    back: 'Back',
    currentBalanceLabel: 'CURRENT BALANCE',
    youWillGetArrow: '↑ You Will Get',
    youWillGiveArrow: '↓ You Will Give',
    dueDate: 'Due date',
    transactionHistory: 'TRANSACTION HISTORY',
    noTransactionsYet: 'No transactions yet',
    partyNotFound: 'Party not found',
    goBack: 'Go back',
    // ── parties.tsx ──
    partiesTitle: 'Parties',
    customersTab: 'Customers',
    suppliersTab: 'Suppliers',
    searchCustomersPlaceholder: 'Search customers…',
    searchSuppliersPlaceholder: 'Search suppliers…',
    nameLabel: 'Name *',
    enterNamePlaceholder: 'Enter name',
    phoneOptional: 'Phone (optional)',
    openingBalanceOptional: 'Opening balance (optional)',
    balanceTypeLabel: 'Balance type',
    adding: 'Adding…',
    add: 'Add',
    noResults: 'No results',
    tryDifferentSearch: 'Try a different search term',
    willGet: 'will get',
    willGive: 'will give',
    noTransactions: 'No transactions',
    justNow: 'Just now',
  },
} as const;

export type TKey = keyof typeof dict.bn;

// ── Context ────────────────────────────────────────────────────────────────────

export interface LanguageCtx {
  lang: Lang;
  isEnglish: boolean;
  t: (key: TKey) => string;
  formatCurrency: (amount: number) => string;
  formatNumber: (amount: number) => string;
}

const LanguageContext = createContext<LanguageCtx>({
  lang: 'bn',
  isEnglish: false,
  t: (key) => dict.bn[key],
  formatCurrency: (n) => `৳${n.toLocaleString('en-IN')}`,
  formatNumber: (n) => n.toLocaleString('en-IN'),
});

export const useLanguage = () => useContext(LanguageContext);

// ── Bengali digit helpers ──────────────────────────────────────────────────────

const EN_TO_BN: Record<string, string> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};

function toBengaliDigits(str: string): string {
  return str.split('').map((ch) => EN_TO_BN[ch] ?? ch).join('');
}

function formatBengaliNumber(amount: number): string {
  const hasDecimal = !Number.isInteger(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return toBengaliDigits(formatted);
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('bn');

  // Load persisted language on mount
  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((val) => { if (val === 'en' || val === 'bn') setLang(val); })
      .catch(() => {});
  }, []);

  // Server is the authoritative source
  const { data: settings } = useGetBusinessSettings();
  useEffect(() => {
    if (!settings?.language) return;
    const resolved: Lang = settings.language === 'English' ? 'en' : 'bn';
    setLang(resolved);
    SecureStore.setItemAsync(STORAGE_KEY, resolved).catch(() => {});
  }, [settings?.language]);

  const value = useMemo<LanguageCtx>(() => {
    const isEnglish = lang === 'en';
    const t = (key: TKey): string =>
      ((dict[lang] as Record<string, string>)[key] ?? dict.bn[key] ?? key);

    // formatNumber — plain digit conversion, no grouping (matches user's formatNumber spec).
    const formatNumber = (amount: number): string => {
      if (isEnglish) return amount.toString();
      const bn: Record<string, string> = {
        '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
        '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
      };
      return amount.toString().split('').map(d => bn[d] ?? d).join('');
    };

    // formatCurrency — keeps Indian comma grouping for both modes; prefixes ৳.
    const formatCurrency = (amount: number): string => {
      if (isEnglish) {
        const hasDecimal = !Number.isInteger(amount);
        const grouped = new Intl.NumberFormat('en-IN', {
          minimumFractionDigits: hasDecimal ? 2 : 0,
          maximumFractionDigits: 2,
        }).format(amount);
        return `৳${grouped}`;
      }
      return `৳${formatBengaliNumber(amount)}`;
    };

    return { lang, isEnglish, t, formatCurrency, formatNumber };
  }, [lang]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
