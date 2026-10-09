import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitPdfHeaderNameFontSize, renderPdfSupportContacts } from './pdf-report-branding';

const renderedPages = vi.hoisted(() => ({
  pages: [] as Array<{
    shopName: string;
    shopNameWhiteSpace: string;
    shopNameFontSize: number;
    rowCount: number;
    phoneHref: string | null;
    emailHref: string | null;
    phoneWrap: string;
    emailWrap: string;
    contactRowCount: number;
    termsText: string;
    termsSeparateFromContacts: boolean;
    pageLabel: string;
  }>,
}));

vi.mock('html2canvas', () => ({
  default: async (element: HTMLElement) => {
    const shopName = element.querySelector<HTMLElement>('.statement-pdf-shop-name');
    const footer = element.querySelector<HTMLElement>('.statement-pdf-footer');
    const footerBanner = footer?.querySelector<HTMLTableElement>('.statement-pdf-footer-banner');
    const supportCell = footerBanner?.rows[0]?.cells[1];
    const supportTable = supportCell?.querySelector<HTMLTableElement>('table');
    const phoneLink = supportTable?.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
    const emailLink = supportTable?.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    const terms = supportCell?.querySelector<HTMLElement>('.statement-pdf-terms');

    renderedPages.pages.push({
      shopName: shopName?.textContent?.trim() ?? '',
      shopNameWhiteSpace: shopName?.style.whiteSpace ?? '',
      shopNameFontSize: Number.parseFloat(shopName?.style.fontSize ?? ''),
      rowCount: element.querySelectorAll('.statement-pdf-table tbody tr').length,
      phoneHref: phoneLink?.getAttribute('href') ?? null,
      emailHref: emailLink?.getAttribute('href') ?? null,
      phoneWrap: phoneLink?.style.overflowWrap ?? '',
      emailWrap: emailLink?.style.overflowWrap ?? '',
      contactRowCount: supportTable?.querySelectorAll('tbody > tr').length ?? 0,
      termsText: terms?.textContent?.trim() ?? '',
      termsSeparateFromContacts: Boolean(terms && !supportTable?.contains(terms)),
      pageLabel: footer?.querySelector('.statement-pdf-page-number')?.textContent?.trim() ?? '',
    });

    return { toDataURL: () => 'data:image/jpeg;base64,bW9ja2Vk' };
  },
}));

vi.mock('jspdf', () => ({
  default: class MockJsPdf {
    private pages = 1;

    addPage() {
      this.pages += 1;
    }

    addImage() {}
    link() {}
    setPage() {}
    getNumberOfPages() {
      return this.pages;
    }
    output() {
      return new Blob(['mock statement PDF'], { type: 'application/pdf' });
    }
  },
}));

import { generatePaginatedStatementPdf, groupStatementRowsForPagination } from './paginated-statement-pdf';

const originalLayoutDescriptors = new Map<string, PropertyDescriptor | undefined>();

function installDeterministicPageLayout() {
  const prototype = HTMLElement.prototype;
  originalLayoutDescriptors.set('clientHeight', Object.getOwnPropertyDescriptor(prototype, 'clientHeight'));
  originalLayoutDescriptors.set('scrollHeight', Object.getOwnPropertyDescriptor(prototype, 'scrollHeight'));

  Object.defineProperty(prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('statement-pdf-main') ? 100 : 0;
    },
  });
  Object.defineProperty(prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains('statement-pdf-main')) return 0;
      const rows = this.querySelectorAll('.statement-pdf-table tbody tr').length;
      const introHeight = this.querySelector('.statement-pdf-intro') ? 20 : 0;
      return introHeight + rows * 40;
    },
  });
}

function restoreDeterministicPageLayout() {
  const prototype = HTMLElement.prototype;
  for (const property of ['clientHeight', 'scrollHeight']) {
    const descriptor = originalLayoutDescriptors.get(property);
    if (descriptor) Object.defineProperty(prototype, property, descriptor);
    else Reflect.deleteProperty(prototype, property);
  }
  originalLayoutDescriptors.clear();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function multiPageStatementHtml(shopName: string, supportPhone: string, supportEmail: string) {
  const fontSize = fitPdfHeaderNameFontSize(shopName, 440, 16);
  const rows = Array.from({ length: 7 }, (_, index) => `
    <tr data-pdf-kind="day"><td colspan="5">০${index + 1} অক্টোবর ২০২৬</td></tr>
    <tr data-pdf-kind="entry"><td>০${index + 1} অক্টোবর</td><td>লেনদেনের বিবরণ ${index + 1}</td><td>৳ ৫০০</td><td></td><td>৳ ৫০০</td></tr>
  `).join('');

  return `<!doctype html>
    <html><head><meta charset="utf-8"></head><body>
      <section class="statement-pdf-source">
        <table class="statement-pdf-header" style="width:100%;table-layout:fixed;border-collapse:collapse;background:#003366;color:#fff;">
          <tbody><tr>
            <td style="width:68%;padding:8px 12px;">
              <div class="statement-pdf-shop-name" style="font-size:${fontSize}px;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(shopName)}</div>
            </td>
            <td style="width:32%;text-align:right;white-space:nowrap;">বাংলা খাতা</td>
          </tr></tbody>
        </table>
        <div class="statement-pdf-intro">গ্রাহকের লেনদেন বিবরণী · ১ অক্টোবর - ৭ অক্টোবর ২০২৬</div>
        <table class="statement-pdf-table" style="width:100%;table-layout:fixed;border-collapse:collapse;">
          <thead><tr><th>তারিখ</th><th>বিবরণ</th><th>ডেবিট</th><th>ক্রেডিট</th><th>ব্যালেন্স</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="statement-pdf-footer">
          <div class="statement-pdf-meta"><span>বাংলা খাতা</span><span class="statement-pdf-page-number">Page 1 of 1</span></div>
          <table role="presentation" class="statement-pdf-footer-banner" style="width:100%;table-layout:fixed;border-collapse:collapse;background:#003366;color:#fff;">
            <tbody><tr>
              <td style="width:58%;padding:8px 12px;">এখনই বাংলা খাতা ব্যবহার শুরু করুন</td>
              <td style="width:42%;padding:8px 12px;text-align:right;color:#dbeafe;">
                ${renderPdfSupportContacts(supportPhone, supportEmail)}
                <div class="statement-pdf-terms" style="margin-top:3px;padding-top:3px;border-top:1px solid rgba(219,234,254,0.35);white-space:nowrap;">নিয়ম ও শর্তাবলী প্রযোজ্য</div>
              </td>
            </tr></tbody>
          </table>
        </div>
      </section>
    </body></html>`;
}

function row(kind: string): HTMLTableRowElement {
  const element = document.createElement('tr');
  element.dataset.pdfKind = kind;
  return element;
}

describe('statement PDF pagination units', () => {
  it('keeps a date heading with its first entry and the final total with the last entry', () => {
    const rows = [
      row('day'),
      row('entry'),
      row('entry'),
      row('total'),
    ];

    const units = groupStatementRowsForPagination(rows);

    expect(units.map((unit) => unit.map((item) => item.dataset.pdfKind))).toEqual([
      ['day', 'entry'],
      ['entry', 'total'],
    ]);
  });

  it('keeps an empty-state row as a complete pagination unit', () => {
    const emptyRow = row('empty');

    expect(groupStatementRowsForPagination([emptyRow])).toEqual([[emptyRow]]);
  });
});

describe('rendered multi-page statement branding', () => {
  afterEach(() => {
    restoreDeterministicPageLayout();
    renderedPages.pages = [];
    document.body.replaceChildren();
  });

  it.each([
    ['long Latin shop names', 'Hazari Gold LLC — Eastern Trading & Wholesale Division'],
    ['long Bangla shop names', 'হাজারি গোল্ড লিমিটেড, ব্যবসায়িক খাতা ও হিসাব বিভাগ'],
  ])('keeps %s and long support details readable on every generated page', async (_label, shopName) => {
    const supportPhone = '+880 1712-345678 ext. 9876543210';
    const supportEmail = 'statement-support-team-banglakhata-international-operations@example-support-domain.org';
    installDeterministicPageLayout();

    const pdf = await generatePaginatedStatementPdf(
      multiPageStatementHtml(shopName, supportPhone, supportEmail),
    );

    expect(pdf).toBeInstanceOf(Blob);
    expect(renderedPages.pages.length).toBeGreaterThan(1);
    expect(renderedPages.pages.map((page) => page.pageLabel)).toEqual(
      renderedPages.pages.map((_, index) => `Page ${index + 1} of ${renderedPages.pages.length}`),
    );
    expect(renderedPages.pages.every((page) => page.rowCount === 2)).toBe(true);
    expect(renderedPages.pages.every((page) => page.shopName === shopName)).toBe(true);
    expect(renderedPages.pages.every((page) => page.shopNameWhiteSpace === 'nowrap')).toBe(true);
    expect(renderedPages.pages.every((page) => page.shopNameFontSize < 16)).toBe(true);
    expect(renderedPages.pages.every((page) => page.phoneHref?.startsWith('tel:+880'))).toBe(true);
    expect(renderedPages.pages.every((page) => page.emailHref === `mailto:${supportEmail}`)).toBe(true);
    expect(renderedPages.pages.every((page) => page.contactRowCount === 2)).toBe(true);
    expect(renderedPages.pages.every((page) => page.phoneWrap === 'anywhere' && page.emailWrap === 'anywhere')).toBe(true);
    expect(renderedPages.pages.every((page) => page.termsText === 'নিয়ম ও শর্তাবলী প্রযোজ্য')).toBe(true);
    expect(renderedPages.pages.every((page) => page.termsSeparateFromContacts)).toBe(true);
  });
});
