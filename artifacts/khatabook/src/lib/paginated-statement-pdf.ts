import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

type StatementPage = {
  element: HTMLDivElement;
  main: HTMLElement;
  body: HTMLTableSectionElement;
  pageLabel: HTMLSpanElement;
  rowCount: number;
  units: HTMLTableRowElement[][];
};

/**
 * Keep date headings with the first transaction beneath them, and keep the
 * grand-total row with the final transaction. Other ledger rows remain
 * independently pageable.
 */
export function groupStatementRowsForPagination(
  rows: readonly HTMLTableRowElement[],
): HTMLTableRowElement[][] {
  const units: HTMLTableRowElement[][] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const kind = row.dataset.pdfKind;

    if (kind === 'total' && units.length > 0) {
      units[units.length - 1].push(row);
      continue;
    }

    if (kind === 'day' && rows[index + 1]?.dataset.pdfKind === 'entry') {
      units.push([row, rows[index + 1]]);
      index += 1;
      continue;
    }

    units.push([row]);
  }

  return units;
}

function createPage(
  doc: Document,
  renderHost: HTMLElement,
  sourceWindow: Window,
  header: Element,
  intro: Element,
  sourceTable: Element,
  tableHead: Element,
  footer: Element,
  includeIntro: boolean,
): StatementPage {
  const page = doc.createElement('div');
  page.className = 'statement-pdf-page statement-pdf-generated-page';

  const main = doc.createElement('main');
  main.className = 'statement-pdf-main';
  if (includeIntro) {
    const introCopy = doc.importNode(intro, true) as HTMLElement;
    copyComputedStyles(intro, introCopy, sourceWindow);
    main.append(introCopy);
  }

  const table = doc.importNode(sourceTable, false) as HTMLTableElement;
  copyComputedStyles(sourceTable, table, sourceWindow, new Set(['height', 'block-size']));
  const tableHeadCopy = doc.importNode(tableHead, true) as HTMLTableSectionElement;
  copyComputedStyles(tableHead, tableHeadCopy, sourceWindow);
  table.append(tableHeadCopy);
  const body = doc.createElement('tbody');
  table.append(body);
  main.append(table);

  const headerCopy = doc.importNode(header, true) as HTMLElement;
  const footerCopy = doc.importNode(footer, true) as HTMLElement;
  copyComputedStyles(header, headerCopy, sourceWindow);
  copyComputedStyles(footer, footerCopy, sourceWindow);
  const pageLabel = footerCopy.querySelector<HTMLSpanElement>('.statement-pdf-page-number');
  if (!pageLabel) throw new Error('স্টেটমেন্টের পৃষ্ঠা নম্বর তৈরি করা যায়নি।');

  page.append(headerCopy, main, footerCopy);
  renderHost.append(page);

  return { element: page, main, body, pageLabel, rowCount: 0, units: [] };
}

function copyComputedStyles(
  source: Element,
  target: Element,
  sourceWindow: Window,
  excludedProperties: ReadonlySet<string> = new Set(),
) {
  const computed = sourceWindow.getComputedStyle(source);
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    if (excludedProperties.has(property)) continue;
    (target as HTMLElement | SVGElement).style.setProperty(property, computed.getPropertyValue(property));
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) copyComputedStyles(child, targetChild, sourceWindow);
  });
}

function appendUnit(
  page: StatementPage,
  unit: readonly HTMLTableRowElement[],
  doc: Document,
  sourceWindow: Window,
) {
  const copies = unit.map((row) => {
    const copy = doc.importNode(row, true) as HTMLTableRowElement;
    copyComputedStyles(row, copy, sourceWindow);
    return copy;
  });
  page.body.append(...copies);
  page.rowCount += copies.length;
  page.units.push([...unit]);
  return copies;
}

function prependUnit(
  page: StatementPage,
  unit: readonly HTMLTableRowElement[],
  doc: Document,
  sourceWindow: Window,
) {
  const copies = unit.map((row) => {
    const copy = doc.importNode(row, true) as HTMLTableRowElement;
    copyComputedStyles(row, copy, sourceWindow);
    return copy;
  });
  const fragment = doc.createDocumentFragment();
  fragment.append(...copies);
  page.body.insertBefore(fragment, page.body.firstChild);
  page.rowCount += copies.length;
  page.units.unshift([...unit]);
  return copies;
}

function countEntryUnits(page: StatementPage) {
  return page.units.filter((unit) => unit.some((row) => row.dataset.pdfKind === 'entry')).length;
}

function balanceFinalPage(pages: StatementPage[], doc: Document, sourceWindow: Window) {
  if (pages.length < 2) return;

  const finalPage = pages[pages.length - 1];
  const previousPage = pages[pages.length - 2];
  while (countEntryUnits(finalPage) < 4 && countEntryUnits(previousPage) > 4) {
    const unit = previousPage.units[previousPage.units.length - 1];
    if (!unit) return;
    const rowsToMove = Array.from(previousPage.body.rows).slice(-unit.length);
    if (rowsToMove.length !== unit.length) return;

    rowsToMove.forEach((row) => row.remove());
    previousPage.units.pop();
    previousPage.rowCount -= unit.length;
    const movedRows = prependUnit(finalPage, unit, doc, sourceWindow);
    if (!pageFits(finalPage)) {
      movedRows.forEach((row) => row.remove());
      finalPage.units.shift();
      finalPage.rowCount -= movedRows.length;
      appendUnit(previousPage, unit, doc, sourceWindow);
      return;
    }
  }
}

function pageFits(page: StatementPage): boolean {
  return page.main.scrollHeight <= page.main.clientHeight + 1;
}

function waitForFrame(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    doc.defaultView?.requestAnimationFrame(() => resolve());
  });
}

async function renderPdfPages(sourceDoc: Document, renderDoc: Document): Promise<Blob> {
  const source = sourceDoc.querySelector<HTMLElement>('.statement-pdf-source');
  const header = source?.querySelector('.statement-pdf-header');
  const intro = source?.querySelector('.statement-pdf-intro');
  const tableHead = source?.querySelector('.statement-pdf-table thead');
  const tableBody = source?.querySelector<HTMLTableSectionElement>('.statement-pdf-table tbody');
  const footer = source?.querySelector('.statement-pdf-footer');
  const sourceWindow = sourceDoc.defaultView;
  const sourceTable = source?.querySelector('.statement-pdf-table');

  if (!source || !header || !intro || !sourceTable || !tableHead || !tableBody || !footer || !sourceWindow) {
    throw new Error('স্টেটমেন্ট PDF-এর পৃষ্ঠার কাঠামো পাওয়া যায়নি।');
  }

  const renderStyles = renderDoc.createElement('style');
  renderStyles.dataset.statementPdfStyles = 'true';
  renderStyles.textContent = `
    .statement-pdf-generated-page, .statement-pdf-generated-page * { box-sizing: border-box; }
    .statement-pdf-generated-page { position: absolute; left: 0; top: 0; width: 210mm; height: 297mm; padding: 8mm 10mm; background: #fff; display: flex; flex-direction: column; overflow: hidden; color: #1e293b; font-family: 'Noto Sans Bengali', sans-serif; }
    .statement-pdf-generated-page h1, .statement-pdf-generated-page h2, .statement-pdf-generated-page h3, .statement-pdf-generated-page p { margin-top: 0; }
    .statement-pdf-generated-page .statement-pdf-header { flex: 0 0 13mm; width: 100%; }
    .statement-pdf-generated-page .statement-pdf-main { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: hidden; padding-top: 4mm; }
    .statement-pdf-generated-page .statement-pdf-intro { flex: 0 0 auto; margin-bottom: 2mm; }
    .statement-pdf-generated-page .statement-pdf-table { width: 100%; flex: 0 0 auto; table-layout: fixed; border-collapse: collapse; font-size: 12px; margin-top: 3mm; }
    .statement-pdf-generated-page thead { display: table-header-group; }
    .statement-pdf-generated-page tr { break-inside: avoid; page-break-inside: avoid; }
    .statement-pdf-generated-page .statement-pdf-footer { flex: 0 0 auto; margin-top: 4mm; }
    .statement-pdf-generated-page .statement-pdf-meta { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #64748b; margin-bottom: 4px; }
    .statement-pdf-generated-page .statement-pdf-page-number { font-family: Arial, sans-serif; white-space: nowrap; }
  `;
  const renderHost = renderDoc.createElement('div');
  renderHost.dataset.statementPdfRenderHost = 'true';
  renderHost.style.cssText =
    'position:fixed;left:0;top:0;width:210mm;height:297mm;overflow:visible;opacity:0;pointer-events:none;z-index:-1;';
  renderDoc.head.append(renderStyles);
  renderDoc.body.append(renderHost);

  const sourceFont = sourceDoc.querySelector<HTMLLinkElement>(
    'link[href*="fonts.googleapis.com/css2?family=Noto+Sans+Bengali"]',
  );
  const renderFont = sourceFont ? renderDoc.createElement('link') : null;
  if (sourceFont && renderFont) {
    renderFont.rel = 'stylesheet';
    renderFont.href = sourceFont.href;
    renderFont.crossOrigin = 'anonymous';
    renderDoc.head.append(renderFont);
  }

  const pages: StatementPage[] = [];
  try {
    if (renderFont) {
      await Promise.race([
        new Promise<void>((resolve) => {
          renderFont.addEventListener('load', () => resolve(), { once: true });
          renderFont.addEventListener('error', () => resolve(), { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    const fontLoads = Promise.allSettled([
      renderDoc.fonts.load('400 16px "Noto Sans Bengali"'),
      renderDoc.fonts.load('600 16px "Noto Sans Bengali"'),
      renderDoc.fonts.load('700 16px "Noto Sans Bengali"'),
      renderDoc.fonts.load('900 16px "Noto Sans Bengali"'),
    ]);
    await Promise.race([
      Promise.all([renderDoc.fonts.ready, fontLoads]),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);

    const units = groupStatementRowsForPagination(Array.from(tableBody.rows));
    let currentPage = createPage(
      renderDoc,
      renderHost,
      sourceWindow,
      header,
      intro,
      sourceTable,
      tableHead,
      footer,
      true,
    );
    await waitForFrame(renderDoc);

    for (const unit of units) {
      const copies = appendUnit(currentPage, unit, renderDoc, sourceWindow);
      await waitForFrame(renderDoc);

      if (pageFits(currentPage)) continue;

      copies.forEach((row) => row.remove());
      currentPage.rowCount -= copies.length;
      currentPage.units.pop();

      if (currentPage.rowCount > 0) {
        pages.push(currentPage);
        currentPage = createPage(renderDoc, renderHost, sourceWindow, header, intro, sourceTable, tableHead, footer, false);
      } else if (pages.length === 0) {
        pages.push(currentPage);
        currentPage = createPage(renderDoc, renderHost, sourceWindow, header, intro, sourceTable, tableHead, footer, false);
      } else {
        currentPage.element.remove();
        throw new Error('একটি লেনদেনের সারি A4 পৃষ্ঠায় ফিট হচ্ছে না।');
      }

      appendUnit(currentPage, unit, renderDoc, sourceWindow);
      await waitForFrame(renderDoc);
      if (!pageFits(currentPage)) {
        currentPage.element.remove();
        throw new Error('একটি লেনদেনের সারি A4 পৃষ্ঠায় ফিট হচ্ছে না।');
      }
    }

    pages.push(currentPage);
    balanceFinalPage(pages, renderDoc, sourceWindow);
    source.remove();
    const pdf = new jsPDF('p', 'mm', 'a4');

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      page.pageLabel.textContent = `Page ${index + 1} of ${pages.length}`;
      await waitForFrame(renderDoc);
      const canvas = await html2canvas(page.element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: 820,
        windowHeight: 1200,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          const clonedHost = clonedDoc.querySelector<HTMLElement>('[data-statement-pdf-render-host]');
          if (clonedHost) clonedHost.style.opacity = '1';
        },
      });
      const image = canvas.toDataURL('image/jpeg', 0.97);
      if (index > 0) pdf.addPage();
      pdf.addImage(image, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      page.element.remove();
    }

    return pdf.output('blob');
  } finally {
    pages.forEach((page) => page.element.remove());
    renderHost.remove();
    renderStyles.remove();
    renderFont?.remove();
  }
}

/** Renders independently paginated A4 pages so no canvas slice can cut a row. */
export function generatePaginatedStatementPdf(html: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.title = 'Statement PDF renderer';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:none;';

    const cleanup = () => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    };

    document.body.append(iframe);
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      cleanup();
      reject(new Error('স্টেটমেন্ট PDF-এর ডকুমেন্ট খোলা যায়নি।'));
      return;
    }
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    const render = async () => {
      try {
        await waitForFrame(iframeDoc);
        resolve(await renderPdfPages(iframeDoc, document));
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };

    void render();
  });
}
