import { describe, expect, it } from 'vitest';
import { fitA4Content } from './fit-a4-content';

describe('fitA4Content', () => {
  it('scales overflowing content into the page and restores its original styles', () => {
    const root = document.createElement('div');
    root.style.padding = '20px 0';
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 1000 });
    const content = document.createElement('div');
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 1200 });

    const restore = fitA4Content(root, content);
    expect(content.style.transform).toBe('scale(0.8)');
    expect(content.style.transformOrigin).toBe('top left');
    expect(content.style.width).toBe('calc(125%)');

    restore();
    expect(content.style.transform).toBe('');
    expect(content.style.transformOrigin).toBe('');
    expect(content.style.width).toBe('');
  });
});
