import { ChevronRight, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LedgerBookHeaderProps {
  bookName: string;
  isOwner: boolean;
  onOpenSwitcher: () => void;
  onRename: () => void;
}

export function LedgerBookHeader({
  bookName,
  isOwner,
  onOpenSwitcher,
  onRename,
}: LedgerBookHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
      <img
        src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/logo-icon.svg`}
        alt="Banglakhata"
        className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
      />
      <button
        type="button"
        onClick={isOwner ? onOpenSwitcher : undefined}
        className={cn(
          'flex min-w-0 flex-1 flex-row items-center gap-1 transition-opacity sm:gap-1.5',
          isOwner ? 'active:opacity-75' : '',
        )}
        aria-label={bookName || 'বাংলা খাতা'}
        title={bookName || undefined}
        data-testid="active-book-switcher"
      >
        <h1
          className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] text-left font-extrabold leading-tight tracking-tight text-[12px] text-white sm:text-[15px]"
          data-testid="active-book-name"
        >
          {bookName}
        </h1>
        {isOwner && (
          <ChevronRight className="h-3 w-3 shrink-0 rotate-90 text-white/60 sm:h-3.5 sm:w-3.5" />
        )}
      </button>
      {isOwner && (
        <button
          type="button"
          onClick={onRename}
          aria-label="দোকানের নাম সম্পাদনা করুন"
          data-testid="business-book-rename"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white/60 transition-all active:bg-white/15 active:text-white sm:h-6 sm:w-6"
        >
          <Pencil className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        </button>
      )}
    </div>
  );
}
