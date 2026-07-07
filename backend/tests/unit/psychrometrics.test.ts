import { dewPoint, absoluteHumidity } from '../../src/utils/psychrometrics';

describe('dewPoint', () => {
  it('computes the dew point for 20 °C / 50 % RH', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.26, 1);
  });

  it('computes the dew point for 10 °C / 80 % RH', () => {
    expect(dewPoint(10, 80)).toBeCloseTo(6.71, 1);
  });
});

describe('absoluteHumidity', () => {
  it('computes absolute humidity for 20 °C / 50 % RH', () => {
    expect(absoluteHumidity(20, 50)).toBeCloseTo(8.64, 1);
  });

  it('rises with temperature at constant RH', () => {
    expect(absoluteHumidity(25, 50)).toBeGreaterThan(absoluteHumidity(15, 50));
  });
});
