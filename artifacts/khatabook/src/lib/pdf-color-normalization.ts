function oklchToRgb(value: string): string | null {
  const match = value.match(/oklch\(\s*([+-]?(?:\d*\.)?\d+%?)\s+([+-]?(?:\d*\.)?\d+%?)\s+([+-]?(?:\d*\.)?\d+(?:deg|rad|turn)?)\s*(?:\/\s*([+-]?(?:\d*\.)?\d+%?))?\s*\)/i);
  if (!match) return null;

  const lightness = parseFloat(match[1]) / (match[1].endsWith('%') ? 100 : 1);
  const chroma = parseFloat(match[2]) * (match[2].endsWith('%') ? 0.004 : 1);
  const hueText = match[3].toLowerCase();
  const hueValue = parseFloat(hueText);
  const hue = hueText.endsWith('turn') ? hueValue * 2 * Math.PI
    : hueText.endsWith('rad') ? hueValue
      : hueValue * Math.PI / 180;
  const alpha = match[4] ? parseFloat(match[4]) / (match[4].endsWith('%') ? 100 : 1) : 1;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => {
    const linear = Math.max(0, Math.min(1, channel));
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  });
  return alpha < 1 ? `rgba(${channels.join(', ')}, ${Math.max(0, Math.min(1, alpha))})` : `rgb(${channels.join(', ')})`;
}

/** html2canvas 1.4.1 cannot parse oklch() colors emitted by Tailwind v4. */
export function normalizePdfColors(document: Document, rootId: string) {
  const root = document.getElementById(rootId);
  const view = document.defaultView;
  if (!root || !view) throw new Error(`PDF capture element "${rootId}" was not found`);

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*'))];
  for (const element of elements) {
    const styles = view.getComputedStyle(element);
    for (let index = 0; index < styles.length; index += 1) {
      const property = styles[index];
      const value = styles.getPropertyValue(property);
      if (!value.includes('oklch(')) continue;
      const normalized = value.replace(/oklch\([^)]*\)/gi, (color) => oklchToRgb(color) || color);
      element.style.setProperty(property, normalized, 'important');
    }
  }
}
