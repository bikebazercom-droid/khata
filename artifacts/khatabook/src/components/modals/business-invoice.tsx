import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CalendarDays, Check, ChevronDown, Download, FileText, ImagePlus, Plus, ReceiptText, Share2, Trash2, UserRound, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/lib/i18n';
import { saveGeneratedFileWithNative, shareGeneratedFileWithNative } from '@/lib/native-file-export';
import { normalizePdfColors } from '@/lib/pdf-color-normalization';
import { fitA4Content } from '@/lib/fit-a4-content';
import { saveInvoiceHistory, type InvoiceHistoryAction, type InvoiceHistoryRecord } from './invoice-history';

type InvoiceLine = { id: number; description: string; amount: string; taxed: boolean };
type CustomerDocumentType = 'nid' | 'passport' | 'civil_id' | 'trade_license' | 'other';
const customerDocumentTypes: CustomerDocumentType[] = ['nid', 'passport', 'civil_id', 'trade_license', 'other'];
type InvoiceData = {
  company: string; address: string; phone: string; website: string; logo: string;
  email: string; trn: string; locationUrl: string;
  customer: string; customerAddress: string; customerPhone: string;
  customerIdType: CustomerDocumentType; customerIdNumber: string;
  number: string; date: string; currency: string; taxRate: string; comments: string;
  paymentTerms: string; metalRate: string; placeOfSupply: string;
};

type SharedInvoice = { invoiceData: InvoiceData; lines: InvoiceLine[] };
type BusinessProfile = Pick<InvoiceData, 'company' | 'address' | 'phone' | 'website' | 'email' | 'trn' | 'locationUrl' | 'logo'>;
const BUSINESS_PROFILE_KEY = 'banglakhata_business_invoice_profile_v1';
const fallbackCurrencyCodes = 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW ZWG ZWL'.split(' ');
const currencyCountryAliases: Record<string, string[]> = {
  AED: ['UAE', 'United Arab Emirates', 'Dubai', 'Abu Dhabi'],
  AUD: ['Australia'], BDT: ['Bangladesh'], BHD: ['Bahrain'], CAD: ['Canada'],
  CHF: ['Switzerland'], CNY: ['China'], EUR: ['Eurozone', 'Europe'], GBP: ['United Kingdom', 'UK', 'Britain'],
  HKD: ['Hong Kong'], IDR: ['Indonesia'], INR: ['India'], JPY: ['Japan'], KRW: ['South Korea', 'Korea'],
  KWD: ['Kuwait'], LKR: ['Sri Lanka'], MYR: ['Malaysia'], NPR: ['Nepal'], NZD: ['New Zealand'],
  OMR: ['Oman'], PHP: ['Philippines'], PKR: ['Pakistan'], QAR: ['Qatar'], RUB: ['Russia'],
  SAR: ['Saudi Arabia'], SGD: ['Singapore'], THB: ['Thailand'], TRY: ['Turkey', 'Türkiye'], USD: ['United States', 'USA', 'America'], ZAR: ['South Africa'],
  EGP: ['Egypt'], MXN: ['Mexico'], BRL: ['Brazil'], SEK: ['Sweden'], NOK: ['Norway'], DKK: ['Denmark'],
  PLN: ['Poland'], CZK: ['Czechia', 'Czech Republic'], HUF: ['Hungary'], UAH: ['Ukraine'], VND: ['Vietnam'],
};
const currencySymbolOverrides: Record<string, string> = {
  AED: 'د.إ', BDT: '৳', BHD: '.د.ب', EUR: '€', GBP: '£', INR: '₹', KWD: 'د.ك',
  OMR: 'ر.ع.', QAR: 'ر.ق', SAR: '﷼', USD: '$',
};

function supportedCurrencyCodes(): string[] {
  try {
    const values = Intl.supportedValuesOf('currency');
    return [...new Set([...values, ...fallbackCurrencyCodes])].sort();
  } catch {
    return fallbackCurrencyCodes;
  }
}

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code;
  } catch {
    return code;
  }
}

function currencySymbol(code: string, locale: string): string {
  if (currencySymbolOverrides[code]) return currencySymbolOverrides[code];
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(1).find((part) => part.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}

function businessProfileStorageKey(): string {
  if (typeof window === 'undefined') return `${BUSINESS_PROFILE_KEY}:default`;
  return `${BUSINESS_PROFILE_KEY}:${window.localStorage.getItem('selected_business_id') || 'default'}`;
}

function loadBusinessProfile(): BusinessProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(businessProfileStorageKey()) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const profile = value as Record<string, unknown>;
    const fields: (keyof BusinessProfile)[] = ['company', 'address', 'phone', 'website', 'email', 'trn', 'locationUrl', 'logo'];
    if (fields.some((field) => typeof profile[field] !== 'string')) return null;
    return profile as BusinessProfile;
  } catch {
    return null;
  }
}

function resizeLogoFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return Promise.reject(new Error('Choose a PNG or JPG image.'));
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error('Logo image must be smaller than 8 MB.'));
  }

  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 160;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(source);
        reject(new Error('Could not process this logo image.'));
        return;
      }
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      context.drawImage(image, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height);
      try {
        resolve(canvas.toDataURL(file.type, file.type === 'image/jpeg' ? 0.88 : undefined));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(source);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error('Could not read this logo image.'));
    };
    image.src = source;
  });
}

function decodeInvoiceFromLink(): SharedInvoice | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.hash.match(/^#invoice=([A-Za-z0-9_-]+)$/);
  if (!match || match[1].length > 60000) return null;

  try {
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharedInvoice>;
    if (!parsed.invoiceData || !Array.isArray(parsed.lines)) return null;
    const data = parsed.invoiceData as Partial<InvoiceData>;
    if (typeof data.currency !== 'string' || !supportedCurrencyCodes().includes(data.currency)) return null;

    const stringFields: (keyof InvoiceData)[] = [
      'company', 'address', 'phone', 'website', 'logo', 'customer',
      'customerAddress', 'customerPhone', 'number', 'date', 'taxRate', 'comments',
    ];
    if (stringFields.some((field) => typeof data[field] !== 'string')) return null;
    const invoiceData = {
      ...data,
      customerIdType: customerDocumentTypes.includes(data.customerIdType as CustomerDocumentType)
        ? data.customerIdType as CustomerDocumentType
        : 'nid',
      customerIdNumber: typeof data.customerIdNumber === 'string' ? data.customerIdNumber : '',
      email: typeof data.email === 'string' ? data.email : '',
      trn: typeof data.trn === 'string' ? data.trn : '',
      locationUrl: typeof data.locationUrl === 'string' ? data.locationUrl : '',
      paymentTerms: typeof data.paymentTerms === 'string' ? data.paymentTerms : 'Cash',
      metalRate: typeof data.metalRate === 'string' ? data.metalRate : '',
      placeOfSupply: typeof data.placeOfSupply === 'string' ? data.placeOfSupply : '',
    } as InvoiceData;
    const lines = parsed.lines.slice(0, 100).filter((line): line is InvoiceLine =>
      Boolean(line) &&
      typeof line === 'object' &&
      typeof (line as InvoiceLine).description === 'string' &&
      typeof (line as InvoiceLine).amount === 'string' &&
      typeof (line as InvoiceLine).taxed === 'boolean',
    ).map((line, index) => ({
      id: index + 1,
      description: line.description.slice(0, 1000),
      amount: line.amount.slice(0, 32),
      taxed: line.taxed,
    }));
    return { invoiceData, lines: lines.length ? lines : [{ id: 1, description: '', amount: '', taxed: false }] };
  } catch {
    return null;
  }
}

function encodeInvoiceForLink(invoice: SharedInvoice): string {
  const bytes = new TextEncoder().encode(JSON.stringify(invoice));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const newInvoiceNumber = () => {
  try {
    const businessId = typeof window === 'undefined' ? 'default' : (window.localStorage.getItem('selected_business_id') || 'default');
    const key = `banglakhata_invoice_sequence:${businessId}:${today().replaceAll('-', '')}`;
    const next = Number(window.localStorage.getItem(key) || 0) + 1;
    window.localStorage.setItem(key, String(next));
    return `INV-${today().replaceAll('-', '')}-${next}`;
  } catch {
    return `INV-${today().replaceAll('-', '')}-${Date.now().toString().slice(-4)}`;
  }
};
const localeForLanguage = (lang: string) => lang === 'en' ? 'en-US' : 'bn-BD';
const money = (value: number, currency: string, lang: string) => {
  try {
    const locale = localeForLanguage(lang);
    const number = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(value)
      .filter((part) => ['integer', 'group', 'decimal', 'fraction'].includes(part.type))
      .map((part) => part.value).join('');
    return `${currencySymbol(currency, locale)} ${number} ${currency}`;
  } catch {
    return `${currency} ${new Intl.NumberFormat(localeForLanguage(lang), { maximumFractionDigits: 2 }).format(value)}`;
  }
};
const dateLabel = (value: string, lang: string) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString(localeForLanguage(lang)) : '—';

export function BusinessInvoice({ historyRecord, autoAction = 'open', viewOnly = false, onGenerated }: { historyRecord?: InvoiceHistoryRecord; autoAction?: InvoiceHistoryAction; viewOnly?: boolean; onGenerated?: () => void }) {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const printRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  const [readOnlyPreview, setReadOnlyPreview] = useState(viewOnly);
  const [pdfMode, setPdfMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currencyPopoverOpen, setCurrencyPopoverOpen] = useState(false);
  const sharedInvoice = useMemo(decodeInvoiceFromLink, []);
  const restored = historyRecord?.type === 'Business' ? historyRecord.payload as { invoiceData?: InvoiceData; lines?: InvoiceLine[] } : undefined;
  const savedProfile = useMemo(loadBusinessProfile, []);
  const [businessProfile, setBusinessProfile] = useState(savedProfile);
  const [editingProfile, setEditingProfile] = useState(() => !savedProfile);
  const [invoiceData, setInvoiceData] = useState<InvoiceData>(() => sharedInvoice?.invoiceData ?? restored?.invoiceData ?? ({
    company: '', address: '', phone: '', website: '', logo: '',
    email: '', trn: '', locationUrl: '',
    customer: '', customerAddress: '', customerPhone: '', customerIdType: 'nid', customerIdNumber: '',
    number: newInvoiceNumber(), date: today(), currency: 'BDT', taxRate: '0', comments: '',
    paymentTerms: 'Cash', metalRate: '', placeOfSupply: '',
    ...savedProfile,
  }));
  const [lines, setLines] = useState<InvoiceLine[]>(() => sharedInvoice?.lines ?? restored?.lines ?? [{ id: 1, description: '', amount: '', taxed: false }]);
  const [nextId, setNextId] = useState(() => Math.max(1, ...(sharedInvoice?.lines ?? []).map((line) => line.id)) + 1);
  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
    const taxable = lines.reduce((sum, item) => sum + (item.taxed ? Math.max(0, Number(item.amount) || 0) : 0), 0);
    const tax = taxable * (Math.max(0, Number(invoiceData.taxRate) || 0) / 100);
    return { subtotal, taxable, tax, total: subtotal + tax };
  }, [lines, invoiceData.taxRate]);
  const labels = en ? {
    title: 'Business invoice', subtitle: 'A clear, professional bill for your customer.',
    company: 'Shop details', address: 'Business address', phone: 'Phone number', website: 'Website', logo: 'Business logo',
    email: 'Email address', trn: 'TRN / Tax registration number', locationUrl: 'Google Maps / business location URL',
    customer: 'Customer name', customerAddress: 'Customer address', customerPhone: 'Customer phone',
    customerIdType: 'ID Type', customerIdNumber: 'ID / Document Number',
    customerPhoneLabel: 'Phone', customerAddressLabel: 'Address',
    number: 'Invoice number', date: 'Invoice date', currency: 'Currency', tax: 'Tax rate (%)',
    currencySearch: 'Search by country, symbol, or ISO code…', currencyNoResults: 'No currencies found.',
    paymentTerms: 'Payment terms', metalRate: 'Metal / unit rate', placeOfSupply: 'Place of supply',
    description: 'Item description', taxed: 'Taxable', amount: 'Amount', add: 'Add an item', comments: 'Notes or payment terms',
    download: 'Download PDF', share: 'Share',
    subtotal: 'Subtotal', taxable: 'Taxable amount', taxDue: 'Tax', total: 'Total due', thank: 'Thank you for your business.',
    companyBlock: 'From your shop', billTo: 'Bill to', commentsBlock: 'Notes', empty: 'Add your shop and customer details to complete the invoice.',
    shared: 'Invoice link copied. Paste it into WhatsApp or email.', shareError: 'Could not share the invoice.',
    downloadError: 'Could not prepare the invoice PDF.',
    setup: 'Invoice details', item: 'Item', remove: 'Remove item', taxHint: 'Tax is calculated only on items marked taxable.',
    profileSaved: 'Business Details Saved', editProfile: 'Edit Profile', saveProfile: 'Save Business Profile',
    cancel: 'Cancel', uploadLogo: 'Upload a PNG or JPG logo', logoLimit: 'Logo is resized to fit the invoice header.',
    taxInvoice: 'TAX INVOICE', partyCopy: 'PARTY COPY', scanToFind: 'Scan to find us',
  } : {
    title: 'বিজনেস ইনভয়েস', subtitle: 'গ্রাহকের জন্য পরিষ্কার ও পেশাদার বিল তৈরি করুন।',
    company: 'দোকানের নাম', address: 'ব্যবসার ঠিকানা', phone: 'ফোন নম্বর', website: 'ওয়েবসাইট', logo: 'দোকানের লোগো',
    email: 'ইমেইল ঠিকানা', trn: 'টিআরএন / কর নিবন্ধন নম্বর', locationUrl: 'গুগল ম্যাপ / ব্যবসার অবস্থানের লিংক',
    customer: 'গ্রাহকের নাম', customerAddress: 'গ্রাহকের ঠিকানা', customerPhone: 'গ্রাহকের ফোন',
    customerIdType: 'পরিচয়পত্রের ধরন', customerIdNumber: 'আইডি / নথি নম্বর',
    customerPhoneLabel: 'ফোন', customerAddressLabel: 'ঠিকানা',
    number: 'ইনভয়েস নম্বর', date: 'ইনভয়েসের তারিখ', currency: 'মুদ্রা', tax: 'কর হার (%)',
    currencySearch: 'দেশ, প্রতীক বা ISO কোড দিয়ে খুঁজুন…', currencyNoResults: 'কোনো মুদ্রা পাওয়া যায়নি।',
    paymentTerms: 'পেমেন্টের শর্ত', metalRate: 'ধাতু / একক মূল্য', placeOfSupply: 'সরবরাহের স্থান',
    description: 'পণ্যের বিবরণ', taxed: 'করযোগ্য', amount: 'পরিমাণ', add: 'আইটেম যোগ করুন', comments: 'নোট বা পেমেন্টের শর্ত',
    download: 'PDF ডাউনলোড', share: 'শেয়ার',
    subtotal: 'সাবটোটাল', taxable: 'করযোগ্য পরিমাণ', taxDue: 'কর', total: 'মোট পাওনা', thank: 'আপনার ব্যবসার জন্য ধন্যবাদ।',
    companyBlock: 'আপনার দোকান থেকে', billTo: 'যার নামে বিল', commentsBlock: 'নোট', empty: 'ইনভয়েস সম্পূর্ণ করতে দোকান ও গ্রাহকের তথ্য দিন।',
    shared: 'ইনভয়েসের লিংক কপি হয়েছে। WhatsApp বা ইমেইলে পেস্ট করুন।', shareError: 'ইনভয়েস শেয়ার করা যায়নি।',
    downloadError: 'ইনভয়েস PDF তৈরি করা যায়নি।',
    setup: 'ইনভয়েসের তথ্য', item: 'আইটেম', remove: 'আইটেম মুছুন', taxHint: 'শুধু করযোগ্য হিসেবে চিহ্নিত আইটেমে কর হিসাব হবে।',
    profileSaved: 'ব্যবসার তথ্য সংরক্ষিত', editProfile: 'প্রোফাইল সম্পাদনা', saveProfile: 'ব্যবসার প্রোফাইল সংরক্ষণ',
    cancel: 'বাতিল', uploadLogo: 'PNG বা JPG লোগো আপলোড করুন', logoLimit: 'লোগো ইনভয়েসের হেডারে মানানসই করে ছোট করা হবে।',
    taxInvoice: 'ট্যাক্স ইনভয়েস', partyCopy: 'পার্টি কপি', scanToFind: 'খুঁজে পেতে স্ক্যান করুন',
  };
  const customerDocumentLabels: Record<CustomerDocumentType, string> = en ? {
    nid: 'National ID (NID)',
    passport: 'Passport',
    civil_id: 'Emirates ID / Civil ID',
    trade_license: 'Trade License',
    other: 'Other ID',
  } : {
    nid: 'জাতীয় পরিচয়পত্র (NID)',
    passport: 'পাসপোর্ট',
    civil_id: 'এমিরেটস আইডি / সিভিল আইডি',
    trade_license: 'ট্রেড লাইসেন্স',
    other: 'অন্যান্য পরিচয়পত্র',
  };
  const set = (key: keyof InvoiceData, value: string) => setInvoiceData((current) => ({ ...current, [key]: value }));
  const current = invoiceData;
  const locale = localeForLanguage(lang);
  const currencyOptions = useMemo(() => supportedCurrencyCodes().map((code) => {
    const name = currencyName(code, locale);
    const symbol = currencySymbol(code, locale);
    const aliases = currencyCountryAliases[code] || [];
    return { code, name, symbol, aliases, search: `${code} ${name} ${symbol} ${aliases.join(' ')}`.toLocaleLowerCase(locale) };
  }), [locale]);
  useEffect(() => {
    setReadOnlyPreview(viewOnly);
  }, [viewOnly]);
  const selectedCurrency = currencyOptions.find((option) => option.code === current.currency);
  const customerDocumentOutputLabel: Record<CustomerDocumentType, string> = {
    nid: 'NID',
    passport: en ? 'Passport No' : 'পাসপোর্ট নম্বর',
    civil_id: en ? 'Emirates ID / Civil ID' : 'এমিরেটস আইডি / সিভিল আইডি',
    trade_license: en ? 'Trade License No' : 'ট্রেড লাইসেন্স নম্বর',
    other: en ? 'ID No' : 'পরিচয়পত্র নম্বর',
  };
  const saveBusinessProfile = () => {
    const profile: BusinessProfile = {
      company: current.company, address: current.address, phone: current.phone, website: current.website,
      email: current.email, trn: current.trn, locationUrl: current.locationUrl, logo: current.logo,
    };
    try {
      window.localStorage.setItem(businessProfileStorageKey(), JSON.stringify(profile));
      setBusinessProfile(profile);
      setEditingProfile(false);
      toast.success(en ? 'Business profile saved on this device.' : 'এই ডিভাইসে ব্যবসার প্রোফাইল সংরক্ষিত হয়েছে।');
    } catch {
      toast.error(en ? 'Could not save the business profile.' : 'ব্যবসার প্রোফাইল সংরক্ষণ করা যায়নি।');
    }
  };
  const cancelProfileEdit = () => {
    if (businessProfile) setInvoiceData((data) => ({ ...data, ...businessProfile }));
    setEditingProfile(false);
  };
  const handleLogoUpload = async (file?: File) => {
    if (!file) return;
    try {
      set('logo', await resizeLogoFile(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (en ? 'Could not process logo.' : 'লোগো প্রসেস করা যায়নি।'));
    }
  };
  const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-[#d9e1ed] bg-white px-3.5 text-[14px] font-medium text-[#192c49] outline-none transition focus:border-[#31578f] focus:ring-4 focus:ring-[#31578f]/10 placeholder:text-[#9aa8ba]';
  const field = (key: keyof InvoiceData, label: string, type = 'text') => (
    <label className="block min-w-0 text-[12px] font-semibold tracking-[.01em] text-[#55657b]" key={key}>
      {label}
      <input data-testid={`input-invoice-${key}`} type={type} value={current[key] as string} onChange={(event) => set(key, event.target.value)}
        className={`${inputClass} ${type === 'date' ? 'text-[13px]' : ''}`} />
    </label>
  );
  const itemAmount = (value: string) => Number(value) || 0;
  const filename = `Invoice_${current.number.replace(/[^a-zA-Z0-9_-]/g, '_') || 'download'}.pdf`;
  const persistHistory = (generated = false): boolean => {
    if (!current.customer.trim()) {
      toast.error(en ? 'Enter the customer name before saving this invoice.' : 'ইনভয়েস সংরক্ষণের আগে গ্রাহকের নাম লিখুন।');
      return false;
    }
    saveInvoiceHistory({ type: 'Business', number: current.number, date: current.date, customerName: current.customer, customerPhone: current.customerPhone, total: totals.total, currency: current.currency, itemCount: lines.length, payload: { invoiceData: current, lines } });
    toast.success(generated
      ? (en ? 'Invoice Generated Successfully!' : 'ইনভয়েস সফলভাবে তৈরি হয়েছে!')
      : (en ? 'Invoice saved to history.' : 'ইনভয়েস ইতিহাসে সংরক্ষণ হয়েছে।'));
    return true;
  };
  const shareUrl = () => {
    const url = new URL(window.location.href);
    url.hash = `invoice=${encodeInvoiceForLink({ invoiceData: current, lines })}`;
    return url.toString();
  };
  const copyInvoiceLink = async () => {
    const link = shareUrl();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('Clipboard access is unavailable.');
    }
    toast.success(labels.shared);
  };
  async function createPdf() {
    setPdfMode(true);
    let restoreFit = () => {};
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      const element = printRef.current;
      if (!element?.isConnected) throw new Error('Invoice preview is not ready.');
      await new Promise<void>((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
        } else window.setTimeout(resolve, 100);
      });
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(Array.from(element.querySelectorAll('img')).map((image) =>
        image.decode().catch(() => undefined),
      ));
      const content = pdfContentRef.current;
      if (!content) throw new Error('Invoice content is not available.');
      restoreFit = fitA4Content(element, content);
      normalizePdfColors(document, 'printable-invoice');
      const worker = html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 794,
          backgroundColor: '#ffffff',
          onclone: (clonedDocument: Document) => normalizePdfColors(clonedDocument, 'printable-invoice'),
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(element);
      const blob = await worker.outputPdf('blob') as Blob;
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('PDF renderer returned an empty file.');
      return blob;
    } finally {
      restoreFit();
      setPdfMode(false);
    }
  }
  async function printInvoiceFallback() {
    if (typeof window.print !== 'function') throw new Error('This WebView does not provide a print dialog.');
    setPdfMode(true);
    await new Promise<void>((resolve) => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      } else window.setTimeout(resolve, 100);
    });
    const root = printRef.current;
    const host = root?.closest('section');
    const content = pdfContentRef.current;
    if (!root?.isConnected || !host || !content) {
      setPdfMode(false);
      throw new Error('Invoice preview is not available for printing.');
    }
    const restoreFit = fitA4Content(root, content);
    document.body.classList.add('business-invoice-print-fallback');
    const ancestors: HTMLElement[] = [];
    for (let parent = host.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      parent.classList.add('business-invoice-print-ancestor');
      ancestors.push(parent);
    }
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      restoreFit();
      document.body.classList.remove('business-invoice-print-fallback');
      for (const ancestor of ancestors) ancestor.classList.remove('business-invoice-print-ancestor');
      setPdfMode(false);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      window.print();
      window.setTimeout(cleanup, 10_000);
    } catch (error) {
      cleanup();
      throw error;
    }
  }
  async function shareInvoice() {
    setBusy(true);
    let generatedBlob: Blob | null = null;
    let link = '';
    try {
      const text = `${labels.title} ${current.number}\n${labels.customer}: ${current.customer || '—'}\n${labels.total}: ${money(totals.total, current.currency, lang)}`;
      generatedBlob = await createPdf();
      link = shareUrl();
      const shareText = `${text}\n${link}`;
      const native = await shareGeneratedFileWithNative(generatedBlob, { fileName: filename, mimeType: 'application/pdf', title: `${labels.title} ${current.number}`, shareText });
      if (native) return;
      const file = new File([generatedBlob], filename, { type: 'application/pdf' });
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${labels.title} ${current.number}`, text, url: link });
      } else if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${labels.title} ${current.number}`, text, url: link });
      } else {
        await copyInvoiceLink();
      }
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      console.error('Business invoice sharing failed:', error);
      try {
        if (!link) link = shareUrl();
        await copyInvoiceLink();
      } catch (copyError) {
        console.error('Business invoice link fallback failed:', copyError);
        if (generatedBlob) {
          try {
            const url = URL.createObjectURL(generatedBlob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast.info(en ? 'Could not share. The invoice PDF was downloaded instead.' : 'শেয়ার করা যায়নি। ইনভয়েস PDF ডাউনলোড করা হয়েছে।');
          } catch (downloadError) {
            console.error('Business invoice download fallback failed:', downloadError);
            toast.error(labels.shareError);
          }
        } else {
          try {
            await printInvoiceFallback();
            toast.info(en ? 'The PDF could not be shared. Choose “Save as PDF” in the print dialog.' : 'PDF শেয়ার করা যায়নি। প্রিন্ট ডায়ালগে “Save as PDF” বেছে নিন।');
          } catch (printError) {
            console.error('Business invoice print fallback failed:', printError);
            toast.error(labels.shareError);
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function downloadPdf() {
    setBusy(true);
    try {
      if (!persistHistory()) return;
      const blob = await createPdf();
      const native = await saveGeneratedFileWithNative(blob, {
        fileName: filename,
        mimeType: 'application/pdf',
        title: `${labels.title} ${current.number}`,
      });
      if (native) {
        if (native.saved) toast.success(en ? 'Invoice PDF saved.' : 'ইনভয়েস PDF সংরক্ষণ হয়েছে।');
        else if (native.shareSheet) toast.info(en ? 'Choose “Save to Files” in the sharing options.' : 'শেয়ার অপশন থেকে “Save to Files” বেছে নিন।');
        else if (native.cancelled) toast.info(en ? 'Folder selection was cancelled; the PDF was not saved.' : 'ফোল্ডার নির্বাচন বাতিল হয়েছে; PDF সংরক্ষণ হয়নি।');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Invoice PDF generation failed:', error);
      try {
        await printInvoiceFallback();
        toast.info(en ? 'PDF rendering failed. Choose “Save as PDF” in the print dialog.' : 'PDF তৈরি হয়নি। প্রিন্ট ডায়ালগে “Save as PDF” বেছে নিন।');
      } catch (printError) {
        console.error('Business invoice print fallback failed:', printError);
        const detail = printError instanceof Error ? ` ${printError.message}` : '';
        toast.error(`${labels.downloadError}${detail}`);
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (autoAction === 'download') void downloadPdf();
    else if (autoAction === 'share') void shareInvoice();
  // A history action is consumed once when its invoice editor mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sectionHeading = (Icon: typeof Building2, eyebrow: string, title: string) => (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf3fb] text-[#31578f]"><Icon className="h-[18px] w-[18px]" /></span>
      <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#8291a6]">{eyebrow}</p><h3 className="text-[14px] font-bold text-[#1b2f4d]">{title}</h3></div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f3f6fa] text-[#1d2e47]">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#e1e7ef] bg-white px-3 py-2.5 sm:px-4 md:gap-3 md:px-6 md:py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-10 w-10 items-center justify-center rounded-xl bg-[#eaf0f8] text-[#284c80] md:flex"><ReceiptText className="h-5 w-5" /></span>
          <div className="min-w-0"><h2 className="truncate text-base font-bold tracking-tight text-[#1b2f4d] md:text-[17px]">{labels.title}</h2><p className="hidden text-xs text-[#77869a] md:block">{labels.subtitle}</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {readOnlyPreview && <button type="button" data-testid="button-invoice-preview-edit" onClick={() => setReadOnlyPreview(false)} className="inline-flex min-h-10 items-center rounded-xl border border-[#d8e1ed] bg-white px-3 text-[13px] font-bold text-[#365273]">{en ? 'Edit' : 'সম্পাদনা'}</button>}
          <button type="button" data-testid="button-invoice-share" aria-label={labels.share} disabled={busy} onClick={shareInvoice} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d8e1ed] bg-white px-2.5 text-[13px] font-bold text-[#365273] transition hover:bg-[#f5f8fc] disabled:opacity-60 sm:px-3">
            <Share2 className="h-4 w-4" /><span className="hidden md:inline">{labels.share}</span>
          </button>
          <button type="button" data-testid="button-invoice-download" aria-label={busy ? (en ? 'Preparing invoice PDF' : 'ইনভয়েস PDF তৈরি হচ্ছে') : labels.download} disabled={busy} onClick={downloadPdf} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#244878] px-2.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#1c3b66] disabled:opacity-60 sm:px-3.5 md:px-4">
            <Download className="h-4 w-4" /><span className="hidden md:inline">{busy ? (en ? 'Preparing…' : 'তৈরি হচ্ছে…') : labels.download}</span>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <section className={`${readOnlyPreview ? 'hidden' : ''} h-full min-h-0 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-5`}>
          <div className="w-full space-y-4 pb-8">
            <div className="mb-5 flex items-center justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#8291a6]">{labels.setup}</p><p className="mt-1 text-sm text-[#697b92]">{en ? 'Fill in what you know. You can edit everything.' : 'প্রয়োজনীয় তথ্য দিন, সবকিছুই পরে সম্পাদনা করা যাবে।'}</p></div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8e2ee] bg-white text-[#45668f]"><FileText className="h-4 w-4" /></span>
            </div>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-3 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
              {sectionHeading(UserRound, en ? '02 · Customer' : '০২ · গ্রাহক', labels.billTo)}
              <div data-testid="grid-invoice-customer-fields" className="grid gap-x-3.5 gap-y-3 md:grid-cols-2">
                {field('customer', labels.customer)}{field('customerPhone', labels.customerPhone)}
                <label className="block min-w-0 text-[12px] font-semibold text-[#55657b]">{labels.customerIdType}
                  <select data-testid="select-invoice-customer-id-type" value={current.customerIdType} onChange={(event) => set('customerIdType', event.target.value as CustomerDocumentType)} className={inputClass}>
                    {customerDocumentTypes.map((type) => <option key={type} value={type}>{customerDocumentLabels[type]}</option>)}
                  </select>
                </label>
                {field('customerIdNumber', labels.customerIdNumber)}
                <label className="col-span-full block min-w-0 text-[12px] font-semibold text-[#55657b]">{labels.customerAddress}
                  <textarea data-testid="input-invoice-customerAddress" value={current.customerAddress} onChange={(event) => set('customerAddress', event.target.value)} rows={3} className={`${inputClass} resize-y py-3`} />
                </label>
              </div>
            </section>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-3 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
              {sectionHeading(CalendarDays, en ? '03 · Reference' : '০৩ · তারিখ ও নম্বর', en ? 'Invoice information' : 'ইনভয়েসের তথ্য')}
              <div data-testid="grid-invoice-reference-fields" className="grid gap-x-3.5 gap-y-3 md:grid-cols-2">
                {field('date', labels.date, 'date')}
                {field('paymentTerms', labels.paymentTerms)}
                {field('metalRate', `${labels.metalRate} (${currencySymbol(current.currency, locale)} ${current.currency})`)}
                {field('placeOfSupply', labels.placeOfSupply)}
                <div className="min-w-0 text-[12px] font-semibold text-[#55657b]">
                  <span>{labels.currency}</span>
                  <Popover open={currencyPopoverOpen} onOpenChange={setCurrencyPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" data-testid="select-invoice-currency" aria-expanded={currencyPopoverOpen} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
                        <span className="truncate">{selectedCurrency ? `${selectedCurrency.symbol} ${selectedCurrency.code} - ${selectedCurrency.name}` : current.currency}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput data-testid="input-invoice-currency-search" placeholder={labels.currencySearch} />
                        <CommandList>
                          <CommandEmpty>{labels.currencyNoResults}</CommandEmpty>
                          {currencyOptions.map((option) => (
                            <CommandItem key={option.code} value={option.search} data-testid={`currency-option-${option.code}`} onSelect={() => { set('currency', option.code); setCurrencyPopoverOpen(false); }}>
                              <Check className={`h-4 w-4 ${current.currency === option.code ? 'opacity-100' : 'opacity-0'}`} />
                              <span className="min-w-0 truncate">{option.symbol} {option.code} - {option.name}</span>
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                {field('taxRate', labels.tax, 'number')}
              </div>
            </section>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-3 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                {sectionHeading(ReceiptText, en ? '04 · Items' : '০৪ · পণ্য', en ? 'What are you billing?' : 'কোন পণ্যের বিল?')}
                <span className="mb-4 rounded-full bg-[#f0f4f9] px-2.5 py-1 text-[11px] font-bold text-[#6a7c94]">{lines.length} {labels.item}</span>
              </div>
              <div className="space-y-3">
                {lines.map((line, index) => (
                  <div key={line.id} className="rounded-xl border border-[#e4e9f0] bg-[#fafbfd] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[.1em] text-[#8a98aa]">{labels.item} {index + 1}</span>
                      <button type="button" data-testid={`button-invoice-remove-${line.id}`} aria-label={labels.remove} disabled={lines.length === 1} onClick={() => setLines((items) => items.filter((item) => item.id !== line.id))} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8b5b63] transition hover:bg-[#f9ecee] disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid grid-cols-1 items-end gap-2.5 md:grid-cols-[minmax(0,1fr)_110px]">
                      <label className="min-w-0 text-[12px] font-semibold text-[#55657b]">{labels.description}
                        <input data-testid={`input-invoice-item-description-${line.id}`} value={line.description} onChange={(e) => setLines((items) => items.map((item) => item.id === line.id ? { ...item, description: e.target.value } : item))} placeholder={en ? 'e.g. Rice, 5 kg' : 'যেমন: চাল, ৫ কেজি'} className={inputClass} />
                      </label>
                      <label className="text-[12px] font-semibold text-[#55657b]">{labels.amount}
                        <input data-testid={`input-invoice-item-amount-${line.id}`} type="number" min="0" step="0.01" value={line.amount} onChange={(e) => setLines((items) => items.map((item) => item.id === line.id ? { ...item, amount: e.target.value } : item))} placeholder="0.00" className={`${inputClass} text-right tabular-nums`} />
                      </label>
                    </div>
                    <label className="mt-3 flex min-h-9 cursor-pointer items-center gap-2 text-[12px] font-medium text-[#596b83]">
                      <input data-testid={`checkbox-invoice-item-taxed-${line.id}`} type="checkbox" checked={line.taxed} onChange={(e) => setLines((items) => items.map((item) => item.id === line.id ? { ...item, taxed: e.target.checked } : item))} className="h-4 w-4 rounded border-[#bac8d9] accent-[#31578f]" />
                      {labels.taxed}
                    </label>
                  </div>
                ))}
              </div>
              <button type="button" data-testid="button-invoice-add-item" onClick={() => { setLines((items) => [...items, { id: nextId, description: '', amount: '', taxed: false }]); setNextId((id) => id + 1); }} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-dashed border-[#a9bad0] px-3.5 text-[13px] font-bold text-[#31578f] transition hover:border-[#31578f] hover:bg-[#f4f7fb]"><Plus className="h-4 w-4" />{labels.add}</button>
              <p className="mt-2 text-[11px] leading-relaxed text-[#8391a3]">{labels.taxHint}</p>
            </section>
            <label className="block rounded-2xl border border-[#e2e8f0] bg-white p-3 text-[12px] font-semibold text-[#55657b] shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">{labels.comments}
              <textarea data-testid="textarea-invoice-comments" value={current.comments} onChange={(e) => set('comments', e.target.value)} rows={3} placeholder={en ? 'Payment details, thanks, or other notes…' : 'পেমেন্টের তথ্য বা অন্য কোনো নোট…'} className={`${inputClass} min-h-[92px] resize-y py-3`} />
            </label>
            <button type="button" aria-label={en ? 'Generate Invoice' : 'ইনভয়েস তৈরি করুন'} data-testid="button-invoice-save-history" onClick={() => { if (persistHistory(true)) onGenerated?.(); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1B3A6B] px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#17315a] active:scale-[.99]">
              <FileText className="h-5 w-5" />{en ? 'Generate Invoice' : 'ইনভয়েস তৈরি করুন'}
            </button>
          </div>
        </section>
        {(readOnlyPreview || pdfMode) && <section className={`business-invoice-print-host ${readOnlyPreview ? 'h-full min-h-0 overflow-auto bg-[#e9eef5] px-3 py-5 md:px-6 md:py-7' : 'fixed left-[-10000px] top-0 z-[-1] block w-[794px]'}`}>
          <div className="mx-auto mb-3 flex max-w-[816px] items-center justify-between px-1 text-[10px] font-bold uppercase tracking-[.15em] text-[#79899e]">
            <span>{en ? 'Invoice preview' : 'ইনভয়েস প্রিভিউ'}</span><span className="rounded-full bg-white px-2.5 py-1 text-[#526783]">{current.number}</span>
          </div>
          <div
            id="printable-invoice"
            ref={printRef}
            style={pdfMode ? {
              width: '210mm',
              minWidth: '210mm',
              maxWidth: '210mm',
              height: '296mm',
              minHeight: '296mm',
              padding: '32px',
              boxSizing: 'border-box',
              overflow: 'hidden',
              wordBreak: 'break-word',
            } : undefined}
            className="invoice-print relative mx-auto min-h-[800px] w-full max-w-[794px] overflow-hidden border border-[#dce2ea] bg-white px-6 py-7 text-[12px] text-[#233752] shadow-[0_14px_42px_rgba(35,55,82,.12)] sm:px-10 sm:py-10"
          >
            <div ref={pdfContentRef} className="invoice-print-content">
            <div className="absolute inset-x-0 top-0 h-[7px] bg-[#33578a]" />
            <div className={`grid gap-4 border-b border-[#d7e0eb] pb-6 pt-1 ${pdfMode ? 'grid-cols-[1.1fr_.9fr_1.1fr]' : 'grid-cols-1 sm:grid-cols-3'}`} style={{ wordBreak: 'break-word' }}>
              <div className="min-w-0">
                {current.logo && <img src={current.logo} crossOrigin="anonymous" alt="" className="mb-3 h-20 w-[180px] rounded-lg object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <h1 className="break-words text-xl font-bold text-[#203a5c]">{current.company || labels.company}</h1>
                <p className="mt-2 whitespace-pre-line text-[10px] leading-[1.6] text-[#66778e]">{[current.address, current.phone, current.email, current.trn].filter(Boolean).join('\n')}</p>
              </div>
              <div className="flex min-w-0 flex-col items-center text-center">
                <p className="mb-1 font-serif text-[11px] text-[#b99b45]">بسم الله الرحمن الرحيم</p>
                <div className="w-full rounded-lg bg-[#1B3A6B] px-2 py-2.5 text-center text-[13px] font-bold tracking-[.14em] text-white">
                  <span className="text-[#d6b85f]">◆</span> {labels.taxInvoice} <span className="text-[#d6b85f]">◆</span>
                </div>
                {current.locationUrl && <QRCodeSVG value={current.locationUrl} size={88} level="M" includeMargin className="mt-2 border border-slate-200 bg-white p-1" />}
                <p className="mt-1 text-[9px] text-slate-500">{current.locationUrl ? labels.scanToFind : ''}</p>
              </div>
              <div className="min-w-0 text-[10px]">
                <p className="mb-2 text-right text-[10px] font-bold tracking-[.14em] text-[#1B3A6B]">{labels.partyCopy}</p>
                {([
                  [labels.number, current.number],
                  [labels.date, dateLabel(current.date, lang)],
                  [labels.paymentTerms, current.paymentTerms],
                  [`${labels.metalRate} (${currencySymbol(current.currency, locale)} ${current.currency})`, current.metalRate || ''],
                  [labels.placeOfSupply, current.placeOfSupply],
                ] as const).map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-2 py-1">
                    <span className="font-semibold text-[#304866]">{label}:</span>
                    <span className="min-w-0 break-words border-b border-slate-300 px-1 pb-0.5 text-right text-[#304866]">{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4">
              <div className="border-l-[3px] border-[#8da4c3] pl-3">
                <p className="mb-2 bg-[#1B3A6B] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-white">{labels.billTo}</p>
                <p className="font-bold text-[#263e60]">{current.customer || '—'}</p>
                <div className="mt-1 space-y-0.5 break-words text-[10px] leading-[1.7] text-[#6e7e93]">
                  {current.customerPhone && <p>{labels.customerPhoneLabel}: {current.customerPhone}</p>}
                  {current.customerIdNumber.trim() && <p>{customerDocumentOutputLabel[current.customerIdType]}: {current.customerIdNumber}</p>}
                  {current.customerAddress && <p className="whitespace-pre-line">{labels.customerAddressLabel}: {current.customerAddress}</p>}
                  {!current.customerPhone && !current.customerIdNumber.trim() && !current.customerAddress && <p>—</p>}
                </div>
              </div>
            </div>
            <table className="mt-7 w-full table-fixed border-collapse text-[10px]" style={{ wordBreak: 'break-word' }}>
              <thead><tr className="bg-[#1B3A6B] text-white">
                <th className="break-words px-3 py-2.5 text-left font-bold uppercase tracking-[.09em]">{labels.description}</th>
                <th className="w-[74px] px-2 py-2.5 text-center font-bold uppercase tracking-[.05em]">{labels.taxed}</th>
                <th className="w-[130px] px-3 py-2.5 text-right font-bold uppercase tracking-[.09em]">{labels.amount}</th>
              </tr></thead>
              <tbody>{lines.map((item, index) => <tr key={item.id} className={`border-b border-[#e3e8ef] ${index % 2 ? 'bg-[#fbfcfd]' : ''}`}>
                <td className="break-words px-3 py-3 font-medium text-[#344b68]">{item.description || '—'}</td>
                <td className="px-2 py-3 text-center text-[#476b9d]">{item.taxed ? <Check className="mx-auto h-3.5 w-3.5" /> : '—'}</td>
                <td className="break-words px-3 py-3 pr-5 text-right tabular-nums text-[#344b68]">{money(itemAmount(item.amount), current.currency, lang)}</td>
              </tr>)}</tbody>
            </table>
            <div className="ml-auto mt-5 w-full max-w-[260px] space-y-2 text-[10px]">
              <div className="flex justify-between text-[#718198]"><span>{labels.subtotal}</span><span className="tabular-nums text-[#3d526e]">{money(totals.subtotal, current.currency, lang)}</span></div>
              <div className="flex justify-between text-[#718198]"><span>{labels.taxable}</span><span className="tabular-nums text-[#3d526e]">{money(totals.taxable, current.currency, lang)}</span></div>
              <div className="flex justify-between text-[#718198]"><span>{labels.taxDue} ({Number(current.taxRate) || 0}%)</span><span className="tabular-nums text-[#3d526e]">{money(totals.tax, current.currency, lang)}</span></div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t-2 border-[#33578a] pt-3 pr-5 text-[12px] font-bold text-[#263f62]" style={{ wordBreak: 'break-word' }}><span>{labels.total}</span><span data-testid="text-invoice-total" className="min-w-0 text-right text-[16px] tabular-nums">{money(totals.total, current.currency, lang)}</span></div>
            </div>
            <div className="mt-7 border border-[#dbe3ed]">
              <div className="border-b border-[#dbe3ed] bg-[#f5f7fa] px-3 py-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#536a89]">{labels.commentsBlock}</div>
              <p className="min-h-14 whitespace-pre-line px-3 py-3 text-[10px] leading-relaxed text-[#62738a]">{current.comments || '—'}</p>
            </div>
            <div className="mt-8 flex items-center justify-between border-t border-[#e1e6ed] pt-4">
              <p className="text-[10px] font-semibold italic text-[#526783]">{labels.thank}</p>
              <span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#a0acbb]">BanglaKhata</span>
            </div>
            </div>
          </div>
          {!current.company && <p data-testid="text-invoice-preview-hint" className="mx-auto mt-3 max-w-[816px] text-center text-[11px] text-[#75869b]">{labels.empty}</p>}
        </section>}
      </div>
    </div>
  );
}
