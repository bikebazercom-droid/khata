import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { formatBengaliNumber } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lang = 'bn' | 'en';
export const LANGUAGE_STORAGE_KEY = 'banglakhata-language';

// ── Translation dictionary ─────────────────────────────────────────────────────

const bn = {
  parties: 'গ্রাহক',
  moreTitle: 'বিস্তারিত',
  access: 'অ্যাক্সেস',
  staffDutyFolder: 'ডিউটি ফোল্ডার',
  scanLedger: 'বাংলা খাতা স্ক্যান করুন',
  scan: 'স্ক্যান',
  moreMenu: 'অ্যারো মেনু খুলুন',
  settings: 'সেটিংস',
  customer: 'গ্রাহক',
  supplier: 'সরবরাহকারী',
  youWillGive: 'আপনি দেবেন',
  youWillGet: 'আপনি পাবেন',
  viewReport: 'রিপোর্ট দেখুন',
  searchCustomer: 'গ্রাহক খুঁজুন...',
  searchSupplier: 'সরবরাহকারী খুঁজুন...',
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
  get: 'পেয়েছেন',
  give: 'দিয়েছেন',
  addCustomer: 'গ্রাহক যোগ করুন',
  addSupplier: 'সরবরাহকারী যোগ করুন',
  emptyCustomer: 'গ্রাহক যোগ করুন এবং দ্রুত বকেয়া কালেকশন করুন',
  emptySupplier: 'সরবরাহকারী যোগ করুন এবং আপনার হিসাব পরিষ্কার রাখুন',
  receiptGot: 'আপনি পেয়েছেন',
  receiptGave: 'আপনি দিয়েছেন',
  receiptBalance: 'বর্তমান ব্যালেন্স',
  settingsTitle: 'সেটিংস',
  profileInfo: 'প্রোফাইল তথ্য ও নাম যোগ',
  changeLanguage: 'ভাষা পরিবর্তন',
  loginIdentity: 'লগইন অবস্থা / পরিচয়',
  noLogin: 'লগইন করা নেই',
  phoneLoginFallback: 'ফোন নম্বরে লগইন',
  emailLoginFallback: 'ইমেইলে লগইন',
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
} as const;

const en: Record<keyof typeof bn, string> = {
  parties: 'Customers', moreTitle: 'Details', access: 'Access', staffDutyFolder: 'Staff duty folder',
  scanLedger: 'Scan ledger', scan: 'Scan', moreMenu: 'Open more menu',
  settings: 'More', customer: 'Customer', supplier: 'Supplier',
  youWillGive: 'You will give', youWillGet: 'You will receive', viewReport: 'View report',
  searchCustomer: 'Search customers...', searchSupplier: 'Search suppliers...',
  filter: 'Filter', filterAndSort: 'Filter and sort', filterBy: 'Filter by', sortBy: 'Sort by',
  all: 'All', permanent: 'No due date', dueToday: 'Due today', upcoming: 'Upcoming',
  noDate: 'No date', noSpecificDate: 'No specific date', mostRecent: 'Most recent',
  highestAmount: 'Highest amount', byName: 'Name (A–Z)', oldest: 'Oldest',
  lowestAmount: 'Lowest amount', showResults: 'Show results', reset: 'Reset',
  addStaff: 'Add staff', loading: 'Loading...', get: 'Received', give: 'Paid',
  addCustomer: 'Add customer', addSupplier: 'Add supplier',
  emptyCustomer: 'Add a customer to start tracking balances',
  emptySupplier: 'Add a supplier to keep your accounts organized',
  receiptGot: 'You received', receiptGave: 'You paid', receiptBalance: 'Current balance',
  settingsTitle: 'Settings', profileInfo: 'Profile information', changeLanguage: 'Language / ভাষা',
  loginIdentity: 'Login status / identity', noLogin: 'Not logged in',
  phoneLoginFallback: 'Signed in with phone', emailLoginFallback: 'Signed in with email',
  loginLogout: 'Log in / Log out', fieldUserName: 'User name',
  fieldShopName: 'Shop or business name (PDF header)', fieldPhone: 'Phone number (PDF footer)',
  fieldEmail: 'Email address', fieldAddress: 'Address (PDF footer)',
  deviceOnly: 'This information is stored only on this device',
  langHint: 'Choose your preferred language for the app and reports',
  logoutHint: 'Logging out will disconnect this device', loggingOut: 'Logging out…',
  logoutBtn: 'Log out', loginBtn: 'Log in', deleteAccount: 'Delete account',
  deleteAccountHint: 'All transactions and cached data will be removed. This cannot be undone.',
  confirmDeleteTitle: 'Delete your entire account?',
  confirmDeleteLine1: 'All your ledgers, customers, transactions, and data will be permanently deleted.',
  confirmDeleteLine2: 'Signing in later with the same email or phone will create a new empty account.',
  no: 'Cancel', yesDelete: 'Yes, delete', deleting: 'Deleting…',
  deleteSuccess: 'Your BanglaKhata account was permanently deleted.',
  deleteError: 'Could not delete the account. Please try again.', yourKhatas: 'Your ledgers',
  khataCustomers: 'Customers', businessStamp: 'Create business stamp', deleteKhata: 'Delete',
  confirmDeleteKhataTitle: 'Delete this ledger?',
  confirmDeleteKhataBody: 'All customers and transaction data in this ledger will be permanently deleted.',
  cannotUndo: 'This cannot be undone.', yesDelete2: 'Yes, delete',
  khataDeleteSuccess: 'Your ledger was permanently deleted.',
  khataDeleteError: 'Could not delete it. Please try again.', newKhataBtn: '+ New ledger',
  creatingKhata: 'Creating…', addKhata: 'Add', cancelKhata: 'Cancel',
  newKhataPlaceholder: 'Enter a new ledger or business name',
  createFailed: 'Could not add the new business. Please try again.',
  pdfAsOfToday: 'As of today', pdfTotalExpense: 'Total debit (-)',
  pdfTotalCredit: 'Total credit (+)', pdfTotalBalance: 'Total balance', pdfPhone: 'Phone',
  pdfName: 'Name', pdfDebit: 'Debit (-)', pdfCredit: 'Credit (+)',
  pdfLastTx: 'Last transaction', pdfGrandTotal: 'Grand total',
  pdfFooterCta: 'Start using BanglaKhata today', pdfInstall: 'Install',
  pdfFooterSupport: 'Help: support@banglakhata.com', pdfFooterTerms: 'Terms and conditions apply',
  pdfError: 'Could not create the PDF.', pdfSupplierNameCol: 'Supplier name',
  pdfCustomerStatement: 'Customer statement', pdfSupplierStatement: 'Supplier statement',
};

export type TKey = keyof typeof bn;

// ── Context ────────────────────────────────────────────────────────────────────

export interface LanguageCtx {
  lang: Lang;
  isEnglish: boolean;
  setLang: (lang: Lang) => void;
  t: (key: TKey) => string;
  /** Currency formatter uses the active language's digits and grouping. */
  formatCurrency: (amount: number) => string;
  /** Number formatter without a currency prefix. */
  formatNumber: (amount: number) => string;
}

const LanguageContext = createContext<LanguageCtx>({
  lang: 'bn',
  isEnglish: false,
  setLang: () => {},
  t: (key) => bn[key],
  formatCurrency: (amount) => `৳${formatBengaliNumber(amount)}`,
  formatNumber: (amount) => formatBengaliNumber(amount),
});

export const useLanguage = () => useContext(LanguageContext);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'bn';
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'bn';
  });
  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<LanguageCtx>(() => ({
    lang,
    isEnglish: lang === 'en',
    setLang,
    t: (key) => lang === 'en' ? en[key] : bn[key],
    formatCurrency: (amount) => `৳${lang === 'en'
      ? new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(amount)
      : formatBengaliNumber(amount)}`,
    formatNumber: (amount) => lang === 'en'
      ? new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(amount)
      : formatBengaliNumber(amount),
  }), [lang]);
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
