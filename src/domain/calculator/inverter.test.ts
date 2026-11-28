import { describe, expect, it } from 'vitest';
import { checkInverterCompatibility, inverterWithParallelUnits, selectInverter } from './inverter';
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
    expect(check.status).toBe('verified');
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
    expect(check.status).toBe('incompatible');
  });


  it('permite simular con datos básicos aunque falten MPPT y parámetros opcionales', () => {
    const check = checkInverterCompatibility({
      ...base,
      inverter: inverter({
        surgeW: 0,
        efficiency: 0,
        maxPvVoltageV: 0,
        mppt: [],
        maxChargeA: 0,
        maxDischargeA: 0,
        acVoltages: [],
      }),
      battery: battery({ dod: 0, chargeEff: 0, dischargeEff: 0, maxChargeW: 0, maxDischargeW: 0 }),
    });
    expect(check.compatible).toBe(true);
    expect(check.status).toBe('partial');
    expect(check.diagnostics.some((item) => item.code === 'PV_STRINGS_UNVERIFIED')).toBe(true);
    expect(check.diagnostics.some((item) => item.code === 'INV_SURGE_UNKNOWN')).toBe(true);
  });

  it('marca como verificación parcial la tensión de batería desconocida', () => {
    const check = checkInverterCompatibility({
      ...base,
      battery: battery({ nominalV: 0 }),
    });
    expect(check.compatible).toBe(true);
    expect(check.status).toBe('partial');
    expect(check.diagnostics.some((item) => item.code === 'BATT_VOLTAGE_UNKNOWN')).toBe(true);
  });

  it('advierte si la vivienda tiene 110/220 V pero el inversor sólo declara una salida', () => {
    const check = checkInverterCompatibility({ ...base, inverter: inverter({ acVoltages: [220] }), voltage: 'both' });
    expect(check.compatible).toBe(true);
    expect(check.diagnostics.some((item) => item.code === 'AC_BOTH_UNVERIFIED')).toBe(true);
  });

  it('selecciona el inversor compatible más pequeño', () => {
    const small = inverter({ id: 'small', ratedW: 5000, surgeW: 10000, model: '5 kW' });
    const big = inverter({ id: 'big', ratedW: 8000, surgeW: 2000, model: '8 kW' });
    const selected = selectInverter({ ...base, inverters: [big, small] });
    expect(selected.inverter?.id).toBe('small');
    expect(selected.rejected).toHaveLength(1);
  });

  it('escala el límite de descarga del banco con la cantidad de baterías', () => {
    const limitedBattery = battery({ maxDischargeW: 3000 });
    const one = checkInverterCompatibility({ ...base, battery: limitedBattery, batteryCount: 1 });
    const two = checkInverterCompatibility({ ...base, battery: limitedBattery, batteryCount: 2 });

    expect(one.diagnostics.some((item) => item.code === 'BATT_DISCHARGE_W')).toBe(true);
    expect(two.diagnostics.some((item) => item.code === 'BATT_DISCHARGE_W')).toBe(false);
  });

  it('escala las capacidades eléctricas y replica MPPT para inversores en paralelo', () => {
    const single = inverter({
      ratedW: 5000, surgeW: 10000, maxPvInputW: 6000,
      maxChargeA: 100, maxDischargeA: 100,
      maxParallelUnits: 6,
      mppt: [{ maxVoltageV: 450, minVoltageV: 100, maxCurrentA: 20, maxPowerW: 6000 }],
    });
    const bank = inverterWithParallelUnits(single, 3);
    expect(bank.ratedW).toBe(15000);
    expect(bank.surgeW).toBe(30000);
    expect(bank.maxPvInputW).toBe(18000);
    expect(bank.maxChargeA).toBe(300);
    expect(bank.maxDischargeA).toBe(300);
    expect(bank.mppt).toHaveLength(3);
    expect(bank.maxPvVoltageV).toBe(single.maxPvVoltageV);
  });

  it('no permite paralelizar modelos sin capacidad declarada en el catálogo', () => {
    const single = inverter({ ratedW: 5000, maxParallelUnits: undefined });
    expect(inverterWithParallelUnits(single, 4).ratedW).toBe(5000);
  });


  it('sólo habilita cantidades paralelas documentadas para los modelos verificados', () => {
    expect(VERIFIED_INVERTERS.find((item) => item.id === 'ver-inv-deye-5')?.maxParallelUnits).toBe(16);
    expect(VERIFIED_INVERTERS.find((item) => item.id === 'ver-inv-srne-10')?.maxParallelUnits).toBe(6);
    expect(VERIFIED_INVERTERS.find((item) => item.id === 'ver-inv-solis-8')?.maxParallelUnits).toBe(6);
    expect(VERIFIED_INVERTERS.find((item) => item.id === 'ver-inv-growatt-5')?.maxParallelUnits).toBe(6);
  });

  it('limita la expansión al máximo declarado por el fabricante', () => {
    const model = inverter({ ratedW: 5000, maxParallelUnits: 3 });
    expect(inverterWithParallelUnits(model, 8).ratedW).toBe(15000);
  });

  it('no recomienda ningún inversor si todos fallan el arranque', () => {
    const weak = inverter({ ratedW: 8000, surgeW: 1000 });
    const selected = selectInverter({ ...base, inverters: [weak], peakW: 6000 });
    expect(selected.inverter).toBeNull();
  });
});
