import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, ImagePlus, Save } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type Profile = { company: string; address: string; phone: string; email: string; trn: string; website: string; locationUrl: string; logo: string };
const businessId = () => localStorage.getItem('selected_business_id') || 'default';
const profileKey = () => `banglakhata_business_invoice_profile_v1:${businessId()}`;
const stampKey = () => `banglakhata_gold_invoice_stamp_v1:${businessId()}`;
const blank: Profile = { company: '', address: '', phone: '', email: '', trn: '', website: '', locationUrl: '', logo: '' };
function readProfile(): Profile {
  try { return { ...blank, ...JSON.parse(localStorage.getItem(profileKey()) || '{}') }; } catch { return blank; }
}
function readDataUrl(file: File, max: number): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > max) return Promise.reject(new Error('Choose a PNG, JPG, or WebP image within the size limit.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

export function BusinessProfile() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [profile, setProfile] = useState<Profile>(readProfile);
  const [stamp, setStamp] = useState(() => { try { return localStorage.getItem(stampKey()) || ''; } catch { return ''; } });
  const label = (key: keyof Profile, title: string, type = 'text') => <label key={key} className="block text-sm font-semibold text-slate-600">{title}<input data-testid={`input-business-profile-${key}`} type={type} value={profile[key]} onChange={(e) => setProfile((old) => ({ ...old, [key]: e.target.value }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>;
  const upload = async (file: File | undefined, kind: 'logo' | 'stamp') => {
    if (!file) return;
    try {
      const value = await readDataUrl(file, kind === 'logo' ? 8 * 1024 * 1024 : 5 * 1024 * 1024);
      if (kind === 'logo') setProfile((old) => ({ ...old, logo: value }));
      else setStamp(value);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not read image.'); }
  };
  const save = () => {
    try {
      localStorage.setItem(profileKey(), JSON.stringify(profile));
      if (stamp) localStorage.setItem(stampKey(), stamp);
      else localStorage.removeItem(stampKey());
      toast.success(en ? 'Business profile saved.' : 'ব্যবসার প্রোফাইল সংরক্ষণ হয়েছে।');
    } catch { toast.error(en ? 'Could not save business profile.' : 'ব্যবসার প্রোফাইল সংরক্ষণ করা যায়নি।'); }
  };
  return <div className="h-full overflow-y-auto bg-slate-50 px-4 py-5 pb-8 md:px-8">
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-800"><Building2 className="h-5 w-5" /></span><div><h2 className="text-xl font-bold text-slate-900">{en ? 'Business Profile' : 'বিজনেস প্রোফাইল'}</h2><p className="text-sm text-slate-500">{en ? 'Saved details are reused on future invoices.' : 'সংরক্ষিত তথ্য ভবিষ্যতের ইনভয়েসে ব্যবহার হবে।'}</p></div></div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {label('company', en ? 'Shop name' : 'দোকানের নাম')}
          {label('phone', en ? 'Phone' : 'ফোন', 'tel')}
          <label className="block text-sm font-semibold text-slate-600 sm:col-span-2">{en ? 'Address' : 'ঠিকানা'}<textarea value={profile.address} onChange={(e) => setProfile((old) => ({ ...old, address: e.target.value }))} rows={3} className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>
          {label('email', en ? 'Email' : 'ইমেইল', 'email')}
          {label('trn', 'TRN')}
          {label('website', en ? 'Website' : 'ওয়েবসাইট', 'url')}
          {label('locationUrl', en ? 'Location URL / QR link' : 'অবস্থানের লিংক / QR', 'url')}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 text-sm font-semibold text-slate-700"><ImagePlus className="h-4 w-4" />{en ? 'Upload logo' : 'লোগো আপলোড'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0], 'logo'); e.currentTarget.value = ''; }} /></label>
          <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 text-sm font-semibold text-slate-700"><ImagePlus className="h-4 w-4" />{en ? 'Upload company stamp' : 'কোম্পানির সিল আপলোড'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0], 'stamp'); e.currentTarget.value = ''; }} /></label>
        </div>
        {(profile.logo || stamp) && <div className="mt-4 flex flex-wrap items-center gap-4">{profile.logo && <img src={profile.logo} alt={en ? 'Business logo' : 'ব্যবসার লোগো'} className="h-16 max-w-40 object-contain" />}{stamp && <img src={stamp} alt={en ? 'Company stamp' : 'কোম্পানির সিল'} className="h-16 max-w-40 object-contain" />}</div>}
        <div className="mt-6 flex justify-end"><button type="button" data-testid="button-business-profile-save" onClick={save} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#1B3A6B] px-5 text-sm font-bold text-white active:scale-[.98]"><Save className="h-4 w-4" />{en ? 'Save Business Profile' : 'ব্যবসার প্রোফাইল সংরক্ষণ'}</button></div>
      </section>
    </div>
  </div>;
}
