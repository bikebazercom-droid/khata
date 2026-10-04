import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { playTransactionSuccessSound } from '@/lib/transaction-success-sound';

const ENTRY_SAVED_EVENT = 'banglakhata:entry-saved';
const FEEDBACK_DURATION_MS = 640;

export function notifyEntrySaved() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ENTRY_SAVED_EVENT));
    playTransactionSuccessSound();
  }
}

export function EntrySavedFeedbackHost() {
  const [visible, setVisible] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const showFeedback = () => {
      window.clearTimeout(timeoutRef.current);
      setAnimationKey((key) => key + 1);
      setVisible(true);
      timeoutRef.current = window.setTimeout(() => {
        setVisible(false);
      }, FEEDBACK_DURATION_MS);
    };

    window.addEventListener(ENTRY_SAVED_EVENT, showFeedback);
    return () => {
      window.removeEventListener(ENTRY_SAVED_EVENT, showFeedback);
      window.clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!visible) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center">
      <div
        key={animationKey}
        role="status"
        aria-label="হিসাব সংরক্ষণ হয়েছে"
        data-testid="entry-save-success-check"
        className="entry-saved-checkmark flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg"
      >
        <Check aria-hidden="true" className="h-9 w-9" strokeWidth={3} />
      </div>
    </div>,
    document.body,
  );
}