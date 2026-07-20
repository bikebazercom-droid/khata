/**
 * i18n — Global language context for BanglaKhata mobile app.
 * The app is permanently locked to Bengali (bn). All UI text is in Bengali.
 */
import React, { createContext, useContext } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lang = 'bn';

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
    sendReminderBtn: 'রিমাইন্ডার পাঠান',
    reminderMsgPlaceholder: 'রিমাইন্ডার বার্তা…',
    send: 'পাঠান',
    sendingOpen: 'খুলছে…',
    tapToClose: 'বন্ধ করতে চাপুন',
    youGaveTag: '▲ আপনি দিয়েছেন',
    youGotTag: '▼ আপনি পেয়েছেন',
    descYouGave: 'আপনি দিয়েছেন',
    descYouGot: 'আপনি পেয়েছেন',
    balLabel: 'জের',
    back: 'পেছনে',
    currentBalanceLabel: 'বর্তমান ব্যালেন্স',
    youWillGetArrow: '↑ আপনি পাবেন',
    youWillGiveArrow: '↓ আপনি দেবেন',
    dueDate: 'বকেয়ার তারিখ',
    transactionHistory: 'লেনদেনের ইতিহাস',
    noTransactionsYet: 'এখনো কোনো লেনদেন নেই',
    partyNotFound: 'পার্টি পাওয়া যায়নি',
    goBack: 'পেছনে যান',
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
} as const;

export type TKey = keyof typeof dict.bn;

// ── Context ────────────────────────────────────────────────────────────────────

export interface LanguageCtx {
  lang: Lang;
  currentLanguage: Lang;
  isEnglish: false;
  t: (key: TKey) => string;
  formatCurrency: (amount: number) => string;
  formatNumber: (amount: number) => string;
  setLanguage: (lang: Lang) => void; // no-op — language is locked to Bengali
}

// ── Bengali digit helpers ──────────────────────────────────────────────────────

const EN_TO_BN: Record<string, string> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};

function toBengaliDigits(str: string): string {
  return str.split('').map((ch) => EN_TO_BN[ch] ?? ch).join('');
}

// ── Singleton context value (never changes — language is fixed to bn) ──────────

const t = (key: TKey): string => dict.bn[key];

const formatCurrency = (amount: number): string => {
  const abs = Math.abs(amount);
  const hasDecimal = !Number.isInteger(abs);
  const grouped = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs);
  return `৳${toBengaliDigits(grouped)}`;
};

const formatNumber = (amount: number): string =>
  amount.toString().split('').map(d => EN_TO_BN[d] ?? d).join('');

const CONTEXT_VALUE: LanguageCtx = {
  lang: 'bn',
  currentLanguage: 'bn',
  isEnglish: false,
  t,
  formatCurrency,
  formatNumber,
  setLanguage: () => {}, // no-op
};

const LanguageContext = createContext<LanguageCtx>(CONTEXT_VALUE);

export const useLanguage = () => useContext(LanguageContext);

// ── Provider ───────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // No state needed — the value is a fixed constant.
  return (
    <LanguageContext.Provider value={CONTEXT_VALUE}>
      {children}
    </LanguageContext.Provider>
  );
}
