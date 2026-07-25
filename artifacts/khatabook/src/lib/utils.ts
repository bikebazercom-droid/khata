import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Bengali numeral helpers ────────────────────────────────────────────────────

/** Maps ASCII digits to their Unicode Bengali equivalents. */
const EN_TO_BN: Readonly<Record<string, string>> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
} as const;

/**
 * Converts a formatted English-digit string to Bengali digits,
 * leaving all other characters (commas, period, ৳) unchanged.
 * Exported so other modules (e.g. receiptCanvas.ts) can reuse the same map.
 */
export function toBengaliDigits(str: string): string {
  return str.split('').map(ch => EN_TO_BN[ch] ?? ch).join('');
}

/**
 * Formats a number in Bengali digits with Indian-style grouping
 * (used in Bangladesh: lakhs/crores).
 *
 * - Whole numbers show no decimal places  (২,৫০০)
 * - Decimal amounts show exactly 2 places (২,৩৩২.৮২)
 */
export function formatBengaliNumber(amount: number): string {
  const hasDecimal = !Number.isInteger(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return toBengaliDigits(formatted);
}

/**
 * Formats a monetary amount with the ৳ prefix and Bengali digits.
 * Examples:  2500   → ৳২,৫০০
 *            2332.82 → ৳২,৩৩২.৮২
 */
export function formatCurrency(amount: number): string {
  return `৳${formatBengaliNumber(amount)}`;
}

/**
 * Like formatCurrency, but for the live calculator big-display while the user
 * is still typing an operand. Shows exactly as many decimal places as the user
 * has already typed — no automatic trailing-zero padding.
 *
 * Examples:
 *   ("0.5",  0.5)  → "৳০.৫"   (not "৳০.৫০")
 *   ("0.50", 0.5)  → "৳০.৫০"  (user typed the trailing zero)
 *   ("100",  100)  → "৳১০০"
 *   ("0.",   0)    → "৳০."     (caller must append trailing dot separately)
 */
export function formatCurrencyTyping(rawStr: string, amount: number): string {
  if (isNaN(amount)) return '৳০';
  const dotIdx = rawStr.indexOf('.');
  // Exact number of decimal digits the user has typed so far (capped at 2)
  const decDigits = dotIdx === -1 ? 0 : Math.min(rawStr.length - dotIdx - 1, 2);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decDigits,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return `৳${toBengaliDigits(formatted)}`;
}

/**
 * Evaluates an expression typed into the custom on-screen calculator keypad
 * (e.g. "10+5+40*5/10%"), using classic sequential four-function-calculator
 * semantics rather than algebraic operator precedence — i.e. operations are
 * applied strictly in the order they were pressed (like a physical adding
 * machine), which is what real ledger/cash-register calculators do and is
 * required for chained "%" tokens to resolve to the expected total.
 *
 * Percent handling ("standard ledger calculator" convention):
 * - After + or -, "N%" means "N percent OF the running total so far"
 *   (e.g. 100+10% = 100 + 10 = 110).
 * - After * or /, "N%" means the literal fraction N/100
 *   (e.g. 200*10% = 20, 275/10% = 275/0.1 = 2750).
 *
 * Only digits, ".", "%", and the operators + - * / are ever allowed through,
 * so this cannot execute arbitrary JS. Returns null if the expression is
 * empty, malformed (dangling/doubled operators, stray characters), or
 * fails to evaluate to a finite number (including division by zero).
 */
export function evaluateCalculatorExpression(raw: string): number | null {
  // Strip whitespace, then normalize any trailing decimal point so that
  // "2332." evaluates as "2332" rather than returning null mid-keystroke.
  // Without this the live display snaps to ৳0 the moment the user presses
  // "." and before they type the first decimal digit.
  const trimmed = raw.replace(/\s+/g, '').replace(/\.(?=[+\-*/]|$)/g, '');
  if (!trimmed) return null;

  // Only allow digits, ., %, and the four basic operators.
  if (!/^[0-9+\-*/.%]+$/.test(trimmed)) return null;
  // Reject dangling operators at the end, e.g. "500+".
  if (/[+\-*/]$/.test(trimmed)) return null;
  // Reject consecutive operators, e.g. "5**2" / "5+-2".
  if (/[+\-*/]{2,}/.test(trimmed)) return null;
  // "%" may only ever be preceded by a digit and followed by an operator or
  // the end of the string — reject things like "%5" or "10%%".
  if (/%[0-9%]/.test(trimmed) || /^%/.test(trimmed)) return null;

  // Tokenize into number tokens (optionally trailed by "%") and single-char
  // operator tokens, verifying every character is consumed by a token in
  // sequence (no gaps = no unrecognized fragments slip through).
  const tokenPattern = /(\d+(?:\.\d+)?%?)|([+\-*/])/g;
  const tokens: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(trimmed)) !== null) {
    if (match.index !== cursor) return null;
    tokens.push(match[0]);
    cursor = tokenPattern.lastIndex;
  }
  if (cursor !== trimmed.length || tokens.length === 0) return null;

  const isOperator = (t: string) => t === '+' || t === '-' || t === '*' || t === '/';
  if (isOperator(tokens[0])) return null;

  // Round to 2 decimal places after every operation to eliminate
  // floating-point noise (e.g. 0.1 + 0.2 → 0.30000000000000004 → 0.30).
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const firstToken = tokens[0];
  let acc = firstToken.endsWith('%') ? r2(parseFloat(firstToken) / 100) : parseFloat(firstToken);
  if (!Number.isFinite(acc)) return null;

  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const operandToken = tokens[i + 1];
    if (!isOperator(op) || operandToken === undefined || isOperator(operandToken)) return null;

    const isPercent = operandToken.endsWith('%');
    const rawNum = parseFloat(isPercent ? operandToken.slice(0, -1) : operandToken);
    if (!Number.isFinite(rawNum)) return null;

    const value = isPercent
      ? op === '+' || op === '-'
        ? r2(acc * (rawNum / 100)) // percent of the running total for +/-
        : r2(rawNum / 100)         // literal fraction for */÷
      : rawNum;

    switch (op) {
      case '+': acc = r2(acc + value); break;
      case '-': acc = r2(acc - value); break;
      case '*': acc = r2(acc * value); break;
      case '/':
        if (value === 0) return null;
        acc = r2(acc / value);
        break;
    }
  }

  return Number.isFinite(acc) ? acc : null;
}

/** Converts internal "*"/"/" operator characters to the "×"/"÷" symbols used
 * on the keypad, for display in the live formula sub-bar. */
export function formatExpressionForDisplay(expr: string): string {
  return expr.replace(/\*/g, '×').replace(/\//g, '÷');
}

/** Formats a number for re-insertion into the calculator expression buffer
 * (e.g. after pressing "="), stripping floating-point noise. */
export function trimNumberForExpression(value: number): string {
  return Number(value.toFixed(2)).toString();
}
