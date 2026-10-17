import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CalendarDays, Check, Download, Eye, FileText, Plus, ReceiptText, Share2, Trash2, UserRound, PencilLine } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { shareGeneratedFileWithNative } from '@/lib/native-file-export';

type InvoiceLine = { id: number; description: string; amount: string; taxed: boolean };
type InvoiceData = {
  company: string; address: string; phone: string; website: string; logo: string;
  customer: string; customerAddress: string; customerPhone: string;
  number: string; date: string; due: string; currency: 'BDT' | 'USD'; taxRate: string; comments: string;
};

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dueDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const newInvoiceNumber = () => `INV-${today().replaceAll('-', '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const money = (value: number, currency: string, lang: string) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'bn-BD', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
const dateLabel = (value: string, lang: string) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString(lang === 'en' ? 'en-US' : 'bn-BD') : '—';

export function BusinessInvoice() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const printRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [pdfMode, setPdfMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState(2);
  const [invoiceData, setInvoiceData] = useState<InvoiceData>({
    company: '', address: '', phone: '', website: '', logo: '',
    customer: '', customerAddress: '', customerPhone: '',
    number: newInvoiceNumber(), date: today(), due: dueDate(), currency: 'BDT', taxRate: '0', comments: '',
  });
  const [lines, setLines] = useState<InvoiceLine[]>([{ id: 1, description: '', amount: '', taxed: false }]);
  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
    const taxable = lines.reduce((sum, item) => sum + (item.taxed ? Math.max(0, Number(item.amount) || 0) : 0), 0);
    const tax = taxable * (Math.max(0, Number(invoiceData.taxRate) || 0) / 100);
    return { subtotal, taxable, tax, total: subtotal + tax };
  }, [lines, invoiceData.taxRate]);
  const labels = en ? {
    title: 'Business invoice', subtitle: 'A clear, professional bill for your customer.',
    company: 'Shop details', address: 'Business address', phone: 'Phone number', website: 'Website', logo: 'Logo image URL',
    customer: 'Customer name', customerAddress: 'Customer address', customerPhone: 'Customer phone',
    number: 'Invoice number', date: 'Invoice date', due: 'Payment due date', currency: 'Currency', tax: 'Tax rate (%)',
    description: 'Item description', taxed: 'Taxable', amount: 'Amount', add: 'Add an item', comments: 'Notes or payment terms',
    edit: 'Edit details', preview: 'View invoice', download: 'Download PDF', share: 'Share',
    subtotal: 'Subtotal', taxable: 'Taxable amount', taxDue: 'Tax', total: 'Total due', thank: 'Thank you for your business.',
    companyBlock: 'From your shop', billTo: 'Bill to', commentsBlock: 'Notes', empty: 'Add your shop and customer details to complete the invoice.',
    shared: 'Invoice summary copied. You can paste it into WhatsApp or email.', shareError: 'Could not share the invoice.',
    setup: 'Invoice details', live: 'Live preview', item: 'Item', remove: 'Remove item', taxHint: 'Tax is calculated only on items marked taxable.',
  } : {
    title: 'বিজনেস ইনভয়েস', subtitle: 'গ্রাহকের জন্য পরিষ্কার ও পেশাদার বিল তৈরি করুন।',
    company: 'দোকানের নাম', address: 'ব্যবসার ঠিকানা', phone: 'ফোন নম্বর', website: 'ওয়েবসাইট', logo: 'লোগো ছবির URL',
    customer: 'গ্রাহকের নাম', customerAddress: 'গ্রাহকের ঠিকানা', customerPhone: 'গ্রাহকের ফোন',
    number: 'ইনভয়েস নম্বর', date: 'ইনভয়েসের তারিখ', due: 'পরিশোধের শেষ তারিখ', currency: 'মুদ্রা', tax: 'কর হার (%)',
    description: 'পণ্যের বিবরণ', taxed: 'করযোগ্য', amount: 'পরিমাণ', add: 'আইটেম যোগ করুন', comments: 'নোট বা পেমেন্টের শর্ত',
    edit: 'তথ্য সম্পাদনা', preview: 'ইনভয়েস দেখুন', download: 'PDF ডাউনলোড', share: 'শেয়ার',
    subtotal: 'সাবটোটাল', taxable: 'করযোগ্য পরিমাণ', taxDue: 'কর', total: 'মোট পাওনা', thank: 'আপনার ব্যবসার জন্য ধন্যবাদ।',
    companyBlock: 'আপনার দোকান থেকে', billTo: 'যার নামে বিল', commentsBlock: 'নোট', empty: 'ইনভয়েস সম্পূর্ণ করতে দোকান ও গ্রাহকের তথ্য দিন।',
    shared: 'ইনভয়েসের সারাংশ কপি হয়েছে। WhatsApp বা ইমেইলে পেস্ট করুন।', shareError: 'ইনভয়েস শেয়ার করা যায়নি।',
    setup: 'ইনভয়েসের তথ্য', live: 'প্রিভিউ', item: 'আইটেম', remove: 'আইটেম মুছুন', taxHint: 'শুধু করযোগ্য হিসেবে চিহ্নিত আইটেমে কর হিসাব হবে।',
  };
  const set = (key: keyof InvoiceData, value: string) => setInvoiceData((current) => ({ ...current, [key]: value }));
  const current = invoiceData;
  const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-[#d9e1ed] bg-white px-3.5 text-[14px] font-medium text-[#192c49] outline-none transition focus:border-[#31578f] focus:ring-4 focus:ring-[#31578f]/10 placeholder:text-[#9aa8ba]';
  const field = (key: keyof InvoiceData, label: string, type = 'text') => (
    <label className="block min-w-0 text-[12px] font-semibold tracking-[.01em] text-[#55657b]" key={key}>
      {label}
      <input data-testid={`input-invoice-${key}`} type={type} value={current[key] as string} onChange={(event) => set(key, event.target.value)}
        className={`${inputClass} ${type === 'date' ? 'text-[13px]' : ''}`} />
    </label>
  );
  const itemAmount = (value: string) => Number(value) || 0;
  const filename = `Invoice_${current.number.replace(/[^a-zA-Z0-9_-]/g, '_') || 'draft'}.pdf`;
  async function createPdf() {
    if (!printRef.current) throw new Error('Invoice preview is not ready.');
    setPreview(true);
    setPdfMode(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      const { default: html2pdf } = await import('html2pdf.js');
      const worker = html2pdf().set({
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 816 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(printRef.current);
      return await worker.outputPdf('blob') as Blob;
    } finally {
      setPdfMode(false);
    }
  }
  async function shareInvoice() {
    const text = `${labels.title} ${current.number}\n${labels.customer}: ${current.customer || '—'}\n${labels.total}: ${money(totals.total, current.currency, lang)}\n${labels.due}: ${dateLabel(current.due, lang)}`;
    setBusy(true);
    try {
      const blob = await createPdf();
      const native = await shareGeneratedFileWithNative(blob, { fileName: filename, mimeType: 'application/pdf', title: `${labels.title} ${current.number}`, shareText: text });
      if (native) return;
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${labels.title} ${current.number}`, text });
      } else if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${labels.title} ${current.number}`, text });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success(labels.shared);
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') toast.error(labels.shareError);
    } finally {
      setBusy(false);
    }
  }
  async function downloadPdf() {
    setBusy(true);
    try {
      const blob = await createPdf();
      const native = await shareGeneratedFileWithNative(blob, { fileName: filename, mimeType: 'application/pdf', title: `${labels.title} ${current.number}` });
      if (!native) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Invoice PDF generation failed:', error);
      toast.error(labels.shareError);
    } finally {
      setBusy(false);
    }
  }
  const sectionHeading = (Icon: typeof Building2, eyebrow: string, title: string) => (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf3fb] text-[#31578f]"><Icon className="h-[18px] w-[18px]" /></span>
      <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#8291a6]">{eyebrow}</p><h3 className="text-[14px] font-bold text-[#1b2f4d]">{title}</h3></div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f3f6fa] text-[#1d2e47]">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#e1e7ef] bg-white px-4 py-3.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-10 w-10 items-center justify-center rounded-xl bg-[#eaf0f8] text-[#284c80] sm:flex"><ReceiptText className="h-5 w-5" /></span>
          <div className="min-w-0"><h2 className="truncate text-[17px] font-bold tracking-tight text-[#1b2f4d]">{labels.title}</h2><p className="hidden text-xs text-[#77869a] sm:block">{labels.subtitle}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" data-testid="button-invoice-mobile-view" onClick={() => setPreview((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#dce4ee] bg-white px-3 text-[13px] font-semibold text-[#3d526f] transition hover:bg-[#f5f8fc] lg:hidden">
            {preview ? <PencilLine className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{preview ? labels.edit : labels.preview}
          </button>
          <button type="button" data-testid="button-invoice-share" disabled={busy} onClick={shareInvoice} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d8e1ed] bg-white px-3 text-[13px] font-bold text-[#365273] transition hover:bg-[#f5f8fc] disabled:opacity-60">
            <Share2 className="h-4 w-4" /><span className="hidden sm:inline">{labels.share}</span>
          </button>
          <button type="button" data-testid="button-invoice-download" disabled={busy} onClick={downloadPdf} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#244878] px-3.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#1c3b66] disabled:opacity-60 sm:px-4">
            <Download className="h-4 w-4" /><span className="hidden sm:inline">{busy ? (en ? 'Preparing…' : 'তৈরি হচ্ছে…') : labels.download}</span>
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(360px,0.92fr)_minmax(470px,1.08fr)]">
        <section className={`${preview ? 'hidden lg:block' : ''} min-h-0 overflow-y-auto px-4 py-5 md:px-6`}>
          <div className="mx-auto max-w-[650px] space-y-4 pb-8">
            <div className="mb-5 flex items-center justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#8291a6]">{labels.setup}</p><p className="mt-1 text-sm text-[#697b92]">{en ? 'Fill in what you know. You can edit everything.' : 'প্রয়োজনীয় তথ্য দিন, সবকিছুই পরে সম্পাদনা করা যাবে।'}</p></div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8e2ee] bg-white text-[#45668f]"><FileText className="h-4 w-4" /></span>
            </div>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
              {sectionHeading(Building2, en ? '01 · Seller' : '০১ · বিক্রেতা', labels.companyBlock)}
              <div className="grid gap-x-3.5 gap-y-3 sm:grid-cols-2">
                {field('company', labels.company)}{field('phone', labels.phone)}
                {field('address', labels.address)}{field('website', labels.website)}
                <div className="sm:col-span-2">{field('logo', labels.logo)}</div>
              </div>
            </section>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
              {sectionHeading(UserRound, en ? '02 · Customer' : '০২ · গ্রাহক', labels.billTo)}
              <div className="grid gap-x-3.5 gap-y-3 sm:grid-cols-2">
                {field('customer', labels.customer)}{field('customerPhone', labels.customerPhone)}
                <div className="sm:col-span-2">{field('customerAddress', labels.customerAddress)}</div>
              </div>
            </section>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
              {sectionHeading(CalendarDays, en ? '03 · Reference' : '০৩ · তারিখ ও নম্বর', en ? 'Invoice information' : 'ইনভয়েসের তথ্য')}
              <div className="grid gap-x-3.5 gap-y-3 sm:grid-cols-2">
                {field('number', labels.number)}{field('date', labels.date, 'date')}
                {field('due', labels.due, 'date')}
                <label className="block text-[12px] font-semibold text-[#55657b]">{labels.currency}
                  <select data-testid="select-invoice-currency" value={current.currency} onChange={(e) => set('currency', e.target.value)} className={inputClass}><option value="BDT">৳ BDT · Bangladeshi Taka</option><option value="USD">$ USD · US Dollar</option></select>
                </label>
                {field('taxRate', labels.tax, 'number')}
              </div>
            </section>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">
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
                    <div className="grid grid-cols-[minmax(0,1fr)_110px] items-end gap-2.5">
                      <label className="text-[12px] font-semibold text-[#55657b]">{labels.description}
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
            <label className="block rounded-2xl border border-[#e2e8f0] bg-white p-4 text-[12px] font-semibold text-[#55657b] shadow-[0_2px_10px_rgba(37,61,92,.035)] md:p-5">{labels.comments}
              <textarea data-testid="textarea-invoice-comments" value={current.comments} onChange={(e) => set('comments', e.target.value)} rows={3} placeholder={en ? 'Payment details, thanks, or other notes…' : 'পেমেন্টের তথ্য বা অন্য কোনো নোট…'} className={`${inputClass} min-h-[92px] resize-y py-3`} />
            </label>
          </div>
        </section>
        <section className={`${preview ? '' : 'hidden lg:block'} min-h-0 overflow-auto border-l border-[#e2e8f0] bg-[#e9eef5] px-3 py-5 md:px-6 md:py-7`}>
          <div className="mx-auto mb-3 flex max-w-[816px] items-center justify-between px-1 text-[10px] font-bold uppercase tracking-[.15em] text-[#79899e]">
            <span>{labels.live}</span><span className="flex items-center gap-1.5 normal-case tracking-normal"><span className="h-1.5 w-1.5 rounded-full bg-[#58816b]" />{en ? 'Updates as you type' : 'লেখার সঙ্গে সঙ্গে আপডেট'}</span>
          </div>
          <div ref={printRef} style={pdfMode ? { width: 816, maxWidth: 'none' } : undefined} className="invoice-print relative mx-auto min-h-[800px] w-full max-w-[816px] overflow-hidden border border-[#dce2ea] bg-white px-6 py-7 text-[12px] text-[#233752] shadow-[0_14px_42px_rgba(35,55,82,.12)] sm:px-10 sm:py-10">
            <div className="absolute inset-x-0 top-0 h-[7px] bg-[#33578a]" />
            <div className="relative flex justify-between gap-5 border-b border-[#d7e0eb] pb-7 pt-1">
              <div className="min-w-0">
                {current.logo && <img src={current.logo} crossOrigin="anonymous" alt="" className="mb-3 max-h-14 max-w-36 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <p className="mb-1 text-[9px] font-bold uppercase tracking-[.19em] text-[#71829a]">{labels.companyBlock}</p>
                <h1 className="break-words text-xl font-bold tracking-tight text-[#203a5c] sm:text-[25px]">{current.company || labels.company}</h1>
                <p className="mt-2 whitespace-pre-line text-[11px] leading-[1.75] text-[#66778e]">{[current.address, current.phone, current.website].filter(Boolean).join('\n')}</p>
              </div>
              <div className="shrink-0 pt-1 text-right">
                <h2 className="text-[27px] font-bold tracking-[.12em] text-[#31578f] sm:text-[32px]">INVOICE</h2>
                <p className="mt-1 text-[9px] font-semibold uppercase tracking-[.17em] text-[#8a98aa]">{current.number || '—'}</p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="border-l-[3px] border-[#8da4c3] pl-3">
                <p className="mb-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#75869d]">{labels.billTo}</p>
                <p className="font-bold text-[#263e60]">{current.customer || '—'}</p>
                <p className="mt-1 whitespace-pre-line text-[10px] leading-[1.7] text-[#6e7e93]">{[current.customerAddress, current.customerPhone].filter(Boolean).join('\n') || '—'}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-right">
                <div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#8492a5]">{labels.date}</p><p className="mt-1 font-semibold text-[#304866]">{dateLabel(current.date, lang)}</p></div>
                <div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#8492a5]">{labels.due}</p><p className="mt-1 font-semibold text-[#304866]">{dateLabel(current.due, lang)}</p></div>
              </div>
            </div>
            <table className="mt-7 w-full border-collapse text-[10px]">
              <thead><tr className="border-y border-[#cbd7e5] bg-[#f2f5f9] text-[#405875]">
                <th className="px-3 py-2.5 text-left font-bold uppercase tracking-[.09em]">{labels.description}</th>
                <th className="w-[74px] px-2 py-2.5 text-center font-bold uppercase tracking-[.05em]">{labels.taxed}</th>
                <th className="w-[130px] px-3 py-2.5 text-right font-bold uppercase tracking-[.09em]">{labels.amount}</th>
              </tr></thead>
              <tbody>{lines.map((item, index) => <tr key={item.id} className={`border-b border-[#e3e8ef] ${index % 2 ? 'bg-[#fbfcfd]' : ''}`}>
                <td className="min-h-9 px-3 py-3 font-medium text-[#344b68]">{item.description || '—'}</td>
                <td className="px-2 py-3 text-center text-[#476b9d]">{item.taxed ? <Check className="mx-auto h-3.5 w-3.5" /> : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#344b68]">{money(itemAmount(item.amount), current.currency, lang)}</td>
              </tr>)}</tbody>
            </table>
            <div className="ml-auto mt-5 w-full max-w-[260px] space-y-2 text-[10px]">
              <div className="flex justify-between text-[#718198]"><span>{labels.subtotal}</span><span className="tabular-nums text-[#3d526e]">{money(totals.subtotal, current.currency, lang)}</span></div>
              <div className="flex justify-between text-[#718198]"><span>{labels.taxable}</span><span className="tabular-nums text-[#3d526e]">{money(totals.taxable, current.currency, lang)}</span></div>
              <div className="flex justify-between text-[#718198]"><span>{labels.taxDue} ({Number(current.taxRate) || 0}%)</span><span className="tabular-nums text-[#3d526e]">{money(totals.tax, current.currency, lang)}</span></div>
               <div className="mt-3 flex items-center justify-between border-t-2 border-[#33578a] pt-3 text-[12px] font-bold text-[#263f62]"><span>{labels.total}</span><span data-testid="text-invoice-total" className="text-[16px] tabular-nums">{money(totals.total, current.currency, lang)}</span></div>
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
          {!current.company && <p data-testid="text-invoice-preview-hint" className="mx-auto mt-3 max-w-[816px] text-center text-[11px] text-[#75869b]">{labels.empty}</p>}
        </section>
      </div>
    </div>
  );
}
