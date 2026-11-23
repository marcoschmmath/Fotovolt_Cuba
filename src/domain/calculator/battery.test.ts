import { describe, expect, it } from 'vitest';
import { autonomyHours, batteryCountFor, batteryPack, requiredBatteryNominalKwh } from './battery';
import { analyzeEnergy } from './energy';
import { appliance, battery, params } from '../../test/fixtures';

describe('dimensionamiento de baterías', () => {
  it('aplica C_b = (E_n·A)/(DoD·η)', () => {
    const p = params({ dod: 0.8, batteryDischargeEff: 0.95, inverterEfficiency: 0.92, autonomyDays: 1 });
    const energy = analyzeEnergy([appliance({ powerW: 1000, hoursPerDay: 5, schedule: 'night' })], p);
    // E_n = 5 kWh; eta = 0.874; C_b = 5 / (0.8*0.874) = 7.15 kWh
    expect(requiredBatteryNominalKwh(energy, p)).toBeCloseTo(5 / (0.8 * 0.874), 6);
  });

  it('el número de baterías se redondea hacia arriba y nunca es negativo', () => {
    expect(batteryCountFor(10.1, battery({ nominalKwh: 5 }))).toBe(3);
    expect(batteryCountFor(0, battery())).toBe(0);
    expect(batteryCountFor(-2, battery())).toBe(0);
  });

  it('la capacidad útil respeta la profundidad de descarga', () => {
    const p = params({ dod: 0.8, minSoc: 0.1 });
    const pack = batteryPack(battery({ nominalKwh: 10 }), 1, p);
    expect(pack.minSoc).toBeCloseTo(0.2, 6);
    expect(pack.usableKwh).toBeCloseTo(8, 6);
  });

  it('la autonomía crece con la batería y decrece con la carga crítica', () => {
    const p = params();
    const small = batteryPack(battery({ nominalKwh: 5 }), 1, p);
    const big = batteryPack(battery({ nominalKwh: 5 }), 3, p);
    expect(autonomyHours(big, 500, p)).toBeCloseTo(autonomyHours(small, 500, p) * 3, 6);
    expect(autonomyHours(small, 1000, p)).toBeLessThan(autonomyHours(small, 500, p));
  });
});
