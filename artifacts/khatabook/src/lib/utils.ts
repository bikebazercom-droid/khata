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
 * Safely evaluates a simple arithmetic expression typed into the in-line
 * amount calculator (e.g. "500+250*2"). Only digits, whitespace, and the
 * operators + - * / ( ) . are ever allowed through to evaluation, so this
 * cannot execute arbitrary JS. Returns null if the expression is empty,
 * contains disallowed characters, or fails to evaluate to a finite number.
 */
export function evaluateMathExpression(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Only allow digits, ., whitespace, and the four basic operators/parens.
  if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) return null;
  // Reject a bare number-only string with no operator issues (still valid),
  // but reject dangling operators like "500+" which are incomplete.
  if (/[+\-*/.]$/.test(trimmed.replace(/\s+/g, ''))) return null;
  // Reject empty parens or consecutive operators like "5**2" / "5+-2" edge cases
  if (/[+\-*/]{2,}/.test(trimmed.replace(/\s+/g, '').replace(/\(-/g, '('))) return null;

  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${trimmed});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}
