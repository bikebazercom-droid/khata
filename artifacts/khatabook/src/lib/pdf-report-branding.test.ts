import { describe, expect, it } from "vitest";
import {
  fitPdfHeaderNameFontSize,
  renderPdfBrandLogo,
  renderPdfStoreBadges,
  renderPdfSupportContacts,
} from "./pdf-report-branding";

describe("PDF report branding", () => {
  it("links the logo only to a safe HTTPS website URL", () => {
    expect(renderPdfBrandLogo("https://banglakhata.example"))
      .toContain('href="https://banglakhata.example"');
    expect(renderPdfBrandLogo("javascript:alert(1)"))
      .not.toContain("<a ");
  });

  it("renders compact side-by-side store badges with their configured safe links", () => {
    const badges = renderPdfStoreBadges(
      "https://play.google.com/store/apps/details?id=app",
      "https://apps.apple.com/app/banglakhata/id123",
    );
    expect(badges).toContain('href="https://play.google.com/store/apps/details?id=app"');
    expect(badges).toContain('href="https://apps.apple.com/app/banglakhata/id123"');
    expect(badges).toContain("Google Play");
    expect(badges).toContain("App Store");
    expect(badges.match(/<a /g)).toHaveLength(2);
    expect(badges).toContain('width="112" height="34"');
  });

  it("keeps badges visible but non-clickable when links are not configured", () => {
    const badges = renderPdfStoreBadges("", "javascript:alert(1)");
    expect(badges).toContain("Google Play");
    expect(badges).toContain("App Store");
    expect(badges).not.toContain("<a ");
    expect(badges).toContain("<span");
  });

  it("renders clickable phone and email as compact footer text without a separate box", () => {
    const support = renderPdfSupportContacts("+880 1712-345678", "support@example.com");
    expect(support).toContain("font-size:9px");
    expect(support).not.toContain("background:");
    expect(support).not.toContain("border:");
    expect(support).toContain("color:#dbeafe");
    expect(support).toContain('href="tel:+8801712345678"');
    expect(support).toContain('href="mailto:support@example.com"');
    expect(support.match(/<tr>/g)).toHaveLength(2);
    expect(support).not.toContain("display:flex");
    expect(renderPdfSupportContacts("", "")).toBe("");
    expect(renderPdfSupportContacts("+৮৮০ ১৭১২-৩৪৫৬৭৮", ""))
      .toContain('href="tel:+8801712345678"');
  });

  it("reduces long ledger header names without forcing them to wrap", () => {
    expect(fitPdfHeaderNameFontSize("Hazari gold llc", 510, 20)).toBe(20);
    expect(fitPdfHeaderNameFontSize("হাজারি গোল্ড লিমিটেড".repeat(4), 510, 20))
      .toBeLessThan(20);
  });

  it("escapes setting values before placing them in PDF markup", () => {
    expect(renderPdfBrandLogo('https://example.com/?q="x"'))
      .toContain("&quot;x&quot;");
  });
});
