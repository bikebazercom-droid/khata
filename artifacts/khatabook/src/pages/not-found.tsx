import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-full bg-slate-50 w-full text-slate-800">
      <h1 className="text-4xl font-bold mb-4">৪০৪</h1>
      <p className="text-lg text-slate-600 mb-6">দুঃখিত! আপনি যে পৃষ্ঠাটি খুঁজছেন তা পাওয়া যায়নি।</p>
      <Link href="/" className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">
        হোমে ফিরে যান
      </Link>
    </div>
  );
}
