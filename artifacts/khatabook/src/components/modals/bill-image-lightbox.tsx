import { X } from 'lucide-react';

/**
 * Full-screen lightbox for viewing a scanned bill/receipt image at full
 * resolution. Mobile browsers already support pinch-to-zoom on an
 * `overflow-auto` image container, so no custom zoom logic is needed.
 */
export function BillImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[90] bg-black/90 flex flex-col animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+var(--safe-top))] shrink-0">
        <span className="text-white text-sm font-semibold">সংযুক্ত বিল</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="বন্ধ করুন"
          className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="সংযুক্ত বিলের ছবি" className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg" />
      </div>

      <div className="pt-2 pb-[calc(1.5rem+var(--safe-bottom))] flex items-center justify-center shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-6 h-11 rounded-xl bg-white/10 text-white text-sm font-bold active:scale-95 transition-transform"
        >
          বন্ধ করুন
        </button>
      </div>
    </div>
  );
}
