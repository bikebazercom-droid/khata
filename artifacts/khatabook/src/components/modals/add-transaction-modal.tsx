import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateLedgerEntry, LedgerEntryType, getListLedgerEntriesQueryKey, getGetPartyQueryKey, getListPartiesQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FileText, Tag, CalendarClock } from "lucide-react";

const formSchema = z.object({
  amount: z.coerce.number().min(1, "পরিমাণ ০-এর বেশি হতে হবে"),
  description: z.string().optional(),
  billReference: z.string().optional(),
  dueDate: z.string().optional(),
});

export function AddTransactionModal({ partyId, type, open, onOpenChange }: { partyId: string, type: LedgerEntryType | null, open: boolean, onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const createEntry = useCreateLedgerEntry();
  
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { amount: 0, description: "", billReference: "", dueDate: "" }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (!type) return;
    createEntry.mutate({ partyId, data: { ...data, dueDate: data.dueDate || undefined, type } }, {
      onSuccess: () => {
        toast.success(`সফলভাবে যুক্ত হয়েছে: ৳${data.amount}`, {
          style: type === LedgerEntryType.YOU_GOT ? { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' } : { background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }
        });
        queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        reset();
        onOpenChange(false);
      },
      onError: () => {
        toast.error("লেনদেন সংরক্ষণ করা যায়নি");
      }
    });
  };

  const isGet = type === LedgerEntryType.YOU_GOT;

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if(!val) reset();
      onOpenChange(val);
    }}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-0 shadow-2xl bg-slate-50 gap-0">
        <div className={`px-6 py-5 text-white ${isGet ? 'bg-emerald-600' : 'bg-red-500'}`}>
          <DialogTitle className="text-white text-2xl font-bold tracking-tight mb-1">
            {isGet ? 'আপনি পেয়েছেন' : 'আপনি দিয়েছেন'}
          </DialogTitle>
          <p className="text-white/90 text-sm font-medium">এই লেনদেনটি এখনই সংরক্ষণ করুন</p>
        </div>
        
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block text-slate-500">পরিমাণ</label>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-3xl text-slate-400 font-medium group-focus-within:text-slate-600 transition-colors">৳</span>
              <Input 
                type="number" 
                {...register("amount")} 
                className="h-20 pl-12 text-4xl font-bold bg-white border-slate-200 shadow-sm rounded-xl focus-visible:ring-4 focus-visible:ring-primary/10 transition-all placeholder:text-slate-200" 
                placeholder="0"
                autoFocus
                step="any"
              />
            </div>
            {errors.amount && <p className="text-red-500 text-xs mt-2 font-medium">{errors.amount.message}</p>}
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5 text-slate-500">
                <FileText className="w-3.5 h-3.5" /> বিবরণ
              </label>
              <Input {...register("description")} placeholder="একটি নোট বা বিবরণ যুক্ত করুন (ঐচ্ছিক)" className="bg-white border-slate-200 focus-visible:ring-primary/20 h-11" />
            </div>
            
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5 text-slate-500">
                <Tag className="w-3.5 h-3.5" /> বিল নম্বর
              </label>
              <Input {...register("billReference")} placeholder="বিল/ইনভয়েস নম্বর (ঐচ্ছিক)" className="bg-white border-slate-200 focus-visible:ring-primary/20 h-11 uppercase" />
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5 text-slate-500">
                <CalendarClock className="w-3.5 h-3.5" /> পরিশোধের তারিখ
              </label>
              <Input type="date" {...register("dueDate")} className="bg-white border-slate-200 focus-visible:ring-primary/20 h-11" />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-14 bg-white border-slate-200 text-slate-600 font-bold hover:bg-slate-100 hover:text-slate-900 transition-all rounded-xl">
              বাতিল
            </Button>
            <Button 
              type="submit" 
              disabled={createEntry.isPending} 
              className={`flex-1 h-14 font-bold text-lg text-white shadow-[0_4px_14px_0_rgba(0,0,0,0.15)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.2)] transition-all rounded-xl border-none ${isGet ? 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-emerald-600/30' : 'bg-red-500 hover:bg-red-600 hover:shadow-red-500/30'}`}
            >
              সংরক্ষণ করুন
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
