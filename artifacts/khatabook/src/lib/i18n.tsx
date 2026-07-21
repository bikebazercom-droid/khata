/**
 * i18n — Global language context for BanglaKhata web app.
 *
 * Language is permanently locked to Bengali (bn).
 * The English option has been removed. isEnglish is always false.
 */
import { createContext, useContext } from 'react';
import { formatBengaliNumber } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lang = 'bn';

// ── Translation dictionary ─────────────────────────────────────────────────────

const dict = {
  parties: 'গ্রাহক',
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

export type TKey = keyof typeof dict;

// ── Context ────────────────────────────────────────────────────────────────────

export interface LanguageCtx {
  lang: Lang;
  /** Always false — English has been removed. Kept for type compat. */
  isEnglish: false;
  t: (key: TKey) => string;
  /** Bengali ৳ formatter with Bengali digits. */
  formatCurrency: (amount: number) => string;
  /** Bengali digit formatter (no ৳ prefix). */
  formatNumber: (amount: number) => string;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const t = (key: TKey): string => dict[key];

const formatCurrency = (amount: number): string =>
  `৳${formatBengaliNumber(amount)}`;

const formatNumber = (amount: number): string =>
  amount.toString().split('').map(d => (
    ({ '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯' } as Record<string,string>)[d] ?? d
  )).join('');

// ── Singleton context (never changes) ─────────────────────────────────────────

const CONTEXT_VALUE: LanguageCtx = {
  lang: 'bn',
  isEnglish: false,
  t,
  formatCurrency,
  formatNumber,
};

const LanguageContext = createContext<LanguageCtx>(CONTEXT_VALUE);

export const useLanguage = () => useContext(LanguageContext);

// ── Provider ───────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Language is permanently Bengali. No state, no server sync.
  return (
    <LanguageContext.Provider value={CONTEXT_VALUE}>
      {children}
    </LanguageContext.Provider>
  );
}
