import { describe, expect, it } from 'vitest';
import { composeTimeValue, formatTimeSelectionText, getTimeParts, normalizeTimeValue, shiftTimePartValue } from './index.js';

describe('time domain', () => {
  it('normalizes time values', () => {
    expect(normalizeTimeValue('25:80')).toBe('23:59');
    expect(normalizeTimeValue('09:03')).toBe('09:03');
  });

  it('splits and composes 12-hour time', () => {
    expect(getTimeParts('13:15')).toMatchObject({ hour12: '1', minute: '15', period: 'PM' });
    expect(composeTimeValue({ hour12: '1', minute: '15', period: 'PM' })).toBe('13:15');
  });

  it('shifts lane values and formats labels', () => {
    expect(shiftTimePartValue('hour', '12', 1)).toBe('1');
    expect(shiftTimePartValue('period', 'AM', 1)).toBe('PM');
    expect(formatTimeSelectionText('13:15')).toMatch(/1:15/i);
  });
});
