import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Full-screen in-app camera capture view built on `getUserMedia`. Used as the
 * primary capture path when the browser supports it; the caller is
 * responsible for falling back to a native `<input type="file" capture>`
 * picker via `onError` when the browser/permissions don't allow it.
 */
export function CameraCaptureModal({
  onCapture,
  onClose,
  onError,
}: {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status === 'error') onError();
  }, [status, onError]);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    onCapture(canvas.toDataURL('image/jpeg', 0.95));
  };

  if (status === 'error') return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+var(--safe-top))] shrink-0">
        <button
          type="button"
          onClick={onClose}
          aria-label="বন্ধ করুন"
          className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-white text-sm font-semibold">বিলের ছবি তুলুন</p>
        <div className="w-9" />
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        {status === 'loading' && <p className="absolute text-white/80 text-sm font-medium">ক্যামেরা চালু হচ্ছে...</p>}
        <div className="absolute inset-6 border-2 border-dashed border-white/40 rounded-2xl pointer-events-none" />
      </div>

      <div className="pt-6 pb-[calc(1.5rem+var(--safe-bottom))] flex items-center justify-center shrink-0">
        <button
          type="button"
          onClick={handleCapture}
          disabled={status !== 'ready'}
          aria-label="ছবি তুলুন"
          className="w-16 h-16 rounded-full bg-white border-4 border-white/30 active:scale-95 transition-transform disabled:opacity-40"
        />
      </div>
    </div>
  );
}
