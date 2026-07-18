/**
 * Banglakhata — Receipt Image Generator
 *
 * Renders a production-quality receipt card onto an off-screen HTML5 Canvas
 * and returns a PNG Blob ready for native sharing or download.
 *
 * Layout  (800 logical px wide, @2× retina):
 *  ┌────────────────────────────────────────┐
 *  │  HEADER  (navy)    logo + brand name   │
 *  ├────────────────────────────────────────┤
 *  │  STORE STRIP  (mid-navy)               │
 *  ├────────────────────────────────────────┤
 *  │  AMOUNT BANNER  (green / red tint)     │
 *  ├────────────────────────────────────────┤
 *  │  DETAIL ROWS  (light slate bg)         │
 *  │   • party name                         │
 *  │   • date & time                        │
 *  │   • note         (optional)            │
 *  │   • bill ref     (optional)            │
 *  │   ──────────────────────────────────   │
 *  │   • this entry  ↔  current balance     │
 *  ├────────────────────────────────────────┤
 *  │  FOOTER  (very dark navy)  safety      │
 *  └────────────────────────────────────────┘
 */

import { toBengaliDigits } from './utils';

// ── canvas constants ──────────────────────────────────────────────────────────
const W     = 800;   // logical width (px)
const SCALE = 2;     // retina → 1600 × dynamic physical px
const PAD   = 44;    // horizontal padding inside detail section

// ── brand palette ─────────────────────────────────────────────────────────────
const C = {
  navy:     '#1B3A6B',
  navyMid:  '#243E72',
  orange:   '#F5A623',
  white:    '#ffffff',
  slate50:  '#f8fafc',
  slate200: '#e2e8f0',
  slate400: '#94a3b8',
  slate600: '#475569',
  slate800: '#1e293b',
  green:    '#059669',
  greenBg:  '#ecfdf5',
  red:      '#dc2626',
  redBg:    '#fff1f2',
  footer:   '#0f1d35',
} as const;

// ── section heights (logical px) ─────────────────────────────────────────────
const H_HEADER = 150;
const H_STORE  = 46;
const H_AMOUNT = 116;
const H_FOOTER = 84;

// ── public types ──────────────────────────────────────────────────────────────
export interface ReceiptData {
  storeName:      string;
  partyName:      string;
  /** e.g. "16 Jul 2026" */
  date:           string;
  /** e.g. "02:30 PM" */
  time:           string;
  amount:         number;
  /** true = YOU_GAVE (red), false = YOU_GOT (green) */
  isGave:         boolean;
  balance:        number;
  /** true = YOU_WILL_GET (green), false = YOU_WILL_GIVE (red) */
  balanceIsGet:   boolean;
  description?:   string;
  billReference?: string;
  /** BASE_URL prefix used to load the logo SVG at runtime */
  base:           string;
}

// ── private helpers ───────────────────────────────────────────────────────────

function fmt(amount: number): string {
  // Always show exactly 2 decimal places on receipts; convert digits to Bengali script.
  const enStr = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `৳ ${toBengaliDigits(enStr)}`;
}

function rrPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Wrap long text across lines; returns the Y position of the last baseline. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, startY: number,
  maxW: number, lineH: number,
): number {
  let line = '';
  let curY = startY;
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, curY);
  return curY;
}

async function tryLoadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => resolve(null), 3000);
    img.onload  = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = src;
  });
}

/** Calculate the height of the detail section based on optional rows. */
function detailH(data: ReceiptData): number {
  let h = 28 + 14 + 5 + 22 + 30;  // top pad + label + gap + party name + bottom
  h    += 14 + 5 + 18 + 30;        // date row
  if (data.description)   h += 14 + 5 + 18 + 30;
  if (data.billReference) h += 14 + 5 + 16 + 24;
  h    += 6 + 1 + 24;              // divider area
  h    += 12 + 5 + 24 + 18 + 8;   // balance block
  h    += 28;                       // bottom pad
  return h;
}

// ── main export ───────────────────────────────────────────────────────────────

export async function generateReceiptBlob(data: ReceiptData): Promise<Blob> {
  // Ensure custom fonts (Inter etc.) are loaded before drawing
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const logoImg = await tryLoadImage(`${data.base}/logo-icon.svg`);

  const DH      = detailH(data);
  const TOTAL_H = H_HEADER + H_STORE + H_AMOUNT + DH + H_FOOTER;

  const canvas  = document.createElement('canvas');
  canvas.width  = W * SCALE;
  canvas.height = TOTAL_H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  // ── white base ────────────────────────────────────────────────────────────
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, TOTAL_H);

  // ════════════════════════════════════════════════════════════════════════════
  // 1 ─ HEADER  (navy background)
  // ════════════════════════════════════════════════════════════════════════════
  ctx.fillStyle = C.navy;
  ctx.fillRect(0, 0, W, H_HEADER);

  // Logo icon (56 × 56)
  const iconSz = 56;
  const iconX  = (W - iconSz) / 2;
  if (logoImg) {
    ctx.drawImage(logoImg, iconX, 18, iconSz, iconSz);
  } else {
    // Fallback pill
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    rrPath(ctx, iconX, 18, iconSz, iconSz, 14);
    ctx.fill();
    ctx.fillStyle  = C.orange;
    ctx.font       = 'bold 22px Inter, sans-serif';
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BK', W / 2, 18 + iconSz / 2);
  }

  // "Banglakhata"
  ctx.fillStyle    = C.white;
  ctx.font         = 'bold 22px Inter, "Noto Sans Bengali", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Banglakhata', W / 2, 110);

  // bottom separator
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, H_HEADER - 1, W, 1);

  // ════════════════════════════════════════════════════════════════════════════
  // 2 ─ STORE STRIP  (mid-navy)
  // ════════════════════════════════════════════════════════════════════════════
  const sy = H_HEADER;
  ctx.fillStyle = C.navyMid;
  ctx.fillRect(0, sy, W, H_STORE);

  ctx.fillStyle    = 'rgba(255,255,255,0.88)';
  ctx.font         = '600 13px Inter, "Noto Sans Bengali", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.storeName, W / 2, sy + H_STORE / 2);

  // ════════════════════════════════════════════════════════════════════════════
  // 3 ─ AMOUNT BANNER
  // ════════════════════════════════════════════════════════════════════════════
  const ay     = sy + H_STORE;
  const amtBg  = data.isGave ? C.redBg   : C.greenBg;
  const amtCol = data.isGave ? C.red     : C.green;
  const amtLbl = data.isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন';

  ctx.fillStyle = amtBg;
  ctx.fillRect(0, ay, W, H_AMOUNT);

  // Accent stripe at top
  ctx.fillStyle = amtCol;
  ctx.fillRect(0, ay, W, 3);

  // Type label
  ctx.fillStyle    = data.isGave ? '#f87171' : '#34d399';
  ctx.font         = '600 12px "Noto Sans Bengali", Inter, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(amtLbl, W / 2, ay + 26);

  // Large amount
  ctx.fillStyle = amtCol;
  ctx.font      = 'bold 52px Inter, "Noto Sans Bengali", sans-serif';
  ctx.fillText(fmt(data.amount), W / 2, ay + 92);

  // ════════════════════════════════════════════════════════════════════════════
  // 4 ─ DETAIL ROWS
  // ════════════════════════════════════════════════════════════════════════════
  const dy = ay + H_AMOUNT;

  ctx.fillStyle = C.slate50;
  ctx.fillRect(0, dy, W, DH);

  // Top border
  ctx.fillStyle = C.slate200;
  ctx.fillRect(0, dy, W, 1);

  let y = dy + 28;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';

  const drawRow = (
    label: string,
    value: string,
    valueSz: number,
    valueCol: string,
    bold = false,
    bottomGap = 30,
  ) => {
    ctx.fillStyle = C.slate400;
    ctx.font      = '600 10px Inter, sans-serif';
    ctx.fillText(label.toUpperCase(), PAD, y);
    y += 14 + 5;
    ctx.fillStyle = valueCol;
    ctx.font      = `${bold ? 'bold' : '600'} ${valueSz}px "Noto Sans Bengali", Inter, sans-serif`;
    ctx.fillText(value, PAD, y);
    y += valueSz + bottomGap;
  };

  // Party name
  drawRow('গ্রাহক', data.partyName, 20, C.slate800, true);
  // Date & time
  drawRow('তারিখ ও সময়', `${data.date}  •  ${data.time}`, 15, C.slate600);

  // Optional: description
  if (data.description) {
    ctx.fillStyle = C.slate400;
    ctx.font      = '600 10px Inter, sans-serif';
    ctx.fillText('নোট'.toUpperCase(), PAD, y);
    y += 14 + 5;
    ctx.fillStyle = C.slate600;
    ctx.font      = `400 15px "Noto Sans Bengali", Inter, sans-serif`;
    y = wrapText(ctx, data.description, PAD, y, W - PAD * 2, 20);
    y += 30;
  }

  // Optional: bill reference
  if (data.billReference) {
    drawRow('বিল রেফারেন্স', data.billReference, 14, C.slate600, false, 24);
  }

  // Divider
  y += 6;
  ctx.strokeStyle = C.slate200;
  ctx.lineWidth   = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 24;

  // Balance block (two columns)
  const balCol = data.balanceIsGet ? C.green : C.red;
  const balLbl = data.balanceIsGet ? 'আপনি পাবেন' : 'আপনি দেবেন';
  const entCol = data.isGave ? C.red : C.green;

  // Column headers
  ctx.fillStyle = C.slate400;
  ctx.font      = '600 10px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('এই লেনদেন'.toUpperCase(), PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText('বর্তমান ব্যালেন্স'.toUpperCase(), W - PAD, y);
  y += 12 + 5;

  // Amount values
  ctx.font      = 'bold 22px Inter, "Noto Sans Bengali", sans-serif';
  ctx.fillStyle = entCol;
  ctx.textAlign = 'left';
  ctx.fillText(fmt(data.amount), PAD, y);

  ctx.fillStyle = balCol;
  ctx.textAlign = 'right';
  ctx.fillText(fmt(data.balance), W - PAD, y);
  y += 24 + 6;

  // Balance sub-label
  ctx.font      = '600 13px "Noto Sans Bengali", Inter, sans-serif';
  ctx.fillStyle = balCol;
  ctx.textAlign = 'right';
  ctx.fillText(balLbl, W - PAD, y);

  // ════════════════════════════════════════════════════════════════════════════
  // 5 ─ FOOTER  (very dark navy)
  // ════════════════════════════════════════════════════════════════════════════
  const fy = dy + DH;
  ctx.fillStyle = C.footer;
  ctx.fillRect(0, fy, W, H_FOOTER);

  // Orange accent line
  ctx.fillStyle = C.orange;
  ctx.fillRect(0, fy, W, 3);

  // Badge circle
  const bcx = W / 2 - 115;
  const bcy = fy + H_FOOTER / 2 + 3;
  ctx.fillStyle = C.orange;
  ctx.beginPath();
  ctx.arc(bcx, bcy, 13, 0, Math.PI * 2);
  ctx.fill();

  // Tick mark inside badge
  ctx.strokeStyle = C.footer;
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(bcx - 5,   bcy + 1);
  ctx.lineTo(bcx - 1,   bcy + 5);
  ctx.lineTo(bcx + 6.5, bcy - 4.5);
  ctx.stroke();

  // Safety text
  ctx.fillStyle    = 'rgba(255,255,255,0.88)';
  ctx.font         = '600 13px "Noto Sans Bengali", Inter, sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('১০০% নিরাপদ ও সুরক্ষিত Banglakhata', bcx + 22, bcy);

  // ── Convert canvas → PNG Blob ───────────────────────────────────────────
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    );
  });
}
