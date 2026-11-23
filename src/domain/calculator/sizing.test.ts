import { describe, expect, it } from 'vitest';
import { buildComparison, computeSizing, requiredPvWatts } from './sizing';
import { analyzeEnergy } from './energy';
import { appliance, battery, grid, inverter, panel, params } from '../../test/fixtures';
import { solarFromParams } from '../core/defaults';
import { simulate } from '../simulator/engine';
import { testedAutonomyHours } from '../simulator/analysis';

function sizingInput(overrides: Partial<Parameters<typeof computeSizing>[0]> = {}) {
  const p = params();
  return {
    appliances: [appliance({ powerW: 600, hoursPerDay: 8, schedule: 'day' }), appliance({ id: 'n', powerW: 300, hoursPerDay: 8, schedule: 'night' })],
    params: p,
    panel: panel(),
    battery: battery(),
    inverters: [inverter()],
    voltage: 'both' as const,
    grid: grid({}, p),
    solar: solarFromParams(p),
    ...overrides,
  };
}

describe('motor de dimensionamiento', () => {
  it('P_FV = E·F/(HSP·η)', () => {
    const p = params({ hsp: 5, safetyFactor: 1.2, systemEfficiency: 0.85 });
    const energy = analyzeEnergy([appliance({ powerW: 1000, hoursPerDay: 5 })], p);
    expect(requiredPvWatts(energy, p)).toBeCloseTo((5 * 1.2 * 1000) / (5 * 0.85), 6);
  });

  it('produce una configuración verificable', () => {
    const sizing = computeSizing(sizingInput());
    expect(sizing.targetBatteryKwh).toBeGreaterThan(0);
    expect(sizing.targetPvW).toBeGreaterThan(0);
    expect(sizing.batteryCount).toBeGreaterThan(0);
    expect(sizing.panelCount).toBeGreaterThan(0);
    expect(sizing.inverter).not.toBeNull();
    expect(sizing.config).not.toBeNull();
    if (sizing.config) {
      const sim = simulate(sizing.config);
      expect(sim.valid).toBe(true);
    }
  });

  it('genera tres opciones derivadas de la necesidad', () => {
    const input = sizingInput();
    const base = computeSizing(input);
    const options = buildComparison(input, base);
    expect(options.map((o) => o.id)).toEqual(['economica', 'equilibrada', 'autonomia']);
    expect(options[2].batteryKwh).toBeGreaterThan(options[1].batteryKwh);
    expect(options[1].batteryKwh).toBeGreaterThanOrEqual(options[0].batteryKwh);
    const results = options.map((o) => (o.config ? simulate(o.config).totals.coverage : 0));
    expect(results[2]).toBeGreaterThanOrEqual(results[0]);
    const autonomies = options.map((o) => (o.config ? testedAutonomyHours(o.config) : 0));
    expect(autonomies[2]).toBeGreaterThan(autonomies[0]);
  });

  it('no propone capacidades fijas: cambian con el consumo', () => {
    const small = computeSizing(sizingInput());
    const big = computeSizing(
      sizingInput({
        appliances: [appliance({ powerW: 3000, hoursPerDay: 10, schedule: 'night' })],
      }),
    );
    expect(big.targetBatteryKwh).toBeGreaterThan(small.targetBatteryKwh);
    expect(big.targetPvW).toBeGreaterThan(small.targetPvW);
  });
});
