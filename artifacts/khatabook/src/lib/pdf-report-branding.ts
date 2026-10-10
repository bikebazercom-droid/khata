export interface PdfReportBranding {
  websiteUrl?: string | null;
  playStoreUrl?: string | null;
  appleStoreUrl?: string | null;
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

export function fitPdfCellFontSize(
  value: string,
  availableWidthPx: number,
  maxFontSizePx = 9,
  minFontSizePx = 6,
): number {
  const estimatedWidthEm = Array.from(value).reduce((width, character) => {
    if (character === ',' || character === '.') return width + 0.34;
    if (/\s/.test(character)) return width + 0.3;
    if (/[0-9]/.test(character)) return width + 0.58;
    if (/[\u0980-\u09ff]/.test(character)) return width + 0.72;
    return width + 0.62;
  }, 0);
  if (!estimatedWidthEm || !Number.isFinite(availableWidthPx) || availableWidthPx <= 0) {
    return maxFontSizePx;
  }
  return Math.max(minFontSizePx, Math.min(maxFontSizePx, availableWidthPx / estimatedWidthEm));
}

export function renderPdfBrandLogo(websiteUrl?: string | null): string {
  const label = '<span style="letter-spacing:0.5px;">📘 বাংলা খাতা</span>';
  const href = validHttpsUrl(websiteUrl);
  if (!href) return label;
  return `<a href="${escapePdfHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#fff;text-decoration:none;">${label}</a>`;
}

function renderStoreBadge(href: string | null, label: string, svg: string): string {
  const content = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="34" viewBox="0 0 112 34" role="img" aria-label="${escapePdfHtml(label)}">${svg}</svg>`;
  const style = "display:inline-block;width:112px;height:34px;vertical-align:middle;";
  return href
    ? `<a href="${escapePdfHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapePdfHtml(label)}" style="${style}">${content}</a>`
    : `<span aria-label="${escapePdfHtml(label)}" style="${style}">${content}</span>`;
}

export function renderPdfStoreBadges(
  playStoreUrl?: string | null,
  appleStoreUrl?: string | null,
): string {
  const playBadge = renderStoreBadge(
    validHttpsUrl(playStoreUrl),
    "Get it on Google Play",
    '<rect x="0.5" y="0.5" width="111" height="33" rx="4" fill="#050505" stroke="#A6A6A6"/><path d="M12 7.2c-.6.4-1 1.1-1 2v15.6c0 .9.4 1.6 1 2l9-9.8z" fill="#00D7FE"/><path d="m12 7.2 11.2 6.5-2.2 3.3-9-9.8z" fill="#00F076"/><path d="m12 26.8 11.2-6.5-2.2-3.3z" fill="#F5334A"/><path d="m21 17 2.2-3.3 4.1 2.4c1.2.7 1.2 1.8 0 2.5l-4.1 2.4L21 17z" fill="#FFD400"/><text x="34" y="13" fill="#fff" font-family="Arial,sans-serif" font-size="7">GET IT ON</text><text x="34" y="25" fill="#fff" font-family="Arial,sans-serif" font-size="12.5" font-weight="600">Google Play</text>',
  );
  const appleBadge = renderStoreBadge(
    validHttpsUrl(appleStoreUrl),
    "Download on the Apple App Store",
    '<rect x="0.5" y="0.5" width="111" height="33" rx="4" fill="#050505" stroke="#A6A6A6"/><path d="M19.6 15.8c0-2.1 1.7-3.1 1.8-3.2-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.9-1.5 0-2.9.9-3.6 2.2-1.6 2.8-.4 7 1.1 9.3.7 1.1 1.5 2.3 2.6 2.2 1 0 1.4-.7 2.8-.7 1.3 0 1.7.7 2.8.7 1.1 0 1.8-1 2.5-2.1.8-1.2 1.1-2.4 1.1-2.5-.1 0-2.2-.9-2.2-4.2zm-2.3-6.4c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.8-1.3z" transform="translate(2 1) scale(.82)" fill="#fff"/><text x="37" y="13" fill="#fff" font-family="Arial,sans-serif" font-size="7">Download on the</text><text x="37" y="25" fill="#fff" font-family="Arial,sans-serif" font-size="13" font-weight="600">App Store</text>',
  );
  return `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle;white-space:nowrap;">${playBadge}${appleBadge}</span>`;
}

export interface PdfSupportContactLink {
  href: string;
  label: string;
  kind: "phone" | "whatsapp" | "email";
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
    contacts.push({ href: `tel:${telTarget}`, label: `☎ ${phone}`, kind: "phone" });
    const whatsappDigits = safePhoneDigits.startsWith("0")
      ? `880${safePhoneDigits.slice(1)}`
      : safePhoneDigits;
    contacts.push({
      href: `https://wa.me/${whatsappDigits}`,
      label: "WhatsApp",
      kind: "whatsapp",
    });
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contacts.push({ href: `mailto:${email}`, label: `✉ ${email}`, kind: "email" });
  }
  return contacts;
}

export function renderPdfSupportContacts(
  supportPhone?: string | null,
  supportEmail?: string | null,
): string {
  const contacts = getPdfSupportContactLinks(supportPhone, supportEmail);
  if (!contacts.length) return "";

  const phone = contacts.find(({ kind }) => kind === "phone");
  const whatsapp = contacts.find(({ kind }) => kind === "whatsapp");
  const email = contacts.find(({ kind }) => kind === "email");
  const linkStyle = "color:#dbeafe;text-decoration:none;overflow-wrap:anywhere;word-break:break-word;";
  return `<table role="presentation" style="width:100%;max-width:80mm;margin-left:auto;border-collapse:collapse;border-spacing:0;color:#dbeafe;font-size:8px;line-height:1.2;text-align:right;"><tbody>${phone ? `<tr><td style="padding:0;text-align:right;vertical-align:top;white-space:nowrap;"><a href="${escapePdfHtml(phone.href)}" style="${linkStyle}">${escapePdfHtml(phone.label)}</a>${whatsapp ? `&nbsp;&nbsp;<a href="${escapePdfHtml(whatsapp.href)}" style="${linkStyle}">${escapePdfHtml(whatsapp.label)}</a>` : ""}</td></tr>` : ""}${email ? `<tr><td style="padding:3px 0 0;text-align:right;vertical-align:top;overflow-wrap:anywhere;"><a href="${escapePdfHtml(email.href)}" style="${linkStyle}">${escapePdfHtml(email.label)}</a></td></tr>` : ""}</tbody></table>`;
}
