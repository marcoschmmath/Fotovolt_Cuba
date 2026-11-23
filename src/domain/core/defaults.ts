import type {
  BatterySpec,
  DesignParams,
  InverterSpec,
  PanelSpec,
  SolarInputs,
} from './types';

/**
 * Valores por defecto. Todos son HIPÓTESIS DE CÁLCULO, no datos medidos.
 * La interfaz debe mostrarlos como supuestos editables.
 */
export const DEFAULT_PARAMS: DesignParams = {
  stepMinutes: 15,
  nightStart: 19,
  nightEnd: 7,
  dayStart: 7,
  dayEnd: 19,
  hsp: 4.5,
  systemEfficiency: 0.85,
  inverterEfficiency: 0.92,
  safetyFactor: 1.2,
  autonomyDays: 1,
  dod: 0.8,
  batteryChargeEff: 0.95,
  batteryDischargeEff: 0.95,
  minSoc: 0.15,
  minAmbientC: 18,
  ambientC: 27,
  noct: 45,
  tempCoeffVoc: -0.003,
  tempCoeffPmpp: -0.0035,
  tiltFactor: 0.95,
  shading: 0.05,
  acEer: 10,
  cyclicCycleMinutes: 20,
  gridMaxPowerW: 3000,
  gridChargePowerW: 1500,
  allowExport: false,
};

export function solarFromParams(params: DesignParams): SolarInputs {
  return {
    hsp: params.hsp,
    sunrise: 6,
    sunset: 18,
    ambientC: params.ambientC,
    noct: params.noct,
    tempCoeffPmpp: params.tempCoeffPmpp,
    tiltFactor: params.tiltFactor,
    shading: params.shading,
  };
}

/**
 * Plantillas genéricas de referencia. NO son especificaciones de ningún
 * fabricante: sirven para que la calculadora funcione sin datos previos.
 * Deben editarse con la ficha técnica real antes de recomendar una compra.
 * El campo isReference se muestra explícitamente en la interfaz.
 */
export const REFERENCE_PANELS: PanelSpec[] = [
  {
    id: 'ref-panel-550',
    brand: '',
    model: 'Panel genérico 550 W (plantilla)',
    powerW: 550,
    vmppV: 41.5,
    imppA: 13.25,
    vocV: 49.5,
    iscA: 14.0,
    tempCoeffVoc: -0.0028,
    tempCoeffPmpp: -0.0035,
    noct: 45,
    isReference: true,
    note: 'Valores de plantilla orientativos. Sustituir por la ficha técnica del modelo real.',
  },
  {
    id: 'ref-panel-450',
    brand: '',
    model: 'Panel genérico 450 W (plantilla)',
    powerW: 450,
    vmppV: 41.0,
    imppA: 10.98,
    vocV: 49.0,
    iscA: 11.6,
    tempCoeffVoc: -0.0028,
    tempCoeffPmpp: -0.0035,
    noct: 45,
    isReference: true,
    note: 'Valores de plantilla orientativos. Sustituir por la ficha técnica del modelo real.',
  },
];

export const REFERENCE_INVERTERS: InverterSpec[] = [
  {
    id: 'ref-inv-5000',
    brand: '',
    model: 'Inversor híbrido 5 kW (plantilla)',
    ratedW: 5000,
    surgeW: 10000,
    surgeSeconds: 5,
    efficiency: 0.92,
    maxPvInputW: 8000,
    maxPvVoltageV: 500,
    mppt: [
      { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 18, maxPowerW: 6000 },
      { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 18, maxPowerW: 6000 },
    ],
    batteryVoltageV: 48,
    maxChargeA: 100,
    maxDischargeA: 100,
    acVoltages: [110, 220],
    isReference: true,
    note: 'Plantilla genérica. Verificar límites MPPT, carga y tensión en la ficha real.',
  },
  {
    id: 'ref-inv-3000',
    brand: '',
    model: 'Inversor híbrido 3 kW (plantilla)',
    ratedW: 3000,
    surgeW: 6000,
    surgeSeconds: 5,
    efficiency: 0.9,
    maxPvInputW: 5000,
    maxPvVoltageV: 500,
    mppt: [
      { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 14, maxPowerW: 4000 },
    ],
    batteryVoltageV: 48,
    maxChargeA: 60,
    maxDischargeA: 60,
    acVoltages: [110, 220],
    isReference: true,
    note: 'Plantilla genérica. Verificar límites MPPT, carga y tensión en la ficha real.',
  },
  {
    id: 'ref-inv-8000',
    brand: '',
    model: 'Inversor híbrido 8 kW (plantilla)',
    ratedW: 8000,
    surgeW: 16000,
    surgeSeconds: 5,
    efficiency: 0.93,
    maxPvInputW: 12000,
    maxPvVoltageV: 500,
    mppt: [
      { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 25, maxPowerW: 7000 },
      { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 25, maxPowerW: 7000 },
    ],
    batteryVoltageV: 48,
    maxChargeA: 160,
    maxDischargeA: 160,
    acVoltages: [110, 220],
    isReference: true,
    note: 'Plantilla genérica. Verificar límites MPPT, carga y tensión en la ficha real.',
  },
];

export const REFERENCE_BATTERIES: BatterySpec[] = [
  {
    id: 'ref-batt-5',
    brand: '',
    model: 'Batería LiFePO₄ 5 kWh / 48 V (plantilla)',
    nominalKwh: 5,
    nominalV: 48,
    capacityAh: 100,
    maxChargeW: 5000,
    maxDischargeW: 5000,
    dod: 0.8,
    chargeEff: 0.95,
    dischargeEff: 0.95,
    chemistry: 'LiFePO₄',
    isReference: true,
    note: 'Plantilla genérica. Confirmar BMS, corrientes y capacidad reales.',
  },
  {
    id: 'ref-batt-10',
    brand: '',
    model: 'Batería LiFePO₄ 10 kWh / 48 V (plantilla)',
    nominalKwh: 10,
    nominalV: 48,
    capacityAh: 200,
    maxChargeW: 8000,
    maxDischargeW: 8000,
    dod: 0.8,
    chargeEff: 0.95,
    dischargeEff: 0.95,
    chemistry: 'LiFePO₄',
    isReference: true,
    note: 'Plantilla genérica. Confirmar BMS, corrientes y capacidad reales.',
  },
  {
    id: 'ref-batt-15',
    brand: '',
    model: 'Batería LiFePO₄ 15 kWh / 48 V (plantilla)',
    nominalKwh: 15,
    nominalV: 48,
    capacityAh: 300,
    maxChargeW: 10000,
    maxDischargeW: 10000,
    dod: 0.8,
    chargeEff: 0.95,
    dischargeEff: 0.95,
    chemistry: 'LiFePO₄',
    isReference: true,
    note: 'Plantilla genérica. Confirmar BMS, corrientes y capacidad reales.',
  },
];

/** Fabricantes sugeridos, sin atribuirles ningún modelo ni especificación. */
export const SUGGESTED_BRANDS = [
  'MUST',
  'Fortress Power',
  'Deye',
  'Growatt',
  'EG4',
  'Otra marca disponible en Cuba',
];
