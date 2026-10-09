import { describe, expect, it } from "vitest";
import { splitPdfLinkRectIntoPages } from "./pdf-link-annotations";

describe("splitPdfLinkRectIntoPages", () => {
  it("splits a link that crosses an A4 page boundary", () => {
    const segments = splitPdfLinkRectIntoPages(
      { left: 41, top: 320, width: 50, height: 20 },
      { left: 20, top: 30, width: 210 },
      "https://example.com",
    );

    expect(segments).toEqual([
      { pageIndex: 0, x: 21, y: 290, width: 50, height: 7, href: "https://example.com" },
      { pageIndex: 1, x: 21, y: 0, width: 50, height: 13, href: "https://example.com" },
    ]);
  });

  it("converts CSS pixels to millimeters and clamps link bounds to the page", () => {
    const segments = splitPdfLinkRectIntoPages(
      { left: 190, top: 25, width: 40, height: 10 },
      { left: 0, top: 0, width: 420 },
      "mailto:help@example.com",
    );

    expect(segments).toEqual([
      { pageIndex: 0, x: 95, y: 12.5, width: 20, height: 5, href: "mailto:help@example.com" },
    ]);
  });

  it("ignores links that cannot produce a visible PDF rectangle", () => {
    expect(splitPdfLinkRectIntoPages(
      { left: 0, top: 0, width: 0, height: 10 },
      { left: 0, top: 0, width: 210 },
      "https://example.com",
    )).toEqual([]);
  });
});
