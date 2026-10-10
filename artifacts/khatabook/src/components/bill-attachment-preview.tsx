import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { shareGeneratedFileWithNative } from '@/lib/native-file-export';

type Props = {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  style?: React.CSSProperties;
  imageStyle?: React.CSSProperties;
};

type OpenedAttachment = { url: string; contentType: string };

/** Fetch attachments with the current session, then preview only the in-memory blob URL. */
export function BillAttachmentPreview({
  src,
  alt = 'সংযুক্ত বিল',
  className,
  imageClassName,
  style,
  imageStyle,
}: Props) {
  const [kind, setKind] = useState<'loading' | 'image' | 'file'>('loading');
  const [openedAttachment, setOpenedAttachment] = useState<OpenedAttachment | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    setKind('loading');
  }, [src]);

  useEffect(() => {
    return () => {
      if (openedAttachment?.url) URL.revokeObjectURL(openedAttachment.url);
    };
  }, [openedAttachment]);

  const label = /\.pdf(?:$|[?#])/i.test(src) ? 'PDF' : 'ফাইল';

  const closePreview = () => setOpenedAttachment(null);

  const openAttachment = async () => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      const response = await fetch(src, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`Attachment request failed: ${response.status}`);

      const blob = await response.blob();
      const contentType = (response.headers.get('content-type') || blob.type || 'application/octet-stream')
        .split(';')[0].trim().toLowerCase();
      const url = URL.createObjectURL(blob);
      setOpenedAttachment({ url, contentType });
    } catch (error) {
      console.error('Could not open transaction attachment:', error);
      toast.error('ফাইলটি খোলা যায়নি', {
        description: 'ইন্টারনেট সংযোগ ও অ্যাকাউন্টের অনুমতি যাচাই করে আবার চেষ্টা করুন।',
      });
    } finally {
      setIsOpening(false);
    }
  };

  const shareAttachment = async (source = src) => {
    if (isSharing) return;
    setIsSharing(true);
    let tempUrl: string | null = null;
    try {
      const response = await fetch(source, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`Attachment request failed: ${response.status}`);
      const blob = await response.blob();
      const contentType = (response.headers.get('content-type') || blob.type || 'application/octet-stream')
        .split(';')[0].trim().toLowerCase();
      const extension = contentType === 'application/pdf' ? 'pdf'
        : contentType === 'image/jpeg' ? 'jpg'
        : contentType.startsWith('image/') ? contentType.split('/')[1] || 'img'
        : contentType === 'text/csv' ? 'csv'
        : contentType === 'text/plain' ? 'txt'
        : 'file';
      const fileName = `attachment.${extension}`;
      const nativeShare = await shareGeneratedFileWithNative(blob, {
        fileName,
        mimeType: contentType,
        title: 'সংযুক্ত ফাইল শেয়ার করুন',
      });
      if (nativeShare) return;

      const file = new File([blob], fileName, { type: contentType });
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'সংযুক্ত ফাইল শেয়ার করুন' });
        return;
      }

      tempUrl = URL.createObjectURL(blob);
      setOpenedAttachment({ url: tempUrl, contentType });
      tempUrl = null;
      toast.info('ফাইলটি খুলুন, তারপর ব্রাউজারের শেয়ার মেনু ব্যবহার করুন।');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Could not share transaction attachment:', error);
      toast.error('ফাইলটি শেয়ার করা যায়নি', {
        description: 'ইন্টারনেট সংযোগ ও অ্যাকাউন্টের অনুমতি যাচাই করে আবার চেষ্টা করুন।',
      });
    } finally {
      if (tempUrl) URL.revokeObjectURL(tempUrl);
      setIsSharing(false);
    }
  };

  const isOpenedImage = openedAttachment?.contentType.startsWith('image/');
  const isPdf = openedAttachment?.contentType === 'application/pdf';
  const preview = openedAttachment && createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isOpenedImage ? 'সংযুক্ত ছবি' : isPdf ? 'PDF viewer' : 'সংযুক্ত ফাইল'}
      className="fixed inset-0 z-[120] flex flex-col bg-slate-950/95 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white"
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <span className="truncate text-sm font-bold">
          {isOpenedImage ? 'সংযুক্ত ছবি' : isPdf ? 'PDF' : 'সংযুক্ত ফাইল'}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void shareAttachment(openedAttachment.url)}
            disabled={isSharing}
            aria-label="শেয়ার করুন"
            data-testid="attachment-share"
            className="flex h-9 items-center gap-1 rounded-lg bg-white/15 px-3 text-xs font-bold disabled:opacity-60"
          >
            <Share2 className="h-4 w-4" />
            {isSharing ? 'শেয়ার হচ্ছে…' : 'শেয়ার করুন'}
          </button>
          {!isOpenedImage && (
            <a
              href={openedAttachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white/15 px-3 py-2 text-xs font-bold"
            >
              নতুন ট্যাবে খুলুন
            </a>
          )}
          <button
            type="button"
            onClick={closePreview}
            aria-label="ফাইল বন্ধ করুন"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      {isOpenedImage ? (
        <img src={openedAttachment.url} alt={alt} className="min-h-0 flex-1 object-contain" />
      ) : (
        <iframe
          title={isPdf ? 'সংযুক্ত PDF' : 'সংযুক্ত ফাইল'}
          src={openedAttachment.url}
          className="min-h-0 flex-1 rounded-lg bg-white"
        />
      )}
    </div>,
    document.body,
  );

  return (
    <>
      {kind === 'file' ? (
        <div className="relative inline-flex" style={style}>
          <button
            type="button"
            onClick={() => void openAttachment()}
            disabled={isOpening}
            aria-label={`${label} খুলুন`}
            title={`${label} খুলুন`}
            className={`inline-flex items-center justify-center gap-1 overflow-hidden rounded-md border border-blue-100 bg-blue-50 py-1 pl-1.5 pr-8 text-[10px] font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-60 ${className ?? ''}`}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{isOpening ? 'খুলছে…' : label}</span>
          </button>
          <button
            type="button"
            onClick={() => void shareAttachment()}
            disabled={isSharing}
            aria-label="শেয়ার করুন"
            title="শেয়ার করুন"
            data-testid="attachment-share"
            className="absolute right-0 top-0 flex h-full w-8 items-center justify-center text-blue-800 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative inline-flex" style={style}>
          <button
            type="button"
            disabled={kind !== 'image' || isOpening}
            onClick={() => void openAttachment()}
            aria-label="বিলের ছবি দেখুন"
            className={`relative inline-flex items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 disabled:cursor-default ${className ?? ''}`}
          >
            {kind === 'loading' && <FileText className="h-4 w-4 text-slate-400" />}
            <img
              src={src}
              alt={alt}
              crossOrigin="anonymous"
              onLoad={() => setKind('image')}
              onError={() => setKind('file')}
              className={`${imageClassName ?? 'h-full w-full object-cover'} ${kind === 'loading' ? 'invisible absolute' : ''}`}
              style={imageStyle}
            />
          </button>
          <button
            type="button"
            onClick={() => void shareAttachment()}
            disabled={isSharing}
            aria-label="শেয়ার করুন"
            title="শেয়ার করুন"
            data-testid="attachment-share"
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      )}
      {preview}
    </>
  );
}
