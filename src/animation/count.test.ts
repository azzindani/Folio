import { describe, it, expect } from 'vitest';
import { countTemplate, countText } from './count';

describe('countTemplate', () => {
  it('finds the first number with its format and surroundings', () => {
    expect(countTemplate('1,250+')).toEqual({ prefix: '', value: 1250, decimals: 0, grouped: true, suffix: '+' });
    expect(countTemplate('$4.2M')).toEqual({ prefix: '$', value: 4.2, decimals: 1, grouped: false, suffix: 'M' });
    expect(countTemplate('No figures here')).toBeNull();
  });
});

describe('countText', () => {
  it('counts a fraction of the written number, in its own format', () => {
    expect(countText('$4.2M', 0.5)).toBe('$2.1M');
    expect(countText('1,250+', 0.9)).toBe('1,125+');
    expect(countText('1,250+', 0.5)).toBe('625+');
    expect(countText('98%', 0)).toBe('0%');
  });

  it('counts only the figure inside a sentence, and leaves text without one alone', () => {
    expect(countText('Save 40% today', 0.25)).toBe('Save 10% today');
    expect(countText('No figures here', 0.5)).toBe('No figures here');
  });

  it('lands on the figure at 1 and never passes it on an overshooting curve', () => {
    expect(countText('-1,250', 1)).toBe('-1,250');
    expect(countText('1,250+', 1.2)).toBe('1,250+');
  });
});
