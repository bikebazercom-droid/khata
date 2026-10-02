import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BN_DAYS_COLUMNS, BN_DAYS_SHORT, BN_MONTHS, BN_MONTHS_SHORT, toBengaliDigits } from '@/lib/bengali-date';
import { cn } from '@/lib/utils';

export function BengaliCalendarModal({
  value,
  ariaLabel = 'তারিখ নির্বাচন করুন',
  onConfirm,
  onCancel,
  onClear,
}: {
  value: Date | null;
  ariaLabel?: string;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const today = new Date();
  const initialDate = value ?? today;
  const [tempDate, setTempDate] = useState<Date>(initialDate);
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<number | null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const previousMonth = () => {
    if (viewMonth === 0) {
      setViewYear((year) => year - 1);
      setViewMonth(11);
    } else {
      setViewMonth((month) => month - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((year) => year + 1);
      setViewMonth(0);
    } else {
      setViewMonth((month) => month + 1);
    }
  };

  const isSelected = (day: number) =>
    tempDate.getFullYear() === viewYear &&
    tempDate.getMonth() === viewMonth &&
    tempDate.getDate() === day;

  const isToday = (day: number) =>
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === day;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bg-[#1565C0] px-5 pb-6 pt-5 text-white">
          <p className="mb-1 text-[13px] font-medium opacity-70">{toBengaliDigits(tempDate.getFullYear())}</p>
          <p className="text-[28px] font-extrabold leading-none">
            {BN_DAYS_SHORT[tempDate.getDay()]}&nbsp;
            {toBengaliDigits(tempDate.getDate())}&nbsp;
            {BN_MONTHS_SHORT[tempDate.getMonth()]}
          </p>
        </div>

        <div className="flex items-center justify-between px-3 py-3">
          <button
            type="button"
            aria-label="আগের মাস"
            onClick={previousMonth}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="text-[15px] font-bold text-slate-800">
            {BN_MONTHS[viewMonth]} {toBengaliDigits(viewYear)}
          </p>
          <button
            type="button"
            aria-label="পরের মাস"
            onClick={nextMonth}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 px-3">
          {BN_DAYS_COLUMNS.map((day, index) => (
            <div
              key={`${day}-${index}`}
              className="py-1 text-center text-[13px] font-semibold text-slate-400"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 px-3 pb-2">
          {cells.map((day, index) => (
            <div key={index} className="flex items-center justify-center py-[3px]">
              {day !== null && (
                <button
                  type="button"
                  aria-label={`${toBengaliDigits(day)} ${BN_MONTHS[viewMonth]} ${toBengaliDigits(viewYear)}`}
                  aria-pressed={isSelected(day)}
                  onClick={() => setTempDate(new Date(viewYear, viewMonth, day))}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-medium transition-all active:scale-95',
                    isSelected(day)
                      ? 'bg-[#1565C0] font-bold text-white shadow-md'
                      : isToday(day)
                        ? 'border-2 border-[#1565C0] font-bold text-[#1565C0]'
                        : 'text-slate-800 hover:bg-slate-100 active:bg-slate-200',
                  )}
                >
                  {toBengaliDigits(day)}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col items-end gap-4 px-6 pb-5 pt-2">
          <button
            type="button"
            onClick={() => onConfirm(tempDate)}
            className="text-[14px] font-bold text-[#1565C0] transition-opacity active:opacity-60"
          >
            ঠিক আছে
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-[14px] font-bold text-[#1565C0] transition-opacity active:opacity-60"
          >
            বাতিল করুন
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-[14px] font-bold text-[#1565C0] transition-opacity active:opacity-60"
          >
            সরিয়ে দিন
          </button>
        </div>
      </div>
    </div>
  );
}