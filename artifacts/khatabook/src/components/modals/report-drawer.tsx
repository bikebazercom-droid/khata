import { useGetDashboardSummary, useGetBusinessSettings } from '@workspace/api-client-react';
import { Printer, TrendingUp, TrendingDown, Users } from 'lucide-react';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';

export function ReportDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: summary } = useGetDashboardSummary();
  const { data: settings } = useGetBusinessSettings();

  const netBalance = (summary?.youWillGet || 0) - (summary?.youWillGive || 0);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-slate-600" /> হিসাবের সারসংক্ষেপ রিপোর্ট
          </DrawerTitle>
          <DrawerDescription>
            {format(new Date(), 'dd MMMM yyyy', { locale: bn })} পর্যন্ত সম্পূর্ণ হিসাব
          </DrawerDescription>
        </DrawerHeader>

        {/* Printable content */}
        <div className="print-report px-4 pb-4">
          <div className="hidden print:block mb-4">
            <h1 className="text-xl font-extrabold">{settings?.storeName || 'হাজারী খাতাবুক'}</h1>
            <p className="text-sm text-slate-500">
              রিপোর্ট তৈরির তারিখ: {format(new Date(), 'dd MMMM yyyy, hh:mm a', { locale: bn })}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-emerald-600/80 mb-1">
                <TrendingUp className="w-3.5 h-3.5" />
                <p className="text-[10px] font-bold uppercase tracking-widest">মোট পাবেন</p>
              </div>
              <p className="text-emerald-700 font-extrabold text-lg tracking-tight">
                {formatCurrency(summary?.youWillGet || 0)}
              </p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-red-500/80 mb-1">
                <TrendingDown className="w-3.5 h-3.5" />
                <p className="text-[10px] font-bold uppercase tracking-widest">মোট দেবেন</p>
              </div>
              <p className="text-red-600 font-extrabold text-lg tracking-tight">
                {formatCurrency(summary?.youWillGive || 0)}
              </p>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-600">নীট ব্যালেন্স</p>
            <p className={`text-lg font-extrabold tracking-tight ${netBalance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {formatCurrency(Math.abs(netBalance))} {netBalance >= 0 ? '(পাবেন)' : '(দেবেন)'}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="flex-1 flex justify-between text-sm font-semibold text-slate-600">
              <span>{summary?.customerCount ?? 0} জন কাস্টমার</span>
              <span>{summary?.supplierCount ?? 0} জন সাপ্লায়ার</span>
            </div>
          </div>
        </div>

        <div className="px-4 pb-8 print:hidden">
          <Button onClick={() => window.print()} className="w-full h-12 font-bold">
            <Printer className="w-4 h-4 mr-2" /> PDF ডাউনলোড / প্রিন্ট করুন
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
