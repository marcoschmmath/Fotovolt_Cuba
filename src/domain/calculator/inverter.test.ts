import { describe, expect, it } from 'vitest';
import { checkInverterCompatibility, selectInverter } from './inverter';
import { battery, inverter, panel, params } from '../../test/fixtures';

const base = {
  inverter: inverter(),
  battery: battery(),
  panel: panel(),
  panelCount: 4,
  continuousW: 2000,
  peakW: 3500,
  voltage: 'both' as const,
  params: params(),
};

const inverterBattery51 = () => battery({ nominalV: 51.2, capacityAh: 100 });

describe('compatibilidad del inversor', () => {
  it('acepta un inversor compatible', () => {
    const check = checkInverterCompatibility({ ...base, inverter: inverter() });
    expect(check.compatible).toBe(true);
  });

  it('rechaza discrepancia de tensión de la vivienda', () => {
    const check = checkInverterCompatibility({
      ...base,
      inverter: inverter({ acVoltages: [110] }),
      voltage: 220,
    });
    expect(check.compatible).toBe(false);
    expect(check.diagnostics.some((d) => d.code === 'VOLTAGE')).toBe(true);
  });

  it('rechaza potencia continua y arranque insuficientes', () => {
    const check = checkInverterCompatibility({
      ...base,
      inverter: inverter({ ratedW: 1500, surgeW: 2000 }),
    });
    expect(check.diagnostics.some((d) => d.code === 'INV_RATED')).toBe(true);
    expect(check.diagnostics.some((d) => d.code === 'INV_SURGE')).toBe(true);
  });

  it('acepta un banco LiFePO₄ de 51,2 V en un inversor de 48 V', () => {
    const check = checkInverterCompatibility({ ...base, battery: inverterBattery51() });
    expect(check.diagnostics.some((d) => d.code === 'BATT_VOLTAGE')).toBe(false);
  });

  it('rechaza batería de tensión distinta', () => {
    const check = checkInverterCompatibility({
      ...base,
      battery: battery({ nominalV: 12 }),
    });
    expect(check.diagnostics.some((d) => d.code === 'BATT_VOLTAGE')).toBe(true);
  });

  it('selecciona el inversor compatible más pequeño', () => {
    const small = inverter({ id: 'small', ratedW: 5000, surgeW: 10000, model: '5 kW' });
    const big = inverter({ id: 'big', ratedW: 8000, surgeW: 2000, model: '8 kW' });
    const selected = selectInverter({ ...base, inverters: [big, small] });
    expect(selected.inverter?.id).toBe('small');
    expect(selected.rejected).toHaveLength(1);
  });

  it('no recomienda ningún inversor si todos fallan el arranque', () => {
    const weak = inverter({ ratedW: 8000, surgeW: 1000 });
    const selected = selectInverter({ ...base, inverters: [weak], peakW: 6000 });
    expect(selected.inverter).toBeNull();
  });
});
