const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

export function normalizeCalculatorInput(input: string): string {
  return input
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[×x]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[％]/g, '%');
}

export function evaluateCalculatorExpression(raw: string): number | null {
  const trimmed = normalizeCalculatorInput(raw).replace(/\s+/g, '').replace(/\.(?=[+\-*/]|$)/g, '');
  if (!trimmed || !/^[0-9+\-*/.%]+$/.test(trimmed)) return null;
  if (/[+\-*/]$/.test(trimmed) || /[+\-*/]{2,}/.test(trimmed)) return null;
  if (/%[0-9%]/.test(trimmed) || /^%/.test(trimmed)) return null;

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

  const isOperator = (token: string) => ['+', '-', '*', '/'].includes(token);
  if (isOperator(tokens[0])) return null;
  type Decimal = { numerator: bigint; denominator: bigint };
  const gcd = (left: bigint, right: bigint): bigint => {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) [a, b] = [b, a % b];
    return a || 1n;
  };
  const decimal = (numerator: bigint, denominator = 1n): Decimal => {
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = gcd(numerator, denominator);
    return { numerator: (numerator / divisor) * sign, denominator: (denominator / divisor) * sign };
  };
  const fromString = (value: string): Decimal => {
    const [whole, fraction = ''] = value.split('.');
    return decimal(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length));
  };
  const add = (a: Decimal, b: Decimal) => decimal(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
  const subtract = (a: Decimal, b: Decimal) => decimal(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
  const multiply = (a: Decimal, b: Decimal) => decimal(a.numerator * b.numerator, a.denominator * b.denominator);
  const divide = (a: Decimal, b: Decimal) => b.numerator === 0n
    ? null
    : decimal(a.numerator * b.denominator, a.denominator * b.numerator);
  const toNumber = (value: Decimal) => Number(value.numerator) / Number(value.denominator);
  const toRoundedCurrency = (value: Decimal) => {
    const scaled = value.numerator * 100n;
    let cents = scaled / value.denominator;
    const remainder = scaled % value.denominator;
    // Match Math.round's midpoint behavior while deciding the rounding exactly.
    if (scaled >= 0n && remainder * 2n >= value.denominator) cents += 1n;
    if (scaled < 0n && -remainder * 2n > value.denominator) cents -= 1n;
    return Number(cents) / 100;
  };
  const first = tokens[0];
  let total = fromString(first.endsWith('%') ? first.slice(0, -1) : first);
  if (first.endsWith('%')) total = decimal(total.numerator, total.denominator * 100n);

  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index];
    const operand = tokens[index + 1];
    if (!isOperator(operator) || operand === undefined || isOperator(operand)) return null;
    const isPercent = operand.endsWith('%');
    let value = fromString(isPercent ? operand.slice(0, -1) : operand);
    if (isPercent) value = decimal(value.numerator, value.denominator * 100n);
    if ((operator === '+' || operator === '-') && isPercent) value = multiply(total, value);

    switch (operator) {
      case '+': total = add(total, value); break;
      case '-': total = subtract(total, value); break;
      case '*': total = multiply(total, value); break;
      case '/':
        {
          const result = divide(total, value);
          if (!result) return null;
          total = result;
        }
        break;
    }
  }
  const result = tokens.length > 1 ? toRoundedCurrency(total) : toNumber(total);
  if (!Number.isFinite(result)) return null;
  return result;
}

export function formatExpression(expression: string): string {
  return expression.replace(/\*/g, '×').replace(/\//g, '÷');
}

export function trimNumberForExpression(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 100) / 100);
}

export function formatMoney(value: number): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
  return `৳${toBengaliDigits(formatted)}`;
}

export function toBengaliDigits(value: string): string {
  return value.replace(/\d/g, (digit) => BENGALI_DIGITS[Number(digit)]);
}

export function todayIsoDate(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return 'তারিখ নেই';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('bn-BD', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function makeClientRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function apiBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : '';
}

export function billImageUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('data:') || /^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/objects/')) return `${apiBaseUrl()}/api/storage${path}`;
  return path;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      message?: unknown;
      data?: { error?: unknown };
      response?: { data?: { error?: unknown } };
    };
    const apiMessage = candidate.data?.error ?? candidate.response?.data?.error;
    if (typeof apiMessage === 'string') return apiMessage;
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  return fallback;
}

export function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  return candidate.status === 401 || candidate.response?.status === 401;
}

export type PartyRecord = {
  id: string;
  name: string;
  phone: string;
  role: 'CUSTOMER' | 'SUPPLIER';
  currentBalance: number;
  balanceType: 'YOU_WILL_GIVE' | 'YOU_WILL_GET';
  dueDate: string | null;
  lastTransactionAt: string | null;
  createdAt: string;
};

export type LedgerRecord = {
  id: string;
  partyId: string;
  type: 'YOU_GAVE' | 'YOU_GOT';
  amount: number;
  description: string;
  billReference?: string | null;
  billImage?: string | null;
  dueDate: string | null;
  createdAt: string;
  isTransfer?: boolean;
  transferPartyId?: string | null;
  linkedEntryId?: string | null;
};

export type GlobalLedgerRecord = LedgerRecord & {
  partyName: string;
  partyPhone: string;
};