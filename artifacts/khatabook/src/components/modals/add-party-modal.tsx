import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateParty, PartyRole, BalanceType, getListPartiesQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(10, "Valid phone number required"),
  role: z.nativeEnum(PartyRole),
  openingBalance: z.coerce.number().optional(),
  openingBalanceType: z.nativeEnum(BalanceType).optional(),
});

export function AddPartyModal({ open, onOpenChange, defaultRole }: { open: boolean, onOpenChange: (open: boolean) => void, defaultRole: PartyRole }) {
  const queryClient = useQueryClient();
  const createParty = useCreateParty();
  
  const { register, handleSubmit, reset, formState: { errors }, watch, setValue } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      phone: "",
      role: defaultRole,
      openingBalance: 0,
      openingBalanceType: BalanceType.YOU_WILL_GET,
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createParty.mutate({ data: {
      ...data,
      openingBalance: data.openingBalance || undefined,
      openingBalanceType: data.openingBalance ? data.openingBalanceType : undefined
    }}, {
      onSuccess: () => {
        toast.success("সফলভাবে যুক্ত হয়েছে");
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        reset();
        onOpenChange(false);
      },
      onError: () => {
        toast.error("যুক্ত করা যায়নি");
      }
    });
  };

  const balanceType = watch("openingBalanceType");
  const currentRole = watch("role");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>নতুন {currentRole === PartyRole.CUSTOMER ? "কাস্টমার" : "সাপ্লায়ার"} যোগ করুন</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-2">
          <div>
            <label className="text-sm font-semibold mb-1.5 block text-slate-700">নাম</label>
            <Input {...register("name")} placeholder="নাম লিখুন" className="bg-slate-50 border-slate-200 focus-visible:ring-primary/30" />
            {errors.name && <p className="text-red-500 text-xs mt-1 font-medium">{errors.name.message}</p>}
          </div>
          <div>
            <label className="text-sm font-semibold mb-1.5 block text-slate-700">ফোন নম্বর</label>
            <Input {...register("phone")} placeholder="১০ ডিজিটের মোবাইল নম্বর" className="bg-slate-50 border-slate-200 focus-visible:ring-primary/30" />
            {errors.phone && <p className="text-red-500 text-xs mt-1 font-medium">{errors.phone.message}</p>}
          </div>
          <div>
            <label className="text-sm font-semibold mb-1.5 block text-slate-700">ধরন</label>
            <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
              <button 
                type="button" 
                onClick={() => setValue("role", PartyRole.CUSTOMER)} 
                className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${currentRole === PartyRole.CUSTOMER ? "bg-white shadow-sm text-primary" : "text-slate-500 hover:text-slate-700"}`}
              >
                কাস্টমার
              </button>
              <button 
                type="button" 
                onClick={() => setValue("role", PartyRole.SUPPLIER)} 
                className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${currentRole === PartyRole.SUPPLIER ? "bg-white shadow-sm text-primary" : "text-slate-500 hover:text-slate-700"}`}
              >
                সাপ্লায়ার
              </button>
            </div>
          </div>
          <div className="pt-4 border-t border-slate-100">
            <label className="text-sm font-semibold mb-2 block text-slate-700">শুরুর ব্যালেন্স (ঐচ্ছিক)</label>
            <div className="flex gap-3">
               <div className="relative flex-1">
                 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">৳</span>
                 <Input 
                   type="number" 
                   {...register("openingBalance")} 
                   placeholder="0" 
                   className="pl-8 bg-slate-50 border-slate-200 focus-visible:ring-primary/30 font-semibold" 
                 />
               </div>
               <select 
                 {...register("openingBalanceType")}
                 className={`flex-1 rounded-md border text-sm px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/20 transition-colors ${balanceType === BalanceType.YOU_WILL_GET ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}
               >
                 <option value={BalanceType.YOU_WILL_GET}>পাবেন</option>
                 <option value={BalanceType.YOU_WILL_GIVE}>দেবেন</option>
               </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-6 mt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="px-6 font-semibold">বাতিল</Button>
            <Button type="submit" disabled={createParty.isPending} className="px-8 font-bold shadow-md">
              {currentRole === PartyRole.CUSTOMER ? "কাস্টমার" : "সাপ্লায়ার"} সংরক্ষণ করুন
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
