import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { BillImageLightbox } from '@/components/modals/bill-image-lightbox';

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

  useEffect(() => {
    setKind('loading');
  }, [src]);

  const label = /\.pdf(?:$|[?#])/i.test(src) ? 'PDF' : 'ফাইল';

  return (
    <>
      {kind === 'file' ? (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          download
          aria-label={`${label} খুলুন বা ডাউনলোড করুন`}
          title={`${label} খুলুন বা ডাউনলোড করুন`}
          className={`inline-flex items-center justify-center gap-1 overflow-hidden rounded-md border border-blue-100 bg-blue-50 px-1.5 py-1 text-[10px] font-bold text-blue-800 hover:bg-blue-100 ${className ?? ''}`}
          style={style}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </a>
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
    </>
  );
}
