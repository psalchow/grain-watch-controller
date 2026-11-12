import { describe, it, expect } from 'vitest';
import { fitDomain } from './chartDomain';

describe('fitDomain', () => {
  it('pads the extremes and rounds outwards to whole degrees', () => {
    expect(fitDomain([8.4, 14.2, 11])).toEqual([7, 16]);
  });

  it('ignores nulls', () => {
    expect(fitDomain([null, 10, null, 20])).toEqual([9, 21]);
  });

  it('widens a nearly flat series to the minimum span', () => {
    expect(fitDomain([10, 10.2])).toEqual([8, 13]);
  });

  it('returns undefined when there is nothing to fit', () => {
    expect(fitDomain([])).toBeUndefined();
    expect(fitDomain([null, null])).toBeUndefined();
  });
});
