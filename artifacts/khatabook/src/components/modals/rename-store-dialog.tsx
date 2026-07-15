import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useGetBusinessSettings, useUpdateBusinessSettings } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function RenameStoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: settings } = useGetBusinessSettings();
  const updateSettings = useUpdateBusinessSettings();
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) {
      setName(settings?.storeName || 'হাজারী খাতাবুক');
    }
  }, [open, settings?.storeName]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('দোকানের নাম খালি রাখা যাবে না');
      return;
    }
    updateSettings.mutate(
      { data: { storeName: trimmed } },
      {
        onSuccess: () => {
          toast.success('দোকানের নাম পরিবর্তন করা হয়েছে');
          onOpenChange(false);
        },
        onError: () => toast.error('নাম পরিবর্তন করা যায়নি'),
      }
    );
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
          onChange={(e) => setName(e.target.value)}
          placeholder="দোকানের নাম লিখুন"
          className="h-12 rounded-xl font-bold text-base"
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
        />
        <Button
          className="w-full font-bold h-11 rounded-xl"
          onClick={handleSave}
          disabled={updateSettings.isPending}
        >
          {updateSettings.isPending ? 'সেভ হচ্ছে...' : 'সেভ করুন'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
