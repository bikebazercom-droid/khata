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

export function renderPdfSupportBox(
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
      `<a href="tel:${escapePdfHtml(telTarget)}" style="color:#123b67;text-decoration:none;overflow-wrap:anywhere;">☎ ${escapePdfHtml(phone)}</a>`,
    );
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contacts.push(
      `<a href="mailto:${escapePdfHtml(email)}" style="color:#123b67;text-decoration:none;overflow-wrap:anywhere;">✉ ${escapePdfHtml(email)}</a>`,
    );
  }
  if (!contacts.length) return "";

  return `<div style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:3px;max-width:70mm;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;padding:5px 8px;margin-bottom:5px;color:#123b67;font-size:10px;line-height:1.35;">${contacts.join("")}</div>`;
}
