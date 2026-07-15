import { useGetDashboardSummary, useGetBusinessSettings, useUpdateBusinessSettings } from '@workspace/api-client-react';
import { Building2, Wallet, ArrowRightLeft, Languages, TrendingUp, Users } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

export function DashboardView() {
  const { data: summary } = useGetDashboardSummary();
  const { data: settings } = useGetBusinessSettings();
  const updateSettings = useUpdateBusinessSettings();

  const handleLanguageChange = (lang: string) => {
    updateSettings.mutate({ data: { language: lang } }, {
      onSuccess: () => toast.success(`Language set to ${lang}`)
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50 overflow-y-auto w-full">
      <div className="p-12 max-w-5xl mx-auto w-full mt-8">
        <div className="flex items-center gap-5 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="w-20 h-20 bg-white border border-slate-200 shadow-sm rounded-2xl flex items-center justify-center text-primary">
            <Building2 className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
              {settings?.storeName || "Hazari Khatabook"}
            </h1>
            <p className="text-slate-500 font-medium text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              Your business dashboard
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both">
           <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-emerald-200 transition-colors">
             <div className="absolute -top-6 -right-6 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
               <ArrowRightLeft className="w-48 h-48 text-emerald-500" />
             </div>
             <p className="text-sm font-bold text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-2">
               <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> To Collect
             </p>
             <h2 className="text-5xl font-extrabold text-slate-900 mb-6 tracking-tight">{formatCurrency(summary?.youWillGet || 0)}</h2>
             <div className="inline-flex items-center px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-bold">
               <Users className="w-4 h-4 mr-2" />
               From {summary?.customerCount || 0} customers
             </div>
           </div>
           
           <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-red-200 transition-colors">
             <div className="absolute -top-6 -right-6 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
               <Wallet className="w-48 h-48 text-red-500" />
             </div>
             <p className="text-sm font-bold text-red-600 uppercase tracking-widest mb-3 flex items-center gap-2">
               <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span> To Pay
             </p>
             <h2 className="text-5xl font-extrabold text-slate-900 mb-6 tracking-tight">{formatCurrency(summary?.youWillGive || 0)}</h2>
             <div className="inline-flex items-center px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-bold">
               <Users className="w-4 h-4 mr-2" />
               To {summary?.supplierCount || 0} suppliers
             </div>
           </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both">
           <div className="flex items-center gap-3 mb-6">
             <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
               <Languages className="w-5 h-5 text-slate-600" />
             </div>
             <div>
               <h3 className="font-bold text-lg text-slate-900">App Language</h3>
               <p className="text-sm text-slate-500 font-medium">Choose your preferred language for bills and UI</p>
             </div>
           </div>
           <div className="grid grid-cols-3 gap-5">
             {["English", "Hindi", "Bengali"].map(lang => (
               <button
                 key={lang}
                 onClick={() => handleLanguageChange(lang)}
                 className={`p-5 rounded-2xl border-2 text-center transition-all ${
                   settings?.language === lang 
                     ? "border-primary bg-primary text-primary-foreground font-bold shadow-md transform scale-[1.02]" 
                     : "border-slate-100 hover:border-slate-300 bg-white text-slate-600 font-semibold hover:bg-slate-50"
                 }`}
               >
                 {lang}
               </button>
             ))}
           </div>
        </div>
      </div>
    </div>
  );
}
