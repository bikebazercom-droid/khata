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

    const formatNumEn = (amount: number): string => {
      const hasDecimal = !Number.isInteger(amount);
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: hasDecimal ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(amount);
    };

    const formatNumber = (amount: number): string =>
      isEnglish ? formatNumEn(amount) : formatBengaliNumber(amount);

    const formatCurrency = (amount: number): string => `৳${formatNumber(amount)}`;

    return { lang, isEnglish, t, formatCurrency, formatNumber };
  }, [lang]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
