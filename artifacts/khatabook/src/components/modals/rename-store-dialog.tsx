import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
  type BusinessSettings,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RenameStoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: settings } = useGetBusinessSettings();
  const queryClient = useQueryClient();
  // Optimistic update: onMutate writes the new name into the settings
  // cache synchronously (every screen showing the store name updates in
  // the same tick); onError rolls it back silently on failure; onSettled
  // reconciles with the server in the background.
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
        console.error('দোকানের নাম পরিবর্তন ব্যর্থ হয়েছে, পরিবর্তন ফিরিয়ে নেওয়া হচ্ছে:', err);
        if (context) queryClient.setQueryData(context.settingsKey, context.previousSettings);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
      },
    },
  });
  const [name, setName] = useState('');
  const [isEmptyError, setIsEmptyError] = useState(false);

  useEffect(() => {
    if (open) {
      setName(settings?.storeName || 'হাজারী খাতাবুক');
      setIsEmptyError(false);
    }
  }, [open, settings?.storeName]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      // Inline validation only — no toast for something the user can see
      // and fix right here on the field.
      setIsEmptyError(true);
      return;
    }
    // Optimistic UI: close the dialog instantly, the cache update in
    // onMutate above already reflects the new name everywhere.
    onOpenChange(false);
    updateSettings.mutate({ data: { storeName: trimmed } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" /> দোকানের নাম সম্পাদনা করুন
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setIsEmptyError(false);
          }}
          placeholder="দোকানের নাম লিখুন"
          className={cn('h-12 rounded-xl font-bold text-base', isEmptyError && 'border-red-400 focus-visible:ring-red-300')}
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
        />
        {isEmptyError && <p className="text-xs font-semibold text-red-500 -mt-2">দোকানের নাম খালি রাখা যাবে না</p>}
        <Button className="w-full font-bold h-11 rounded-xl" onClick={handleSave}>
          সেভ করুন
        </Button>
      </DialogContent>
    </Dialog>
  );
}
