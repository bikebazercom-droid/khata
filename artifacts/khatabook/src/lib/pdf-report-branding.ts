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

export function fitPdfHeaderNameFontSize(
  name: string,
  availableWidthPx: number,
  maxFontSizePx: number,
): number {
  const estimatedWidthEm = Array.from(name).reduce((width, character) => {
    if (/\s/.test(character)) return width + 0.32;
    if (/[\u0980-\u09ff]/.test(character)) return width + 0.92;
    if (/[ilI1.,'`!:;|]/.test(character)) return width + 0.34;
    if (/[MW@%&]/.test(character)) return width + 0.88;
    if (/[A-Z]/.test(character)) return width + 0.68;
    return width + 0.56;
  }, 0);

  if (!estimatedWidthEm || !Number.isFinite(availableWidthPx) || availableWidthPx <= 0) {
    return maxFontSizePx;
  }

  return Math.max(5, Math.min(maxFontSizePx, availableWidthPx / estimatedWidthEm));
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

export interface PdfSupportContactLink {
  href: string;
  label: string;
}

export function getPdfSupportContactLinks(
  supportPhone?: string | null,
  supportEmail?: string | null,
): PdfSupportContactLink[] {
  const phone = supportPhone?.trim() ?? "";
  const email = supportEmail?.trim() ?? "";
  const normalizedPhone = asciiPhoneNumber(phone);
  const safePhoneDigits = normalizedPhone.replace(/[^\d]/g, "");
  const contacts: PdfSupportContactLink[] = [];

  if (safePhoneDigits) {
    const telTarget = normalizedPhone.startsWith("+")
      ? `+${safePhoneDigits}`
      : safePhoneDigits;
    contacts.push({ href: `tel:${telTarget}`, label: `☎ ${phone}` });
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contacts.push({ href: `mailto:${email}`, label: `✉ ${email}` });
  }
  return contacts;
}

export function renderPdfSupportContacts(
  supportPhone?: string | null,
  supportEmail?: string | null,
): string {
  const contacts = getPdfSupportContactLinks(supportPhone, supportEmail);
  if (!contacts.length) return "";

  return `<table role="presentation" style="width:100%;max-width:80mm;margin-left:auto;border-collapse:collapse;border-spacing:0;color:#dbeafe;font-size:9px;line-height:1.4;text-align:right;"><tbody>${contacts.map(({ href, label }) => `<tr><td style="padding:0 0 2px;text-align:right;vertical-align:top;overflow-wrap:anywhere;"><a href="${escapePdfHtml(href)}" style="display:inline-block;max-width:100%;color:#dbeafe;text-decoration:none;overflow-wrap:anywhere;word-break:break-word;line-height:1.4;">${escapePdfHtml(label)}</a></td></tr>`).join("")}</tbody></table>`;
}
