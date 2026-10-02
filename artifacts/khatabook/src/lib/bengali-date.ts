const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBengaliDigits(value: number): string {
  return String(value)
    .split('')
    .map((digit) => BN_DIGITS[Number(digit)] ?? digit)
    .join('');
}

export const BN_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

export const BN_MONTHS_SHORT = [
  'জান.', 'ফেব.', 'মার.', 'এপ্রি.', 'মে', 'জুন',
  'জুল.', 'আগ.', 'সেপ.', 'অক্টো.', 'নভে.', 'ডিসে.',
];

export const BN_DAYS_COLUMNS = ['র', 'সো', 'ম', 'বু', 'বৃ', 'শু', 'শ'];
export const BN_DAYS_SHORT = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];

export function formatBengaliDateInput(date: Date): string {
  return `${toBengaliDigits(date.getDate())} ${BN_MONTHS_SHORT[date.getMonth()]} ${toBengaliDigits(date.getFullYear())}`;
}