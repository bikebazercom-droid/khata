import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return `৳${new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(amount)}`
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
  const trimmed = raw.replace(/\s+/g, '');
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

  const firstToken = tokens[0];
  let acc = firstToken.endsWith('%') ? parseFloat(firstToken) / 100 : parseFloat(firstToken);
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
        ? acc * (rawNum / 100) // percent of the running total for +/-
        : rawNum / 100 // literal fraction for */÷
      : rawNum;

    switch (op) {
      case '+':
        acc += value;
        break;
      case '-':
        acc -= value;
        break;
      case '*':
        acc *= value;
        break;
      case '/':
        if (value === 0) return null;
        acc /= value;
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
