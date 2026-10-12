import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export type ReportPeriod = 'ALL' | 'THIS_MONTH' | 'SINGLE_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'CUSTOM_RANGE';

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
  const { t } = useLanguage();
  const options: { id: ReportPeriod; label: string }[] = [
    { id: 'ALL', label: t('all') },
    { id: 'THIS_MONTH', label: t('thisMonth') },
    { id: 'SINGLE_DAY', label: t('oneDay') },
    { id: 'LAST_WEEK', label: t('lastWeek') },
    { id: 'LAST_MONTH', label: t('lastMonth') },
    { id: 'CUSTOM_RANGE', label: t('dateRange') },
  ];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-base font-extrabold text-slate-900">{t('reportPeriod')}</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-8">
          {options.map((option) => (
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
