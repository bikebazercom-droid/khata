import { UserPlus2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function AddStaffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus2 className="w-5 h-5 text-primary" /> স্টাফ যোগ করুন
          </DialogTitle>
        </DialogHeader>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-600 leading-relaxed">
          একাধিক স্টাফ নিজ নিজ অ্যাকাউন্ট দিয়ে লগইন করার সুবিধাটি এখনো তৈরি হচ্ছে। এটি প্রস্তুত হলে আপনি এখান থেকেই নতুন স্টাফ যোগ করতে পারবেন।
        </div>
        <Button variant="outline" className="w-full font-bold" onClick={() => onOpenChange(false)}>
          বুঝেছি
        </Button>
      </DialogContent>
    </Dialog>
  );
}
