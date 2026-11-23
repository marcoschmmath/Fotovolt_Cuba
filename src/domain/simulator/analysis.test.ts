import { describe, expect, it } from 'vitest';
import { estimateRechargeHours, testedAutonomyHours } from './analysis';
import { appliance, battery, config, params } from '../../test/fixtures';

describe('análisis de recarga y autonomía', () => {
  it('estima un tiempo positivo de recarga completa con sol y red', () => {
    const hours = estimateRechargeHours(config({ batteryCount: 1 }), 'solar-grid');
    expect(hours).not.toBeNull();
    expect(hours!).toBeGreaterThan(0);
  });

  it('sin sol ni red no se alcanza la recarga', () => {
    const base = config({ batteryCount: 2, battery: battery({ nominalKwh: 20 }) });
    const hours = estimateRechargeHours(
      { ...base, solar: { ...base.solar, hsp: 0 }, grid: { ...base.grid, available: base.grid.available.map(() => false) } },
      'solar-only',
    );
    expect(hours).toBeNull();
  });

  it('la autonomía crece con más batería', () => {
    const p = params();
    const appliances = [appliance({ powerW: 500, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'critical' })];
    const small = testedAutonomyHours(config({ params: p, appliances, batteryCount: 1 }));
    const big = testedAutonomyHours(config({ params: p, appliances, batteryCount: 3 }));
    expect(big).toBeGreaterThan(small);
  });
});
