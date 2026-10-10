import { describe, expect, it } from 'vitest';
import { splitAdjustmentDescription } from './adjustment-display';

describe('splitAdjustmentDescription', () => {
  it('leaves ordinary remarks in Details', () => {
    expect(splitAdjustmentDescription('দোকানের মাল', false)).toEqual({
      details: 'দোকানের মাল',
      adjustment: null,
    });
  });

  it('separates the generated transfer suffix from the original remark', () => {
    expect(splitAdjustmentDescription(
      'শাকিল থেকে টাকা — অ্যাডজাস্ট করা হয়েছে melon-এর সাথে',
      true,
    )).toEqual({
      details: 'শাকিল থেকে টাকা',
      adjustment: 'অন্য খাতায়: melon',
    });
  });

  it('shows adjustments with no user remark without putting the generated text in Details', () => {
    expect(splitAdjustmentDescription('অ্যাডজাস্ট করা হয়েছে melon-এর সাথে', true)).toEqual({
      details: '',
      adjustment: 'অন্য খাতায়: melon',
    });
  });
});
