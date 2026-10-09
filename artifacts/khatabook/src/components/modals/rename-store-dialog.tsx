import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
  type BusinessSettings,
} from '@workspace/api-client-react';
import type { MeResponse } from '@/lib/phoneAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RenameStoreDialog({
  open,
  onOpenChange,
  isOnboarding = false,
  businessId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOnboarding?: boolean;
  businessId?: string;
}) {
  const { selectedBusinessId, businesses, setBusinesses } = useBusinessContext();
  const activeBusinessId = businessId ?? selectedBusinessId;
  const activeBusiness = businesses.find((item) => item.id === activeBusinessId);
  const { data: settings } = useGetBusinessSettings({
    query: { queryKey: businessScopedQueryKey(getGetBusinessSettingsQueryKey(), activeBusinessId) },
  });
  const queryClient = useQueryClient();
  const updateSettings = useUpdateBusinessSettings({
    mutation: {
      onMutate: async ({ data }) => {
        const settingsKey = businessScopedQueryKey(getGetBusinessSettingsQueryKey(), activeBusinessId);
        const previousSettings = queryClient.getQueryData<BusinessSettings>(settingsKey);
        if (previousSettings) {
          queryClient.setQueryData<BusinessSettings>(settingsKey, { ...previousSettings, ...data });
        }
        const previousBusinesses = businesses;
        if (data.storeName !== undefined && activeBusinessId) {
          setBusinesses(businesses.map((item) =>
            item.id === activeBusinessId ? { ...item, name: data.storeName! } : item,
          ));
        }
        return { settingsKey, previousSettings, previousBusinesses };
      },
      onError: (err, _vars, context) => {
        console.error('খাতার নাম পরিবর্তন ব্যর্থ হয়েছে, পরিবর্তন ফিরিয়ে নেওয়া হচ্ছে:', err);
        if (context) {
          queryClient.setQueryData(context.settingsKey, context.previousSettings);
          setBusinesses(context.previousBusinesses);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
      },
    },
  });
  const [name, setName] = useState('');
  const [isEmptyError, setIsEmptyError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(isOnboarding ? '' : (activeBusiness?.name || settings?.storeName || 'Banglakhata'));
      setIsEmptyError(false);
      setSaveError('');
    }
  }, [open, isOnboarding, activeBusiness?.name, settings?.storeName]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isOnboarding && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setIsEmptyError(true);
      return;
    }
    setSaveError('');
    if (isOnboarding) {
      setIsSaving(true);
      try {
        await updateSettings.mutateAsync({ data: { storeName: trimmed } });
        queryClient.setQueriesData<MeResponse>({ queryKey: ['auth-me'] }, (current) =>
          current ? { ...current, businessName: trimmed, needsBookName: false } : current,
        );
        onOpenChange(false);
      } catch {
        setSaveError('খাতার নাম সংরক্ষণ করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।');
      } finally {
        setIsSaving(false);
      }
      return;
    }
    onOpenChange(false);
    updateSettings.mutate({ data: { storeName: trimmed } });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('max-w-sm rounded-2xl', isOnboarding && '[&>button:last-child]:hidden')}
        onEscapeKeyDown={isOnboarding ? (event) => event.preventDefault() : undefined}
        onPointerDownOutside={isOnboarding ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            {isOnboarding ? 'আপনার খাতার নাম লিখুন' : 'খাতার নাম সম্পাদনা করুন'}
          </DialogTitle>
          {isOnboarding && (
            <p className="pt-2 text-sm leading-relaxed text-slate-500">
              এই নামটি আপনার প্রথম ও প্রধান ব্যবসার খাতা হিসেবে সংরক্ষণ হবে।
            </p>
          )}
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setIsEmptyError(false);
            setSaveError('');
          }}
          placeholder={isOnboarding ? 'যেমন: শাকিল ট্রেডার্স' : 'খাতার নাম লিখুন'}
          className={cn('h-12 rounded-xl font-bold text-base', isEmptyError && 'border-red-400 focus-visible:ring-red-300')}
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
        {isEmptyError && <p className="text-xs font-semibold text-red-500 -mt-2">খাতার নাম খালি রাখা যাবে না</p>}
        {saveError && <p role="alert" className="text-xs font-semibold text-red-600 -mt-2">{saveError}</p>}
        <Button className="w-full font-bold h-11 rounded-xl" onClick={() => void handleSave()} disabled={isSaving}>
          {isOnboarding ? (isSaving ? 'সংরক্ষণ হচ্ছে…' : 'খাতা তৈরি করুন') : 'সেভ করুন'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
