import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Search, Share2, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { deleteInvoiceHistory, INVOICE_HISTORY_EVENT, readInvoiceHistory, type InvoiceHistoryAction, type InvoiceHistoryRecord } from './invoice-history';

export function InvoiceList({ onOpen }: { onOpen: (record: InvoiceHistoryRecord, action: InvoiceHistoryAction) => void }) {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [records, setRecords] = useState(readInvoiceHistory);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const refresh = () => setRecords(readInvoiceHistory());
    window.addEventListener(INVOICE_HISTORY_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(INVOICE_HISTORY_EVENT, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const visible = useMemo(() => records.filter((record) =>
    (filter === 'all' || record.type === filter) &&
    `${record.customerName} ${record.customerPhone} ${record.number}`.toLowerCase().includes(search.toLowerCase()),
  ), [records, filter, search]);
  const money = (record: InvoiceHistoryRecord) => {
    try { return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'bn-BD', { style: 'currency', currency: record.currency }).format(record.total); }
    catch { return `${record.total.toFixed(2)} ${record.currency}`; }
  };
  return <main className="h-full overflow-auto bg-slate-50 p-4 md:p-6">
    <div className="mx-auto max-w-6xl">
      <h2 className="text-xl font-bold text-slate-900">{en ? 'Invoice List' : 'ইনভয়েস তালিকা'}</h2>
      <div className="my-4 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input data-testid="input-invoice-history-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={en ? 'Search customer, phone, or invoice number' : 'গ্রাহক, ফোন বা ইনভয়েস নম্বর খুঁজুন'} className="min-h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm" /></label>
        <select data-testid="select-invoice-history-type" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-h-10 rounded-lg border bg-white px-3 text-sm">
          <option value="all">{en ? 'All Invoices' : 'সব ইনভয়েস'}</option><option value="Business">{en ? 'Business Invoices' : 'বিজনেস ইনভয়েস'}</option><option value="Gold">{en ? 'Gold Invoices' : 'গোল্ড ইনভয়েস'}</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>{[en?'Invoice No.':'ইনভয়েস নং',en?'Date':'তারিখ',en?'Type':'ধরন',en?'Customer Name':'গ্রাহকের নাম',en?'Total Amount':'মোট',en?'Actions':'কাজ'].map((x)=><th key={x} className="px-3 py-3">{x}</th>)}</tr></thead>
          <tbody>{visible.map((record)=><tr key={record.id} className="border-t">
            <td className="px-3 py-3 font-semibold">{record.number}</td><td className="px-3 py-3">{record.date}</td>
            <td className="px-3 py-3"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{record.type}</span></td>
            <td className="px-3 py-3">{record.customerName || '—'}<small className="block text-slate-500">{record.customerPhone}</small></td><td className="px-3 py-3 font-semibold">{money(record)}</td>
            <td className="px-3 py-3"><div className="flex gap-1">
              <button data-testid={`button-history-open-${record.id}`} title={en?'View / Edit':'দেখুন / সম্পাদনা'} onClick={()=>onOpen(record,'open')} className="rounded p-2 hover:bg-slate-100"><Eye className="h-4 w-4"/></button>
              <button data-testid={`button-history-download-${record.id}`} title={en?'Download PDF':'PDF ডাউনলোড'} onClick={()=>onOpen(record,'download')} className="rounded p-2 hover:bg-slate-100"><Download className="h-4 w-4"/></button>
              <button data-testid={`button-history-share-${record.id}`} title={en?'Share':'শেয়ার'} onClick={()=>onOpen(record,'share')} className="rounded p-2 hover:bg-slate-100"><Share2 className="h-4 w-4"/></button>
              <button data-testid={`button-history-delete-${record.id}`} title={en?'Delete':'মুছুন'} onClick={()=>{if(window.confirm(en?'Delete this invoice from history?':'ইতিহাস থেকে ইনভয়েসটি মুছবেন?')){deleteInvoiceHistory(record.id);setRecords(readInvoiceHistory());}}} className="rounded p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4"/></button>
            </div></td></tr>)}
            {!visible.length && <tr><td colSpan={6} className="p-10 text-center text-slate-500">{en?'No saved invoices found.':'কোনো সংরক্ষিত ইনভয়েস নেই।'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </main>;
}
