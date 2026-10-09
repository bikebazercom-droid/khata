import type jsPDF from "jspdf";

export interface PdfLinkSegment {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  href: string;
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Maps CSS-pixel link bounds to PDF millimeters, splitting links at page edges. */
export function splitPdfLinkRectIntoPages(
  linkRect: RectLike,
  containerRect: Pick<RectLike, "left" | "top" | "width">,
  href: string,
  pageWidthMm = 210,
  pageHeightMm = 297,
): PdfLinkSegment[] {
  if (
    !href ||
    !Number.isFinite(containerRect.width) ||
    containerRect.width <= 0 ||
    linkRect.width <= 0 ||
    linkRect.height <= 0
  ) return [];

  const scale = pageWidthMm / containerRect.width;
  const x = Math.max(0, (linkRect.left - containerRect.left) * scale);
  const right = Math.min(pageWidthMm, x + linkRect.width * scale);
  const top = Math.max(0, (linkRect.top - containerRect.top) * scale);
  const bottom = top + linkRect.height * scale;
  if (right <= x || bottom <= top) return [];

  const firstPage = Math.floor(top / pageHeightMm);
  const lastPage = Math.floor(Math.max(top, bottom - 0.001) / pageHeightMm);
  const segments: PdfLinkSegment[] = [];

  for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
    const pageTop = pageIndex * pageHeightMm;
    const segmentTop = Math.max(top, pageTop);
    const segmentBottom = Math.min(bottom, pageTop + pageHeightMm);
    if (segmentBottom <= segmentTop) continue;
    segments.push({
      pageIndex,
      x,
      y: segmentTop - pageTop,
      width: right - x,
      height: segmentBottom - segmentTop,
      href,
    });
  }

  return segments;
}

/** Adds clickable PDF annotations for links rendered inside a captured DOM element. */
export function addPdfLinkAnnotations(
  pdf: Pick<jsPDF, "link" | "setPage" | "getNumberOfPages">,
  element: HTMLElement,
  pageNumberOffset = 0,
): void {
  const containerRect = element.getBoundingClientRect();
  if (containerRect.width <= 0) return;

  const links = Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const anchor of links) {
    const href = anchor.href || anchor.getAttribute("href") || "";
    const segments = splitPdfLinkRectIntoPages(
      anchor.getBoundingClientRect(),
      containerRect,
      href,
    );

    for (const segment of segments) {
      const pageNumber = segment.pageIndex + pageNumberOffset + 1;
      if (pageNumber > pdf.getNumberOfPages()) continue;
      pdf.setPage(pageNumber);
      pdf.link(segment.x, segment.y, segment.width, segment.height, { url: segment.href });
    }
  }
}
