import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CalendarDays, Check, ChevronDown, Download, FileText, Plus, ReceiptText, Share2, Trash2, UserRound } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '@/lib/i18n';
import { shareGeneratedFileWithNative } from '@/lib/native-file-export';
import { saveInvoiceHistory, type InvoiceHistoryAction, type InvoiceHistoryRecord } from './invoice-history';

type GoldLine = { id: number; description: string; gross: string; grossUnit: 'g' | 'vori'; purity: string; makingRate: string; makingAmount: string };
type GoldData = {
  company: string; address: string; phone: string; email: string; trn: string; logo: string; locationUrl: string;
  customerName: string; customerPhone: string; customerEmail: string; customerId: string; customerAddress: string;
  nationality: string; country: string; number: string; date: string; currency: string; metalRate: string;
  place: string; payment: string; pending: boolean; notes: string; discount: string; vatRate: string;
};
type CurrencyOption = { code: string; name: string; symbol: string };

const BUSINESS_KEY = 'banglakhata_business_invoice_profile_v1';
const VORI_TO_GRAMS = 11.664;
const safeNumber = (value: string | number) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const round3 = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const businessId = () => typeof window === 'undefined' ? 'default' : (localStorage.getItem('selected_business_id') || 'default');
const profileKey = () => `${BUSINESS_KEY}:${businessId()}`;
const stampKey = () => `banglakhata_gold_invoice_stamp_v1:${businessId()}`;
const invoiceNumber = () => {
  try {
    const day = today().replaceAll('-', '');
    const key = `banglakhata_gold_invoice_sequence:${businessId()}:${day}`;
    const next = Number(localStorage.getItem(key) || 0) + 1;
    localStorage.setItem(key, String(next));
    return `GOLD-${day}-${next}`;
  } catch {
    return `GOLD-${today().replaceAll('-', '')}-${Date.now().toString().slice(-4)}`;
  }
};
function decodeGoldLink(): { data: GoldData; lines: GoldLine[] } | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.hash.match(/^#goldinvoice=([A-Za-z0-9_-]+)$/);
  if (!match || match[1].length > 60000) return null;
  try {
    const token = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(token + '='.repeat((4 - token.length % 4) % 4)), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { data?: GoldData; lines?: GoldLine[] };
    if (!parsed.data || !Array.isArray(parsed.lines) || typeof parsed.data.number !== 'string' || typeof parsed.data.currency !== 'string') return null;
    return { data: parsed.data, lines: parsed.lines.slice(0, 100).map((line, index) => ({ ...line, id: index + 1 })) };
  } catch { return null; }
}
const localeFor = (lang: string) => lang === 'en' ? 'en-US' : 'bn-BD';
const currencyOptions = (): CurrencyOption[] => {
  const fallback = 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CZK DJF DKK DOP DZD EGP ETB EUR FJD GBP GEL GHS HKD HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KRW KWD KZT LKR MAD MMK MNT MXN MYR NGN NOK NPR NZD OMR PEN PHP PKR PLN QAR RON RUB SAR SEK SGD THB TRY TWD TZS UAH UGX USD UYU VND XAF XOF ZAR ZMW'.split(' ');
  let codes = fallback;
  try { codes = [...new Set([...Intl.supportedValuesOf('currency'), ...fallback])].sort(); } catch {}
  return codes.map((code) => {
    let name = code;
    let symbol = code;
    try { name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code; } catch {}
    try { symbol = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(1).find((part) => part.type === 'currency')?.value || code; } catch {}
    const overrides: Record<string, string> = { AED: 'د.إ', BDT: '৳', INR: '₹', SAR: '﷼', USD: '$', EUR: '€', GBP: '£', QAR: 'ر.ق', KWD: 'د.ك', OMR: 'ر.ع.' };
    return { code, name, symbol: overrides[code] || symbol };
  });
};
const currencyCountryAliases: Record<string, string[]> = {
  AED: ['UAE', 'United Arab Emirates', 'Dubai', 'Abu Dhabi'], BDT: ['Bangladesh'], USD: ['United States', 'USA'],
  SAR: ['Saudi Arabia'], INR: ['India'], QAR: ['Qatar'], KWD: ['Kuwait'], OMR: ['Oman'],
  GBP: ['United Kingdom', 'UK'], EUR: ['Europe', 'Eurozone'], PKR: ['Pakistan'], LKR: ['Sri Lanka'],
  NPR: ['Nepal'], MYR: ['Malaysia'], SGD: ['Singapore'], JPY: ['Japan'], CAD: ['Canada'], AUD: ['Australia'],
};

function numberToWords(input: number, lang: string): string {
  const value = Math.max(0, Math.round(Number.isFinite(input) ? input : 0));
  if (lang !== 'en') {
    return `মোট ${value.toLocaleString('bn-BD')} টাকা মাত্র`;
  }
  if (!value) return 'Zero';
  const small = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const chunk = (n: number): string => {
    if (n < 20) return small[n];
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${small[n % 10]}` : ''}`;
    return `${small[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${chunk(n % 100)}` : ''}`;
  };
  const parts: string[] = [];
  for (const [size, name] of [[1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1000, 'Thousand'], [1, '']] as [number, string][]) {
    const count = Math.floor(input / size);
    if (count) { parts.push(`${chunk(count)}${name ? ` ${name}` : ''}`); input %= size; }
  }
  return parts.join(' ');
}

function oklchToRgb(value: string): string | null {
  const match = value.match(/oklch\(\s*([+-]?(?:\d*\.)?\d+%?)\s+([+-]?(?:\d*\.)?\d+%?)\s+([+-]?(?:\d*\.)?\d+(?:deg|rad|turn)?)\s*(?:\/\s*([+-]?(?:\d*\.)?\d+%?))?\s*\)/i);
  if (!match) return null;

  const lightness = parseFloat(match[1]) / (match[1].endsWith('%') ? 100 : 1);
  const chroma = parseFloat(match[2]) * (match[2].endsWith('%') ? 0.004 : 1);
  const hueText = match[3].toLowerCase();
  const hueValue = parseFloat(hueText);
  const hue = hueText.endsWith('turn') ? hueValue * 2 * Math.PI
    : hueText.endsWith('rad') ? hueValue
      : hueValue * Math.PI / 180;
  const alpha = match[4] ? parseFloat(match[4]) / (match[4].endsWith('%') ? 100 : 1) : 1;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => {
    const linear = Math.max(0, Math.min(1, channel));
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  });
  return alpha < 1 ? `rgba(${channels.join(', ')}, ${Math.max(0, Math.min(1, alpha))})` : `rgb(${channels.join(', ')})`;
}

function normalizePdfColors(clonedDocument: Document) {
  const root = clonedDocument.getElementById('printable-gold-invoice');
  const view = clonedDocument.defaultView;
  if (!root || !view) throw new Error('Invoice element was not present in the PDF capture clone');

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*'))];
  for (const element of elements) {
    const styles = view.getComputedStyle(element);
    for (let index = 0; index < styles.length; index += 1) {
      const property = styles[index];
      const value = styles.getPropertyValue(property);
      if (!value.includes('oklch(')) continue;
      const normalized = value.replace(/oklch\([^)]*\)/gi, (color) => oklchToRgb(color) || color);
      element.style.setProperty(property, normalized, 'important');
    }
  }
}

export function GoldInvoice({ historyRecord, autoAction = 'open', viewOnly = false, onGenerated }: { historyRecord?: InvoiceHistoryRecord; autoAction?: InvoiceHistoryAction; viewOnly?: boolean; onGenerated?: () => void }) {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const printRef = useRef<HTMLDivElement>(null);
  const previewShellRef = useRef<HTMLDivElement>(null);
  const shared = useMemo(decodeGoldLink, []);
  const [readOnlyPreview, setReadOnlyPreview] = useState(viewOnly);
  const [pdfMode, setPdfMode] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [stamp, setStamp] = useState(() => { try { return localStorage.getItem(stampKey()) || ''; } catch { return ''; } });
  const restored = historyRecord?.type === 'Gold' ? historyRecord.payload as { data?: GoldData; lines?: GoldLine[] } : undefined;
  const [data, setData] = useState<GoldData>(() => {
     if (restored?.data) return { ...restored.data, vatRate: restored.data.vatRate || '5' };
     if (shared?.data) return { ...shared.data, vatRate: shared.data.vatRate || '5' };
    let profile: Record<string, string> = {};
    try { profile = JSON.parse(localStorage.getItem(profileKey()) || '{}') as Record<string, string>; } catch {}
    return {
      company: profile.company || '', address: profile.address || '', phone: profile.phone || '', email: profile.email || '',
      trn: profile.trn || '', logo: profile.logo || '', locationUrl: profile.locationUrl || '',
      customerName: '', customerPhone: '', customerEmail: '', customerId: '', customerAddress: '', nationality: '', country: '',
       number: invoiceNumber(), date: today(), currency: 'AED', metalRate: '', place: '', payment: 'Cash Payment', pending: false, notes: '', discount: '0', vatRate: '5',
    };
  });
  const [lines, setLines] = useState<GoldLine[]>(restored?.lines ?? shared?.lines ?? [{ id: 1, description: '', gross: '', grossUnit: 'g', purity: '0.916', makingRate: '', makingAmount: '' }]);
  const [nextId, setNextId] = useState(2);
  useEffect(() => {
    setReadOnlyPreview(viewOnly);
  }, [viewOnly]);
  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return;
    const update = () => setPreviewScale(Math.min(1, shell.clientWidth / 794));
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    update();
    return () => observer.disconnect();
  }, []);
  const currencies = useMemo(currencyOptions, []);
  const chosenCurrency = currencies.find((item) => item.code === data.currency) || { code: data.currency, name: data.currency, symbol: data.currency };
  const filteredCurrencies = currencies.filter((option) =>
    `${option.code} ${option.name} ${option.symbol} ${(currencyCountryAliases[option.code] || []).join(' ')}`
      .toLocaleLowerCase().includes(currencySearch.toLocaleLowerCase()),
  );
  const set = (key: keyof GoldData, value: string | boolean) => setData((current) => ({ ...current, [key]: value }));
  const updateLine = (id: number, key: keyof GoldLine, value: string) => {
    const sanitized = ['gross', 'purity', 'makingRate', 'makingAmount'].includes(key) ? value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : value;
    setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: sanitized } : line));
  };
  const calculations = useMemo(() => {
    const values = lines.map((line) => {
      const enteredGross = safeNumber(line.gross);
      const gross = enteredGross * (line.grossUnit === 'vori' ? VORI_TO_GRAMS : 1);
      const purity = Math.min(1, safeNumber(line.purity));
      const pure = round3(gross * purity);
      const makingRate = safeNumber(line.makingRate);
      const makingAmount = line.makingAmount.trim() ? safeNumber(line.makingAmount) : gross * makingRate;
      const goldValue = gross * safeNumber(data.metalRate);
      return { ...line, grossValue: gross, purityValue: purity, pure, makingRateValue: makingRate, makingAmountValue: makingAmount, goldValue, total: goldValue + makingAmount };
    });
    const gross = values.reduce((sum, line) => sum + line.grossValue, 0);
    const pure = values.reduce((sum, line) => sum + line.pure, 0);
    const gold = values.reduce((sum, line) => sum + line.goldValue, 0);
    const making = values.reduce((sum, line) => sum + line.makingAmountValue, 0);
    const beforeVat = gold + making;
    const vat = beforeVat * (safeNumber(data.vatRate || '5') / 100);
    const discount = safeNumber(data.discount);
    return { values, gross, pure: round3(pure), gold, making, beforeVat, vat, discount, total: Math.max(0, beforeVat + vat - discount) };
  }, [lines, data.metalRate, data.discount, data.vatRate]);

  const labels = en ? {
    title: 'Gold invoice', subtitle: 'Precise gold valuation. A formal customer copy, ready to print.',
    customer: 'Customer details', customerName: 'Name', phone: 'Phone', email: 'Email', id: 'Passport / ID No.', address: 'Address', nationality: 'Nationality', country: 'Country',
    items: 'Gold items', desc: 'Stock description', gross: 'Gross weight', grams: 'Grams', vori: 'Vori / Tola', purity: 'Purity', pure: 'Pure grams', makingRate: 'Making rate / g', makingAmount: 'Making amount', total: 'Line total',
    add: 'Add gold item', remove: 'Remove item', payment: 'Payment & summary', rate: 'Metal rate / gram', currency: 'Currency', date: 'Invoice date', place: 'Place of supply', method: 'Payment method',
    pending: 'Payment pending', pendingHint: 'Mark if payment is not fully received', notes: 'Notes', discount: 'Round-off discount', goldValue: 'Gold value', making: 'Making total', beforeVat: 'Before VAT', vat: 'VAT', vatRate: 'VAT rate (%)', incl: 'Total including VAT', grossTotal: 'Total gross weight', pureTotal: 'Total pure weight',
    download: 'Download PDF', share: 'Share', shop: 'Shop profile', saveProfile: 'Save shop profile', editProfile: 'Edit shop profile', profileSaved: 'Using saved shop profile',
    details: 'Invoice details', party: 'Buyer', invoiceNo: 'Invoice No.', terms: 'Payment terms', words: 'Amount in words', mode: 'Payment mode', thank: 'Thank you for your business.', taxInvoice: 'TAX INVOICE', partyCopy: 'PARTY COPY', seller: 'From your shop', empty: 'Add your shop and customer details to complete the invoice.',
    currencySearch: 'Search currency name, symbol or ISO code', noCurrency: 'No matching currencies', downloadError: 'Could not prepare the invoice PDF.', shareError: 'Could not share the invoice.', pendingShort: 'Pending', cash: 'Cash Payment', bank: 'Bank Transfer', card: 'Card Payment', mobilePay: 'Mobile Payment',
  } : {
    title: 'গোল্ড ইনভয়েস', subtitle: 'নির্ভুল স্বর্ণের মূল্যায়ন। প্রিন্টের জন্য প্রস্তুত আনুষ্ঠানিক কপি।',
    customer: 'গ্রাহকের তথ্য', customerName: 'নাম', phone: 'ফোন', email: 'ইমেইল', id: 'পাসপোর্ট / আইডি নম্বর', address: 'ঠিকানা', nationality: 'জাতীয়তা', country: 'দেশ',
    items: 'স্বর্ণের আইটেম', desc: 'স্টকের বিবরণ', gross: 'মোট ওজন', grams: 'গ্রাম', vori: 'ভরি / তোলা', purity: 'বিশুদ্ধতা', pure: 'বিশুদ্ধ ওজন (গ্রাম)', makingRate: 'মেকিং রেট / গ্রাম', makingAmount: 'মেকিং চার্জ', total: 'লাইনের মোট',
    add: 'স্বর্ণের আইটেম যোগ করুন', remove: 'আইটেম সরান', payment: 'পেমেন্ট ও সারাংশ', rate: 'ধাতুর মূল্য / গ্রাম', currency: 'মুদ্রা', date: 'ইনভয়েসের তারিখ', place: 'সরবরাহের স্থান', method: 'পেমেন্ট পদ্ধতি',
    pending: 'পেমেন্ট বাকি', pendingHint: 'সম্পূর্ণ টাকা না পেলে চালু করুন', notes: 'নোট', discount: 'রাউন্ড-অফ ছাড়', goldValue: 'স্বর্ণের মূল্য', making: 'মেকিং মোট', beforeVat: 'ভ্যাটের আগে', vat: 'ভ্যাট', vatRate: 'ভ্যাটের হার (%)', incl: 'ভ্যাটসহ মোট', grossTotal: 'মোট গ্রস ওজন', pureTotal: 'মোট বিশুদ্ধ ওজন',
    download: 'PDF ডাউনলোড', share: 'শেয়ার', shop: 'দোকানের প্রোফাইল', saveProfile: 'দোকানের প্রোফাইল সংরক্ষণ', editProfile: 'দোকানের প্রোফাইল সম্পাদনা', profileSaved: 'সংরক্ষিত দোকানের প্রোফাইল ব্যবহার হচ্ছে',
    details: 'ইনভয়েসের তথ্য', party: 'ক্রেতা', invoiceNo: 'ইনভয়েস নম্বর', terms: 'পেমেন্টের শর্ত', words: 'কথায় পরিমাণ', mode: 'পেমেন্ট মোড', thank: 'আপনার ব্যবসার জন্য ধন্যবাদ।', taxInvoice: 'ট্যাক্স ইনভয়েস', partyCopy: 'পার্টি কপি', seller: 'আপনার দোকান থেকে', empty: 'ইনভয়েস সম্পূর্ণ করতে দোকান ও গ্রাহকের তথ্য দিন।',
    currencySearch: 'মুদ্রার নাম, প্রতীক বা ISO কোড খুঁজুন', noCurrency: 'কোনো মুদ্রা মেলেনি', downloadError: 'ইনভয়েস PDF তৈরি করা যায়নি।', shareError: 'ইনভয়েস শেয়ার করা যায়নি।', pendingShort: 'বাকি', cash: 'নগদ পেমেন্ট', bank: 'ব্যাংক ট্রান্সফার', card: 'কার্ড পেমেন্ট', mobilePay: 'মোবাইল পেমেন্ট',
  };
  const vatSummaryLabel = `${labels.vat} (${data.vatRate || '5'}%)`;
  const locale = localeFor(lang);
  const money = (value: number) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    try {
      const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeValue);
      return `${chosenCurrency.symbol} ${number} ${chosenCurrency.code}`;
    } catch { return `${chosenCurrency.code} ${safeValue.toFixed(2)}`; }
  };
  const persistHistory = (generated = false): boolean => {
    if (!data.customerName.trim()) {
      toast.error(en ? 'Enter the customer name before saving this invoice.' : 'ইনভয়েস সংরক্ষণের আগে গ্রাহকের নাম লিখুন।');
      return false;
    }
    saveInvoiceHistory({ type: 'Gold', number: data.number, date: data.date, customerName: data.customerName, customerPhone: data.customerPhone, total: calculations.total, currency: data.currency, itemCount: lines.length, payload: { data, lines } });
    toast.success(generated
      ? (en ? 'Invoice Generated Successfully!' : 'ইনভয়েস সফলভাবে তৈরি হয়েছে!')
      : (en ? 'Invoice saved to history.' : 'ইনভয়েস ইতিহাসে সংরক্ষণ হয়েছে।'));
    return true;
  };
  const number = (value: number, digits = 2) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
  const inputClass = 'mt-1.5 min-h-10 w-full rounded-xl border border-[#d9e0e8] bg-white px-3 py-2 text-[13px] font-medium text-[#20334f] outline-none transition focus:border-[#a97c18] focus:ring-4 focus:ring-[#d5ad48]/15 placeholder:text-[#9aa5b3]';
  const numericInput = (testId: string, value: string, onChange: (value: string) => void, placeholder = '0', step = '0.001') => (
    <input data-testid={testId} type="number" min="0" step={step} inputMode="decimal" value={value} placeholder={placeholder}
      onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} onKeyDown={(event) => { if (event.key === '-' || event.key === 'e' || event.key === 'E') event.preventDefault(); }}
      className={inputClass} />
  );
  const field = (key: keyof GoldData, label: string, type = 'text', placeholder = '') => (
    <label className="block min-w-0 text-[11px] font-semibold text-[#58677a]" key={key}>{label}
      <input data-testid={`input-gold-${key}`} type={type} value={data[key] as string} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} className={`${inputClass} ${type === 'date' ? 'text-[12px]' : ''}`} />
    </label>
  );
  const createPdf = async () => {
    setPdfMode(true);
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      const element = printRef.current;
      if (!element || !element.isConnected) throw new Error('Invoice preview is not ready');

      // Let React apply print-mode sizing before html2canvas measures the fixed A4 page.
      await new Promise<void>((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
        } else window.setTimeout(resolve, 100);
      });
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(Array.from(element.querySelectorAll('img')).map((image) =>
        image.decode().catch(() => undefined),
      ));
      normalizePdfColors(document);

      const blob = await html2pdf().set({
        margin: [10, 10, 10, 10], filename: `Gold_Invoice_${data.number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 794,
          backgroundColor: '#fff',
          onclone: normalizePdfColors,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(element).outputPdf('blob') as Blob;
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('PDF renderer returned an empty file');
      return blob;
    } finally { setPdfMode(false); }
  };
  const printInvoiceFallback = async () => {
    if (typeof window.print !== 'function') throw new Error('This WebView does not provide a print dialog');
    const root = printRef.current;
    const host = root?.closest('section');
    if (!root?.isConnected || !host) throw new Error('Invoice preview is not available for printing');
    document.body.classList.add('gold-invoice-print-fallback');
    const ancestors: HTMLElement[] = [];
    for (let parent = host.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      parent.classList.add('gold-invoice-print-ancestor');
      ancestors.push(parent);
    }
    const cleanup = () => {
      document.body.classList.remove('gold-invoice-print-fallback');
      for (const ancestor of ancestors) ancestor.classList.remove('gold-invoice-print-ancestor');
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    window.print();
    window.setTimeout(cleanup, 1000);
  };
  const shareUrl = () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ data, lines }));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const url = new URL(window.location.href);
    url.hash = `goldinvoice=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
    return url.toString();
  };
  const fileName = `Gold_Invoice_${data.number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  const downloadPdf = async () => {
    setBusy(true);
    try {
      if (!persistHistory()) return;
      const blob = await createPdf();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Gold invoice PDF failed:', error);
      try {
        await printInvoiceFallback();
        toast.info(en ? 'PDF rendering failed. Choose “Save as PDF” in the print dialog.' : 'PDF তৈরি হয়নি। প্রিন্ট ডায়ালগে “Save as PDF” বেছে নিন।');
      } catch (printError) {
        console.error('Gold invoice print fallback failed:', printError);
        const detail = printError instanceof Error ? ` ${printError.message}` : '';
        toast.error(`${labels.downloadError}${detail}`);
      }
    }
    finally { setBusy(false); }
  };
  const copyInvoiceLink = async (link: string) => {
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
      if (!copied) throw new Error('Clipboard access is unavailable');
    }
    toast.success(en ? 'Invoice link copied.' : 'ইনভয়েস লিংক কপি হয়েছে।');
  };
  const shareInvoice = async () => {
    setBusy(true);
    let link = '';
    try {
      if (!persistHistory()) return;
      link = shareUrl();
      const blob = await createPdf();
      const text = `${labels.title} ${data.number} · ${labels.total}: ${money(calculations.total)}`;
      const native = await shareGeneratedFileWithNative(blob, { fileName, mimeType: 'application/pdf', title: `${labels.title} ${data.number}`, shareText: `${text}\n${link}` });
      if (native) return;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${labels.title} ${data.number}`, text, url: link });
      } else if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${labels.title} ${data.number}`, text, url: link });
      } else {
        await copyInvoiceLink(link);
      }
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      console.error('Gold invoice sharing failed:', error);
      try { await copyInvoiceLink(link || shareUrl()); } catch { toast.error(labels.shareError); }
    }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (autoAction === 'download') void downloadPdf();
    else if (autoAction === 'share') void shareInvoice();
  // A history action is consumed once when its invoice editor mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectionTitle = (Icon: typeof Building2, eyebrow: string, title: string) => (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf5e7] text-[#9a741b]"><Icon className="h-[18px] w-[18px]" /></span>
      <div><p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#9b8a61]">{eyebrow}</p><h3 className="text-[14px] font-bold text-[#1c304d]">{title}</h3></div>
    </div>
  );
  const printableRows = Array.from(
    { length: Math.max(7, calculations.values.length) },
    (_, index) => calculations.values[index] ?? null,
  );
  const invoice = (
    <div ref={printRef} id="printable-gold-invoice" data-testid="gold-printable-invoice" className="gold-print-root mx-auto bg-white text-[#172b49]"
      style={{ width: '794px', minHeight: '1123px', padding: '24px', boxSizing: 'border-box', overflow: 'hidden', border: '2px solid #c5a059', transform: pdfMode ? 'none' : `scale(${previewScale})`, transformOrigin: 'top left' }}>
      <div className="flex h-full min-h-[1068px] flex-col border border-[#d7bd79] p-[22px] text-[9px] leading-[1.35]">
        <div className="grid grid-cols-[1.12fr_.76fr_1fr] gap-3 border-b border-[#e8dfc8] pb-3">
          <div className="min-w-0">
            {data.logo && <img src={data.logo} alt="" className="mb-1 h-11 max-w-[145px] object-contain object-left" />}
            <p className="text-[15px] font-extrabold tracking-tight text-[#18345a]">{data.company || (en ? 'Your Shop' : 'আপনার দোকান')}</p>
            <p className="mt-1 whitespace-pre-line text-[8px] text-slate-600">{data.address || labels.empty}</p>
            {data.phone && <p className="mt-1">Phone: {data.phone}</p>}
            {data.email && <p>Email: {data.email}</p>}
            {data.trn && <p>TRN: {data.trn}</p>}
          </div>
          <div className="flex flex-col items-center text-center">
            <p className="font-serif text-[17px] text-[#9a741b]" lang="ar" dir="rtl">بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ</p>
            <div className="my-1 flex h-[54px] w-[74px] items-center justify-center border border-[#d3b15c] bg-[#192f50] text-center text-[9px] font-extrabold leading-tight tracking-[.12em] text-white">{labels.taxInvoice}</div>
            <QRCodeSVG value={data.locationUrl || `${window.location.origin}/dashboard/details`} size={48} level="M" />
            <span className="mt-0.5 text-[7px] text-slate-500">{en ? 'Scan to find us' : 'আমাদের খুঁজতে স্ক্যান করুন'}</span>
          </div>
          <div className="text-right">
            <p className="mb-2 text-[9px] font-extrabold tracking-[.12em] text-[#a27b22]">{labels.partyCopy}</p>
            <div className="space-y-1.5 text-[8px]">
              {[[labels.invoiceNo, data.number], [labels.date, data.date ? new Date(`${data.date}T12:00:00`).toLocaleDateString(locale) : '—'], [labels.terms, data.payment], [labels.rate, `${chosenCurrency.symbol} ${number(safeNumber(data.metalRate), 2)} /g`], [labels.place, data.place || '—']].map(([name, value]) => (
                <p key={name} className="flex justify-between gap-2 border-b border-dotted border-slate-300 pb-0.5 text-left"><span className="shrink-0 text-slate-500">{name}:</span><span className="max-w-[125px] truncate text-right font-semibold">{value}</span></p>
              ))}
            </div>
          </div>
        </div>
        <section className="mt-3">
          <div className="bg-[#1b365b] px-2.5 py-1.5 text-[9px] font-bold tracking-wide text-white">{en ? 'CUSTOMER DETAILS (BUYER)' : 'গ্রাহকের তথ্য (ক্রেতা)'}</div>
          <div data-testid="gold-printable-customer-grid" className="grid grid-cols-[52px_minmax(0,1fr)_66px_minmax(0,1fr)] border border-t-0 border-[#d8dee6] text-[8px]">
            {Array.from({ length: 4 }, (_, index) => {
              const leftDetails = [[labels.customerName, data.customerName], [labels.phone, data.customerPhone], [labels.email, data.customerEmail], [labels.id, data.customerId]];
              const rightDetails = [[labels.address, data.customerAddress], [labels.nationality, data.nationality], [labels.country, data.country], ['', '']];
              return [
                <div key={`left-label-${index}`} className="border-b border-r border-[#d8dee6] bg-[#fafbfd] px-1.5 py-1 font-semibold text-slate-500">{leftDetails[index][0]}</div>,
                <div key={`left-value-${index}`} className="min-w-0 break-words border-b border-r border-[#d8dee6] px-1.5 py-1">{leftDetails[index][1] || '—'}</div>,
                <div key={`right-label-${index}`} className="border-b border-r border-[#d8dee6] bg-[#fafbfd] px-1.5 py-1 font-semibold text-slate-500">{rightDetails[index][0]}</div>,
                <div key={`right-value-${index}`} className="min-w-0 break-words border-b border-[#d8dee6] px-1.5 py-1">{rightDetails[index][1] || '—'}</div>,
              ];
            })}
          </div>
        </section>
        <section className="mt-3">
          <table className="w-full table-fixed border-collapse text-[7px]">
            <colgroup><col style={{ width: '5%' }} /><col style={{ width: '24%' }} /><col style={{ width: '10%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} /><col style={{ width: '17%' }} /></colgroup>
            <thead className="bg-[#1b365b] text-white"><tr>{['S.No', labels.desc, 'Gross Wt.', labels.purity, 'Pure Wt.', labels.makingRate, labels.makingAmount, labels.total].map((text, index) => <th key={index} className="border border-[#294568] px-1 py-2 text-left font-bold">{text}</th>)}</tr></thead>
            <tbody>
              {printableRows.map((line, index) => <tr key={line?.id ?? `empty-${index + 1}`} data-testid="gold-printable-item-row" className="h-5 border-b border-[#e7e8eb]">
                <td className="border-r border-[#edf0f4] px-1 py-1">{index + 1}</td>
                {line ? <>
                  <td className="truncate border-r border-[#edf0f4] px-1 py-1">{line.description || '—'}</td><td className="border-r border-[#edf0f4] px-1 py-1">{number(line.grossValue, 3)}</td>
                  <td className="border-r border-[#edf0f4] px-1 py-1">{line.purityValue.toFixed(3)}</td><td className="border-r border-[#edf0f4] px-1 py-1">{number(line.pure, 3)}</td>
                  <td className="truncate border-r border-[#edf0f4] px-1 py-1">{money(line.makingRateValue)}</td><td className="truncate border-r border-[#edf0f4] px-1 py-1">{money(line.makingAmountValue)}</td><td className="truncate px-1 py-1 text-right font-semibold">{money(line.total)}</td>
                </> : Array.from({ length: 7 }, (_, cellIndex) => <td key={`empty-cell-${cellIndex}`} aria-hidden="true" className={`${cellIndex < 6 ? 'border-r border-[#edf0f4] ' : ''}px-1 py-1`} />)}
              </tr>)}
              <tr className="border-t border-[#c9b26e] bg-[#fbf8ef] font-bold"><td colSpan={2} className="px-1.5 py-2">{en ? 'Total weight' : 'মোট ওজন'}</td><td className="px-1 py-2">{number(calculations.gross, 3)}</td><td></td><td className="px-1 py-2">{number(calculations.pure, 3)}</td><td></td><td className="px-1 py-2">{money(calculations.making)}</td><td className="px-1 py-2 text-right">{money(calculations.values.reduce((sum, item) => sum + item.total, 0))}</td></tr>
            </tbody>
          </table>
        </section>
        <div className="mt-3 flex justify-end">
          <div className="w-[420px] max-w-full text-[8px]">
            {[[`${labels.goldValue} (${number(calculations.gross, 2)}g gross × ${number(safeNumber(data.metalRate), 2)}/g)`, money(calculations.gold)], [labels.beforeVat, money(calculations.beforeVat)], [vatSummaryLabel, money(calculations.vat)], [labels.discount, `− ${money(calculations.discount)}`]].map(([label, value]) => <div key={label} className="flex justify-between border-b border-[#ece7db] px-2 py-1"><span>{label}</span><span>{value}</span></div>)}
            <div className="flex justify-between bg-[#1b365b] px-2 py-2 text-[9px] font-extrabold text-white"><span>{labels.incl}</span><span data-testid="text-gold-total">{money(calculations.total)}</span></div>
          </div>
        </div>
        <div data-testid="gold-printable-payment-box" className="mt-3 flex min-h-[64px] flex-col justify-center gap-1 border border-[#e6dfce] px-3 py-3 text-[8px] leading-relaxed">
          <p><span className="font-bold">{labels.words}: </span>{numberToWords(calculations.total, lang)} {chosenCurrency.name}</p>
          <p><span className="font-bold">{labels.mode}: </span>{data.payment}{data.pending ? ` · ${labels.pendingShort}` : ''}</p>
          {data.notes && <p><span className="font-bold">{labels.notes}: </span>{data.notes}</p>}
        </div>
        <div className="mt-auto grid grid-cols-3 gap-8 px-3 pb-2 pt-10 text-center text-[8px] font-semibold">
          {[(en ? "Customer's Signature" : 'গ্রাহকের স্বাক্ষর'), (en ? 'Checked By' : 'যাচাই করেছেন'), (en ? 'Authorised Signature' : 'অনুমোদিত স্বাক্ষর')].map((label, index) => (
            <div key={label} className="relative border-t border-[#7c8794] pt-2">{index === 2 && stamp && <img data-testid="gold-company-stamp" src={stamp} alt="" className="absolute bottom-5 left-1/2 max-h-[52px] max-w-[95px] -translate-x-1/2 object-contain" />}{label}</div>
          ))}
        </div>
        <div className="mt-2 bg-[#1b365b] px-3 py-2 text-center text-[8px] font-semibold tracking-wide text-white">{labels.thank}</div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6f6f3] text-[#1d2e47]">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#e7e2d5] bg-white px-4 py-3.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3"><span className="hidden h-10 w-10 items-center justify-center rounded-xl bg-[#f7f0dc] text-[#9b751b] sm:flex"><ReceiptText className="h-5 w-5" /></span><div><h2 className="truncate text-[17px] font-bold tracking-tight text-[#1b2f4d]">{labels.title}</h2><p className="hidden text-xs text-[#77869a] sm:block">{labels.subtitle}</p></div></div>
        <div className="flex items-center gap-2">
          {readOnlyPreview && <button type="button" data-testid="button-gold-preview-edit" onClick={() => setReadOnlyPreview(false)} className="inline-flex min-h-10 items-center rounded-xl border border-[#ded8c9] bg-white px-3 text-[13px] font-bold text-[#53627a]">{en ? 'Edit' : 'সম্পাদনা'}</button>}
          <button type="button" data-testid="button-gold-share" disabled={busy} onClick={() => void shareInvoice()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#ded8c9] bg-white px-3 text-[13px] font-bold text-[#53627a] transition hover:bg-[#faf7ef] disabled:opacity-60"><Share2 className="h-4 w-4" /><span className="hidden sm:inline">{labels.share}</span></button>
          <button type="button" data-testid="button-gold-download" disabled={busy} onClick={() => void downloadPdf()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1b365b] px-3.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#142b49] disabled:opacity-60 sm:px-4"><Download className="h-4 w-4" /><span className="hidden sm:inline">{busy ? (en ? 'Preparing…' : 'তৈরি হচ্ছে…') : labels.download}</span></button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <section className={`${readOnlyPreview ? 'hidden' : ''} h-full min-h-0 overflow-y-auto px-4 py-5 md:px-6`}>
          <div className="w-full space-y-4 pb-8">
            <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#a48a51]">{labels.details}</p><p className="mt-1 text-xs text-[#78869a]">{en ? 'Enter each piece once; calculations update as you type.' : 'প্রতিটি গয়নার তথ্য একবার দিন; টাইপ করার সঙ্গে হিসাব আপডেট হবে।'}</p></div><span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e4dcc9] bg-white text-[#9a741b]"><CalendarDays className="h-4 w-4" /></span></div>
            <section className="rounded-2xl border border-[#e6e1d5] bg-white p-4 shadow-[0_2px_12px_rgba(49,45,34,.035)] md:p-5">
              {sectionTitle(UserRound, en ? '02 · BUYER' : '০২ · ক্রেতা', labels.customer)}
              <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2">
                {field('customerName', labels.customerName)}{field('customerPhone', labels.phone, 'tel')}{field('customerEmail', labels.email, 'email')}{field('customerId', labels.id)}{field('nationality', labels.nationality)}{field('country', labels.country)}
                <label className="block min-w-0 text-[11px] font-semibold text-[#58677a] sm:col-span-2">{labels.address}<textarea data-testid="input-gold-customerAddress" value={data.customerAddress} onChange={(event) => set('customerAddress', event.target.value)} className={`${inputClass} min-h-[58px] resize-y`} /></label>
              </div>
            </section>
            <section className="rounded-2xl border border-[#e6e1d5] bg-white p-4 shadow-[0_2px_12px_rgba(49,45,34,.035)] md:p-5">
              <div className="mb-4 flex items-center justify-between">{sectionTitle(FileText, en ? '03 · LINE ITEMS' : '০৩ · আইটেম', labels.items)}<span className="rounded-full bg-[#f8f2e2] px-2.5 py-1 text-[10px] font-bold text-[#8d6c1d]">{lines.length} {en ? 'items' : 'টি'}</span></div>
              <div className="space-y-3">
                {lines.map((line, index) => {
                  const calculated = calculations.values[index];
                  return <div key={line.id} data-testid={`card-gold-line-${line.id}`} className="rounded-xl border border-[#ece7dc] bg-[#fdfcf9] p-3">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-[#a2874d]">{en ? `Piece ${index + 1}` : `আইটেম ${index + 1}`}</span><button type="button" data-testid={`button-gold-remove-${line.id}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} aria-label={labels.remove} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9a5c58] hover:bg-[#f8eae7] disabled:opacity-35"><Trash2 className="h-4 w-4" /></button></div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <label className="col-span-2 block text-[10px] font-semibold text-[#58677a] sm:col-span-3">{labels.desc}<input data-testid={`input-gold-description-${line.id}`} value={line.description} onChange={(event) => updateLine(line.id, 'description', event.target.value)} placeholder={en ? 'e.g. 22K chain · stock code' : 'যেমন ২২ ক্যারেট চেইন · স্টক কোড'} className={inputClass} /></label>
                       <label className="block text-[10px] font-semibold text-[#58677a]">{labels.gross}{numericInput(`input-gold-gross-${line.id}`, line.gross, (value) => updateLine(line.id, 'gross', value))}
                         <select data-testid={`select-gold-weight-unit-${line.id}`} value={line.grossUnit} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, grossUnit: event.target.value as GoldLine['grossUnit'] } : item))} className="mt-1 min-h-8 w-full rounded-lg border border-[#e5dfd1] bg-white px-2 text-[10px] text-[#5a6574]">
                           <option value="g">{labels.grams}</option><option value="vori">{labels.vori}</option>
                         </select>
                       </label>
                      <label className="block text-[10px] font-semibold text-[#58677a]">{labels.purity}<input data-testid={`input-gold-purity-${line.id}`} list={`gold-purity-options-${line.id}`} inputMode="decimal" value={line.purity} onChange={(event) => updateLine(line.id, 'purity', event.target.value)} className={inputClass} /><datalist id={`gold-purity-options-${line.id}`}><option value="0.916">22K</option><option value="0.875">21K</option><option value="0.750">18K</option><option value="0.999">24K</option><option value="0.958">23K</option><option value="1.000">Fine gold</option></datalist></label>
                      <div className="flex items-end pb-1"><p className="w-full rounded-lg bg-[#f4f0e5] px-2.5 py-2 text-[10px] text-[#6c5b35]">{labels.pure}<b data-testid={`text-gold-pure-${line.id}`} className="ml-1 block text-[12px] text-[#1c304d]">{number(calculated.pure, 3)} g</b></p></div>
                      <label className="block text-[10px] font-semibold text-[#58677a]">{labels.makingRate}{numericInput(`input-gold-making-rate-${line.id}`, line.makingRate, (value) => updateLine(line.id, 'makingRate', value))}</label>
                      <label className="block text-[10px] font-semibold text-[#58677a]">{labels.makingAmount}{numericInput(`input-gold-making-amount-${line.id}`, line.makingAmount, (value) => updateLine(line.id, 'makingAmount', value))}</label>
                      <div className="flex items-end pb-1"><p className="w-full rounded-lg bg-[#edf2f7] px-2.5 py-2 text-[10px] text-[#607088]">{labels.total}<b data-testid={`text-gold-line-total-${line.id}`} className="ml-1 block truncate text-[11px] text-[#1c304d]">{money(calculated.total)}</b></p></div>
                    </div>
                    <p className="mt-2 text-[9px] text-[#9299a0]">{en ? 'Making amount is entered directly, or calculated as gross grams × making rate.' : 'মেকিং চার্জ সরাসরি দিন, অথবা মোট গ্রাম × মেকিং রেট থেকে হিসাব হবে।'}</p>
                  </div>;
                })}
                  <button type="button" data-testid="button-gold-add-item" onClick={() => { setLines((current) => [...current, { id: nextId, description: '', gross: '', grossUnit: 'g', purity: '0.916', makingRate: '', makingAmount: '' }]); setNextId((value) => value + 1); }} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#d6c99f] bg-[#fffdf7] text-xs font-bold text-[#8e6c1a] transition hover:bg-[#fbf5e6]"><Plus className="h-4 w-4" />{labels.add}</button>
              </div>
            </section>
            <section className="rounded-2xl border border-[#e6e1d5] bg-white p-4 shadow-[0_2px_12px_rgba(49,45,34,.035)] md:p-5">
              {sectionTitle(CalendarDays, en ? '04 · PAYMENT' : '০৪ · পেমেন্ট', labels.payment)}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-[11px] font-semibold text-[#58677a]">{labels.currency}
                  <div className="relative mt-1.5"><button type="button" data-testid="button-gold-currency" onClick={() => { setCurrencyOpen(!currencyOpen); setCurrencySearch(''); }} className="flex min-h-10 w-full items-center justify-between rounded-xl border border-[#d9e0e8] bg-white px-3 text-[13px] font-semibold text-[#20334f]"><span>{chosenCurrency.symbol} &nbsp;{chosenCurrency.code} · {chosenCurrency.name}</span><ChevronDown className="h-4 w-4" /></button>
                    {currencyOpen && <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-[#d9e0e8] bg-white shadow-xl"><input autoFocus data-testid="input-gold-currency-search" value={currencySearch} onChange={(event) => setCurrencySearch(event.target.value)} placeholder={labels.currencySearch} className="min-h-10 w-full border-b border-[#e5e8ec] px-3 text-xs outline-none" /><div className="max-h-52 overflow-y-auto p-1">{filteredCurrencies.length ? filteredCurrencies.slice(0, 100).map((option) => <button type="button" key={option.code} data-testid={`option-gold-currency-${option.code}`} onClick={() => { set('currency', option.code); setCurrencyOpen(false); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-[#f8f4e9]"><span className="w-7 text-[#9a741b]">{option.symbol}</span><b>{option.code}</b><span className="truncate text-slate-500">{option.name}</span></button>) : <p className="px-3 py-4 text-xs text-slate-500">{labels.noCurrency}</p>}</div></div>}
                  </div>
                </label>
                <label className="block text-[11px] font-semibold text-[#58677a]">{labels.rate} ({chosenCurrency.symbol} {chosenCurrency.code}/g){numericInput('input-gold-metal-rate', data.metalRate, (value) => set('metalRate', value), '0', '0.01')}</label>
                {field('date', labels.date, 'date')}
                {field('place', labels.place)}
                <label className="block text-[11px] font-semibold text-[#58677a]">{labels.method}<select data-testid="select-gold-payment" value={data.payment} onChange={(event) => set('payment', event.target.value)} className={inputClass}><option value="Cash Payment">{labels.cash}</option><option value="Bank Transfer">{labels.bank}</option><option value="Card Payment">{labels.card}</option><option value="Mobile Payment">{labels.mobilePay}</option><option value="Credit">{en ? 'Credit' : 'বাকি'}</option></select></label>
                <label className="flex min-h-[42px] cursor-pointer items-center justify-between rounded-xl border border-[#e5e0d4] px-3 py-2"><span><b className="block text-[11px] text-[#46566d]">{labels.pending}</b><small className="text-[9px] text-[#8993a1]">{labels.pendingHint}</small></span><input data-testid="toggle-gold-pending" type="checkbox" checked={data.pending} onChange={(event) => set('pending', event.target.checked)} className="h-4 w-4 accent-[#a47c1b]" /></label>
                <label className="block text-[11px] font-semibold text-[#58677a] sm:col-span-2">{labels.notes}<textarea data-testid="input-gold-notes" value={data.notes} onChange={(event) => set('notes', event.target.value)} className={`${inputClass} min-h-[55px] resize-y`} /></label>
                <label className="block text-[11px] font-semibold text-[#58677a]">{labels.discount}{numericInput('input-gold-discount', data.discount, (value) => set('discount', value), '0', '0.01')}</label>
              </div>
              <div className="mt-4 rounded-xl border border-[#e8e2d3] bg-[#fcfbf8] p-3">
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white p-2.5"><p className="text-[9px] font-semibold text-[#8893a2]">{labels.grossTotal}</p><p data-testid="text-gold-gross-total" className="mt-1 text-[15px] font-bold text-[#243954]">{number(calculations.gross, 3)} <small className="text-[10px]">g</small></p></div>
                  <div className="rounded-lg bg-white p-2.5"><p className="text-[9px] font-semibold text-[#8893a2]">{labels.pureTotal}</p><p data-testid="text-gold-pure-total" className="mt-1 text-[15px] font-bold text-[#243954]">{number(calculations.pure, 3)} <small className="text-[10px]">g</small></p></div>
                </div>
                {[[`${labels.goldValue} (${number(calculations.gross, 2)}g gross × ${chosenCurrency.symbol}${number(safeNumber(data.metalRate), 2)}/g)`, calculations.gold], [labels.making, calculations.making], [labels.beforeVat, calculations.beforeVat], [labels.discount, -calculations.discount]].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3 py-1 text-[10px] text-[#68778a]"><span>{label}</span><b className="shrink-0 text-[#3c4d65]">{money(Number(value))}</b></div>)}
                <div className="flex items-center justify-between gap-3 border-t border-[#e7e2d5] py-1.5 text-[10px] text-[#68778a]">
                  <label htmlFor="input-gold-vat-rate" className="shrink-0">{labels.vatRate}</label>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex shrink-0 items-center gap-1"><span className="w-16">{numericInput('input-gold-vat-rate', data.vatRate || '5', (value) => set('vatRate', value), '5', '0.01')}</span>%</span>
                    <b data-testid="text-gold-vat" className="shrink-0 text-[#3c4d65]">{money(calculations.vat)}</b>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg bg-[#1b365b] px-3 py-2.5 text-[12px] font-bold text-white"><span>{labels.incl}</span><span data-testid="text-gold-total">{money(calculations.total)}</span></div>
                <p className="mt-2 text-[9px] leading-relaxed text-[#7e8793]">{labels.words}: <span data-testid="text-gold-amount-words" className="font-semibold text-[#485a72]">{numberToWords(calculations.total, lang)} {chosenCurrency.name}</span></p>
              </div>
            </section>
            <button type="button" aria-label={en ? 'Generate Invoice' : 'ইনভয়েস তৈরি করুন'} data-testid="button-gold-save-history" onClick={() => { if (persistHistory(true)) onGenerated?.(); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#d9aa1f] px-5 text-sm font-extrabold text-[#1b2f4d] shadow-sm transition hover:bg-[#c99a12] active:scale-[.99]">
              <FileText className="h-5 w-5" />{en ? 'Generate Invoice' : 'ইনভয়েস তৈরি করুন'}
            </button>
          </div>
        </section>
        {(readOnlyPreview || pdfMode) && <section className={`gold-invoice-print-host ${readOnlyPreview ? 'h-full min-h-0 overflow-auto bg-[#edece7] p-3 md:p-5' : 'fixed left-[-10000px] top-0 z-[-1] block w-[794px]'}`}>
          <div className="mx-auto mb-3 flex max-w-[794px] items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-[#82817b]"><span>{en ? 'Invoice preview' : 'ইনভয়েস প্রিভিউ'}</span><span className="rounded-full bg-white px-2.5 py-1">{data.number}</span></div>
          <div ref={previewShellRef} className="gold-preview-shell mx-auto w-full max-w-[794px] overflow-hidden rounded-sm shadow-[0_8px_35px_rgba(30,37,48,.16)]" style={{ height: `${1123 * (pdfMode ? 1 : previewScale)}px` }}>{invoice}</div>
        </section>}
      </div>
    </div>
  );
}

export default GoldInvoice;
