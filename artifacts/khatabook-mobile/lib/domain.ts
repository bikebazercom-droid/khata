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
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const first = tokens[0];
  let total = first.endsWith('%') ? round2(parseFloat(first) / 100) : parseFloat(first);
  if (!Number.isFinite(total)) return null;

  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index];
    const operand = tokens[index + 1];
    if (!isOperator(operator) || operand === undefined || isOperator(operand)) return null;
    const isPercent = operand.endsWith('%');
    const number = parseFloat(isPercent ? operand.slice(0, -1) : operand);
    if (!Number.isFinite(number)) return null;
    const value = isPercent
      ? operator === '+' || operator === '-'
        ? round2(total * (number / 100))
        : round2(number / 100)
      : number;

    switch (operator) {
      case '+': total = round2(total + value); break;
      case '-': total = round2(total - value); break;
      case '*': total = round2(total * value); break;
      case '/':
        if (value === 0) return null;
        total = round2(total / value);
        break;
    }
  }
  return Number.isFinite(total) ? total : null;
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