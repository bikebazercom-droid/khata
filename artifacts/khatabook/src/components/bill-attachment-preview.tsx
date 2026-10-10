import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { BillImageLightbox } from '@/components/modals/bill-image-lightbox';
import { toast } from 'sonner';

type Props = {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  style?: React.CSSProperties;
  imageStyle?: React.CSSProperties;
};

/** Keep image attachments as thumbnails; render documents as working file links. */
export function BillAttachmentPreview({
  src,
  alt = 'সংযুক্ত বিল',
  className,
  imageClassName,
  style,
  imageStyle,
}: Props) {
  const [kind, setKind] = useState<'loading' | 'image' | 'file'>('loading');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  useEffect(() => {
    setKind('loading');
  }, [src]);

  const label = /\.pdf(?:$|[?#])/i.test(src) ? 'PDF' : 'ফাইল';
  const closeDocument = () => {
    if (documentUrl) URL.revokeObjectURL(documentUrl);
    setDocumentUrl(null);
  };
  const openFile = async () => {
    if (isOpeningFile) return;
    setIsOpeningFile(true);
    try {
      const response = await fetch(src, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`ফাইল লোড ব্যর্থ হয়েছে (${response.status})`);
      }
      const blob = await response.blob();
      const contentType = (response.headers.get('content-type') || blob.type).split(';')[0].toLowerCase();
      const objectUrl = URL.createObjectURL(blob);
      if (contentType === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(src)) {
        setDocumentUrl(objectUrl);
      } else {
        const extension = contentType.includes('wordprocessingml') ? 'docx'
          : contentType.includes('spreadsheetml') ? 'xlsx'
          : contentType.includes('presentationml') ? 'pptx'
          : contentType === 'text/plain' ? 'txt'
          : contentType === 'text/csv' ? 'csv'
          : 'file';
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `attachment.${extension}`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (error) {
      console.error('লেনদেনের সংযুক্ত ফাইল খোলা যায়নি:', error);
      toast.error('ফাইলটি খোলা যায়নি', {
        description: 'ইন্টারনেট সংযোগ ও অনুমতি যাচাই করে আবার চেষ্টা করুন।',
      });
    } finally {
      setIsOpeningFile(false);
    }
  };

  return (
    <>
      {kind === 'file' ? (
        <button
          type="button"
          onClick={() => void openFile()}
          disabled={isOpeningFile}
          aria-label={`${label} খুলুন বা ডাউনলোড করুন`}
          title={`${label} খুলুন বা ডাউনলোড করুন`}
          className={`inline-flex items-center justify-center gap-1 overflow-hidden rounded-md border border-blue-100 bg-blue-50 px-1.5 py-1 text-[10px] font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-60 ${className ?? ''}`}
          style={style}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{isOpeningFile ? 'খুলছে…' : label}</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={kind !== 'image'}
          onClick={() => setLightboxOpen(true)}
          aria-label="বিলের ছবি দেখুন"
          className={`relative inline-flex items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 disabled:cursor-default ${className ?? ''}`}
          style={style}
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
      )}
      {kind === 'image' && lightboxOpen && (
        <BillImageLightbox src={src} onClose={() => setLightboxOpen(false)} />
      )}
      {documentUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PDF viewer"
          className="fixed inset-0 z-[95] flex flex-col bg-slate-950/90 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
        >
          <div className="mb-2 flex shrink-0 items-center justify-between text-white">
            <span className="text-sm font-bold">PDF</span>
            <div className="flex items-center gap-2">
              <a
                href={documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-white/15 px-3 py-2 text-xs font-bold"
              >
                নতুন ট্যাবে খুলুন
              </a>
              <button
                type="button"
                onClick={closeDocument}
                aria-label="PDF বন্ধ করুন"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <iframe
            title="সংযুক্ত PDF"
            src={documentUrl}
            className="min-h-0 flex-1 rounded-lg bg-white"
          />
        </div>
      )}
    </>
  );
}
