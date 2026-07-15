import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export type ReportPeriod = 'ALL' | 'THIS_MONTH' | 'SINGLE_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'CUSTOM_RANGE';

const OPTIONS: { id: ReportPeriod; label: string }[] = [
  { id: 'ALL', label: 'সব' },
  { id: 'THIS_MONTH', label: 'এই মাসে' },
  { id: 'SINGLE_DAY', label: 'এক দিন' },
  { id: 'LAST_WEEK', label: 'গত সপ্তাহে' },
  { id: 'LAST_MONTH', label: 'গত মাসের' },
  { id: 'CUSTOM_RANGE', label: 'তারিখের পরিসর' },
];

export function ReportPeriodDrawer({
  open,
  onOpenChange,
  value,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ReportPeriod;
  onSelect: (period: ReportPeriod) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-base font-extrabold text-slate-900">রিপোর্ট সময়কাল নির্বাচন করুন</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-8">
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onSelect(option.id);
                onOpenChange(false);
              }}
              className="w-full flex items-center justify-between py-3.5 border-b border-slate-100 last:border-b-0 active:bg-slate-50 transition-colors"
            >
              <span className="text-[15px] font-semibold text-slate-800">{option.label}</span>
              <span
                className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                  value === option.id ? 'border-[#0b57d0] bg-[#0b57d0]' : 'border-slate-300'
                )}
              >
                {value === option.id && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
