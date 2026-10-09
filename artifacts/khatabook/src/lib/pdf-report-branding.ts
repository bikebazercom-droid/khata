export interface PdfReportBranding {
  websiteUrl?: string | null;
  playStoreUrl?: string | null;
  supportPhone?: string | null;
  supportEmail?: string | null;
}

function escapePdfHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validHttpsUrl(rawValue?: string | null): string | null {
  const value = rawValue?.trim() ?? "";
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return value;
  } catch {
    return null;
  }
}

function asciiPhoneNumber(value: string): string {
  const bengaliDigits = "০১২৩৪৫৬৭৮৯";
  return value.replace(/[০-৯]/g, (digit) => String(bengaliDigits.indexOf(digit)));
}

export function renderPdfBrandLogo(websiteUrl?: string | null): string {
  const label = '<span style="letter-spacing:0.5px;">📘 বাংলা খাতা</span>';
  const href = validHttpsUrl(websiteUrl);
  if (!href) return label;
  return `<a href="${escapePdfHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#fff;text-decoration:none;">${label}</a>`;
}

export function renderPdfInstallButton(playStoreUrl?: string | null): string {
  const href = validHttpsUrl(playStoreUrl);
  const style = "background:#fff;color:#003366;padding:4px 10px;font-weight:bold;border-radius:4px;text-decoration:none;display:inline-block;";
  return href
    ? `<a href="${escapePdfHtml(href)}" target="_blank" rel="noopener noreferrer" style="${style}">ইনস্টল করুন</a>`
    : `<span style="${style}">ইনস্টল করুন</span>`;
}

export function renderPdfSupportContacts(
  supportPhone?: string | null,
  supportEmail?: string | null,
): string {
  const phone = supportPhone?.trim() ?? "";
  const email = supportEmail?.trim() ?? "";
  const normalizedPhone = asciiPhoneNumber(phone);
  const safePhoneDigits = normalizedPhone.replace(/[^\d]/g, "");
  const contacts: string[] = [];

  if (safePhoneDigits) {
    const telTarget = normalizedPhone.startsWith("+")
      ? `+${safePhoneDigits}`
      : safePhoneDigits;
    contacts.push(
      `<a href="tel:${escapePdfHtml(telTarget)}" style="color:#dbeafe;text-decoration:none;overflow-wrap:anywhere;">☎ ${escapePdfHtml(phone)}</a>`,
    );
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contacts.push(
      `<a href="mailto:${escapePdfHtml(email)}" style="color:#dbeafe;text-decoration:none;overflow-wrap:anywhere;">✉ ${escapePdfHtml(email)}</a>`,
    );
  }
  if (!contacts.length) return "";

  return `<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;column-gap:10px;row-gap:1px;max-width:80mm;color:#dbeafe;font-size:9px;line-height:1.3;text-align:right;">${contacts.join("")}</div>`;
}
