import { describe, expect, it } from 'vitest';
import { checkOffer } from './offer';
import { appliance, grid, params } from '../../test/fixtures';
import { solarFromParams } from '../core/defaults';

function input(overrides: Partial<Parameters<typeof checkOffer>[0]> = {}) {
  const p = params();
  return {
    panelCount: 8,
    panelW: 550,
    batteryCount: 2,
    batteryKwhEach: 5,
    inverterRatedW: 5000,
    appliances: [appliance({ powerW: 500, hoursPerDay: 6 })],
    params: p,
    grid: grid({}, p),
    solar: solarFromParams(p),
    voltage: 'both' as const,
    ...overrides,
  };
}

describe('comprobación de ofertas comerciales', () => {
  it('señala los datos técnicos que faltan por verificar', () => {
    const report = checkOffer(input());
    expect(report.missingData.length).toBeGreaterThan(0);
    expect(report.missingData.every((d) => !d.includes('Voc'))).toBe(true);
    expect(report.limitations.some((l) => l.includes('no facilitados'))).toBe(true);
  });

  it('reduce los datos pendientes cuando se facilitan', () => {
    const full = checkOffer(
      input({
        batteryDod: 0.8,
        inverterSurgeW: 10000,
        inverterMaxPvInputW: 8000,
        batteryV: 48,
        batteryMaxDischargeW: 5000,
        batteryVoltageV: 48,
      }),
    );
    expect(full.missingData).toHaveLength(0);
    expect(full.simulation.valid).toBe(true);
  });

  it('detecta potencia continua insuficiente sin hacer juicios comerciales', () => {
    const report = checkOffer(input({ inverterRatedW: 100 }));
    expect(report.diagnostics.some((d) => d.code === 'INV_RATED' || d.code === 'INV_SURGE')).toBe(true);
    expect(report.strengths.join(' ')).not.toMatch(/vendedor|engaño|estafa/i);
  });
});
