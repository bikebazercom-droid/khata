import { useGetBusinessSettings, useUpdateBusinessSettings } from '@workspace/api-client-react';
import { Languages } from 'lucide-react';
import { toast } from 'sonner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';

export function SettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: settings } = useGetBusinessSettings();
  const updateSettings = useUpdateBusinessSettings();

  const handleLanguageChange = (lang: string) => {
    updateSettings.mutate(
      { data: { language: lang } },
      { onSuccess: () => toast.success(`ভাষা সেট করা হয়েছে: ${lang}`) }
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-slate-600" /> সিস্টেম ভাষা
          </DrawerTitle>
          <DrawerDescription>বিল ও ইন্টারফেসের জন্য আপনার পছন্দের ভাষা বেছে নিন</DrawerDescription>
        </DrawerHeader>
        <div className="grid grid-cols-3 gap-3 px-4 pb-8">
          {['বাংলা', 'English', 'हिंदी'].map((lang) => (
            <button
              key={lang}
              onClick={() => handleLanguageChange(lang)}
              className={`p-4 rounded-2xl border-2 text-center transition-all active:scale-95 ${
                settings?.language === lang
                  ? 'border-primary bg-primary text-primary-foreground font-bold shadow-md'
                  : 'border-slate-100 bg-white text-slate-600 font-semibold'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
