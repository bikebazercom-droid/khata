import { describe, expect, it } from "vitest";
import {
  renderPdfBrandLogo,
  renderPdfInstallButton,
  renderPdfSupportBox,
} from "./pdf-report-branding";

describe("PDF report branding", () => {
  it("links the logo only to a safe HTTPS website URL", () => {
    expect(renderPdfBrandLogo("https://banglakhata.example"))
      .toContain('href="https://banglakhata.example"');
    expect(renderPdfBrandLogo("javascript:alert(1)"))
      .not.toContain("<a ");
  });

  it("links the install button to the configured Play Store URL", () => {
    expect(renderPdfInstallButton("https://play.google.com/store/apps/details?id=app"))
      .toContain('href="https://play.google.com/store/apps/details?id=app"');
    expect(renderPdfInstallButton(""))
      .toContain("<span");
  });

  it("renders clickable phone and email contacts in a blue support box", () => {
    const support = renderPdfSupportBox("+880 1712-345678", "support@example.com");
    expect(support).toContain("background:#dbeafe");
    expect(support).toContain('href="tel:+8801712345678"');
    expect(support).toContain('href="mailto:support@example.com"');
    expect(renderPdfSupportBox("", "")).toBe("");
    expect(renderPdfSupportBox("+৮৮০ ১৭১২-৩৪৫৬৭৮", ""))
      .toContain('href="tel:+8801712345678"');
  });

  it("escapes setting values before placing them in PDF markup", () => {
    expect(renderPdfBrandLogo('https://example.com/?q="x"'))
      .toContain("&quot;x&quot;");
  });
});
