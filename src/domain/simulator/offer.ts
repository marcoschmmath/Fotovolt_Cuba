import type {
  Appliance,
  BatterySpec,
  DesignParams,
  Diagnostic,
  GridModel,
  InverterSpec,
  PanelSpec,
  SimulationResult,
  SolarInputs,
} from '../core/types';
import { checkInverterCompatibility } from '../calculator/inverter';
import { analyzeEnergy, buildDailyDemand, peakDesignW, peakPriorityW } from '../calculator/energy';
import { batteryPack, autonomyHours } from '../calculator/battery';
import { simulate } from './engine';
import { analyzeBottlenecks } from './analysis';

/** Datos de una propuesta comercial introducidos manualmente por el usuario. */
export interface OfferInput {
  panelCount: number;
  panelW: number;
  batteryCount: number;
  batteryKwhEach: number;
  batteryV?: number;
  batteryMaxDischargeW?: number;
  batteryDod?: number;
  batteryChargeEff?: number;
  batteryDischargeEff?: number;
  inverterChargeA?: number;
  inverterDischargeA?: number;
  inverterRatedW: number;
  inverterSurgeW?: number;
  inverterMaxPvInputW?: number;
  batteryVoltageV?: number;
  appliances: Appliance[];
  params: DesignParams;
  grid: GridModel;
  solar: SolarInputs;
  voltage: 110 | 220 | 'both';
}

export interface OfferReport {
  simulation: SimulationResult;
  diagnostics: Diagnostic[];
  strengths: string[];
  limitations: string[];
  missingData: string[];
  autonomyH: number;
}

/**
 * Informe independiente. No acusa a nadie: sólo contrasta los datos
 * facilitados con la demanda declarada y señala lo que falta por verificar.
 */
export function checkOffer(input: OfferInput): OfferReport {
  const missingData: string[] = [];
  if (!input.inverterSurgeW) missingData.push('Capacidad de arranque/sobrecarga del inversor.');
  if (!input.inverterMaxPvInputW) missingData.push('Entrada PV máxima del inversor.');
  if (!input.batteryV) missingData.push('Tensión nominal del banco de baterías.');
  if (!input.batteryMaxDischargeW) missingData.push('Potencia máxima de descarga declarada por el BMS.');

  const panel: PanelSpec = {
    id: 'offer-panel',
    brand: '',
    model: 'Panel de la oferta',
    powerW: input.panelW,
    vmppV: 0,
    imppA: 0,
    vocV: 0,
    iscA: 0,
    tempCoeffVoc: input.params.tempCoeffVoc,
    tempCoeffPmpp: input.params.tempCoeffPmpp,
    noct: input.params.noct,
    isReference: true,
    note: 'Datos introducidos manualmente por el usuario.',
  };
  const battery: BatterySpec = {
    id: 'offer-battery',
    brand: '',
    model: 'Batería de la oferta',
    nominalKwh: input.batteryKwhEach,
    nominalV: input.batteryV ?? input.batteryVoltageV ?? 48,
    capacityAh: input.batteryV ? (input.batteryKwhEach * 1000) / input.batteryV : 0,
    maxChargeW: input.batteryKwhEach * 1000,
    maxDischargeW: input.batteryMaxDischargeW ?? input.batteryKwhEach * 1000,
    dod: input.batteryDod ?? input.params.dod,
    chargeEff: input.batteryChargeEff ?? input.params.batteryChargeEff,
    dischargeEff: input.batteryDischargeEff ?? input.params.batteryDischargeEff,
    chemistry: 'No declarada',
    isReference: true,
    note: 'Datos introducidos manualmente por el usuario.',
  };
  const inverter: InverterSpec = {
    id: 'offer-inverter',
    brand: '',
    model: 'Inversor de la oferta',
    ratedW: input.inverterRatedW,
    surgeW: input.inverterSurgeW ?? Number.POSITIVE_INFINITY,
    surgeSeconds: 0,
    efficiency: input.params.inverterEfficiency,
    maxPvInputW: input.inverterMaxPvInputW ?? Number.POSITIVE_INFINITY,
    maxPvVoltageV: Number.POSITIVE_INFINITY,
    mppt: [
      {
        maxVoltageV: Number.POSITIVE_INFINITY,
        minVoltageV: 0,
        maxCurrentA: Number.POSITIVE_INFINITY,
        maxPowerW: Number.POSITIVE_INFINITY,
      },
    ],
    batteryVoltageV: input.batteryVoltageV ?? battery.nominalV,
    maxChargeA: input.inverterChargeA ?? 10000,
    maxDischargeA: input.inverterDischargeA ?? 10000,
    acVoltages: [110, 220],
    isReference: true,
    note: 'Datos introducidos manualmente por el usuario.',
  };

  const config = {
    panel,
    panelCount: Math.max(0, input.panelCount),
    battery,
    batteryCount: Math.max(0, input.batteryCount),
    inverter,
    appliances: input.appliances,
    grid: input.grid,
    solar: input.solar,
    params: input.params,
  };

  const energy = analyzeEnergy(input.appliances, input.params);
  const peak = peakDesignW(energy);
  const compatibility = checkInverterCompatibility({
    inverter,
    battery,
    panel,
    panelCount: config.panelCount,
    continuousW: energy.peakSimultaneousW,
    peakW: peak,
    voltage: input.voltage,
    params: input.params,
  });
  const simulation = simulate(config);
  const bottlenecks = analyzeBottlenecks(config, simulation);
  const pack = batteryPack(battery, Math.max(0, input.batteryCount), input.params);
  // C5/M9: potencia CRÍTICA PICO, no media diaria (con media la autonomía
  // se exageraba hasta ×(24/horas de uso)).
  const criticalW = peakPriorityW(buildDailyDemand(input.appliances, input.params), 'critical');
  const autonomy = autonomyHours(pack, criticalW, input.params);

  const diagnostics = [...compatibility.diagnostics, ...bottlenecks];
  const strengths: string[] = [];
  const limitations: string[] = [];

  if (simulation.totals.coverage >= 0.95) {
    strengths.push(`La simulación cubre el ${(simulation.totals.coverage * 100).toFixed(0)} % de la demanda declarada.`);
  } else {
    limitations.push(`La simulación cubre el ${(simulation.totals.coverage * 100).toFixed(0)} % de la demanda declarada en las hipótesis usadas.`);
  }
  if (simulation.totals.unservedByPriorityKwh.critical < 0.01) {
    strengths.push('No aparecen cortes en los equipos marcados como imprescindibles en el escenario simulado.');
  } else {
    limitations.push('Aparecen cortes en equipos imprescindibles durante la simulación.');
  }
  if (compatibility.compatible) {
    strengths.push('Los datos facilitados no muestran incompatibilidades eléctricas entre los componentes.');
  }
  for (const d of diagnostics.filter((x) => x.level === 'warning' || x.level === 'error')) {
    limitations.push(d.message);
  }
  if (missingData.length > 0) {
    limitations.push('Hay datos técnicos no facilitados que impiden verificar parte de la propuesta.');
  }

  return { simulation, diagnostics, strengths, limitations, missingData, autonomyH: autonomy };
}
