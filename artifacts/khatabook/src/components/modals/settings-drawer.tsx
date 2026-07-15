import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
  type BusinessSettings,
} from '@workspace/api-client-react';
import { Languages } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';

export function SettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: settings } = useGetBusinessSettings();
  const queryClient = useQueryClient();
  // Optimistic update: the selected language pill highlights instantly via
  // the cache write in onMutate; a silent background write persists it,
  // rolling back quietly on failure.
  const updateSettings = useUpdateBusinessSettings({
    mutation: {
      onMutate: async ({ data }) => {
        const settingsKey = getGetBusinessSettingsQueryKey();
        const previousSettings = queryClient.getQueryData<BusinessSettings>(settingsKey);
        if (previousSettings) {
          queryClient.setQueryData<BusinessSettings>(settingsKey, { ...previousSettings, ...data });
        }
        return { settingsKey, previousSettings };
      },
      onError: (err, _vars, context) => {
        console.error('ভাষা পরিবর্তন ব্যর্থ হয়েছে, পরিবর্তন ফিরিয়ে নেওয়া হচ্ছে:', err);
        if (context) queryClient.setQueryData(context.settingsKey, context.previousSettings);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
      },
    },
  });

  const handleLanguageChange = (lang: string) => {
    updateSettings.mutate({ data: { language: lang } });
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
