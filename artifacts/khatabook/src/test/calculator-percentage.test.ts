import { describe, expect, it } from 'vitest';
import { evaluateCalculatorExpression } from '@/lib/utils';

describe('calculator percentage evaluation', () => {
  it('keeps decimal percentage precision when dividing', () => {
    expect(evaluateCalculatorExpression('1000000/80.10%')).toBe(1248439.45);
  });

  it('uses the unrounded percentage fraction for multiplication', () => {
    expect(evaluateCalculatorExpression('1000*80.10%')).toBe(801);
  });

  it('preserves the calculator convention for percentages after addition/subtraction', () => {
    expect(evaluateCalculatorExpression('1000+10%')).toBe(1100);
    expect(evaluateCalculatorExpression('1000-10%')).toBe(900);
  });

  it('returns a precise fraction when the expression is only a percentage', () => {
    expect(evaluateCalculatorExpression('80.10%')).toBeCloseTo(0.801, 12);
  });

  it('does not round intermediate gold-weight calculations', () => {
    expect(evaluateCalculatorExpression('1170.13/11.664*210000')).toBe(21067155.35);
  });

  it('rounds only once after a sequence of operations', () => {
    expect(evaluateCalculatorExpression('1/3*100')).toBe(33.33);
  });
});
