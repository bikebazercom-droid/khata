import { describe, expect, it } from 'vitest';
import {
  formatBangladeshPhoneForInput,
  normalizeBangladeshPhone,
} from './bangladesh-phone';

describe('Bangladesh mobile phone formatting', () => {
  it('keeps a locally typed number in local form and adds the country code for storage', () => {
    expect(formatBangladeshPhoneForInput('01712345678')).toBe('01712345678');
    expect(normalizeBangladeshPhone('01712345678')).toBe('+8801712345678');
  });

  it('converts an imported +880 number back to local form without duplicating its prefix', () => {
    expect(formatBangladeshPhoneForInput('+880 1712-345678')).toBe('01712345678');
    expect(normalizeBangladeshPhone('+880 1712-345678')).toBe('+8801712345678');
  });

  it('accepts a national number without the trunk zero', () => {
    expect(normalizeBangladeshPhone('1712345678')).toBe('+8801712345678');
  });

  it('leaves a blank number undefined so name-only parties remain valid', () => {
    expect(normalizeBangladeshPhone('   ')).toBeUndefined();
  });
});
