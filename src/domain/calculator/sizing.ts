import type {
  Appliance,
  BatterySpec,
  DesignParams,
  Diagnostic,
  EnergySystemConfig,
  GridModel,
  InverterSpec,
  PanelSpec,
  SolarInputs,
} from '../core/types';
import { analyzeEnergy, buildDailyDemand, peakDesignW, type EnergyBreakdown } from './energy';
import {
  autonomyHours,
  batteryCountFor,
  batteryPack,
  dailyRechargeKwh,
  requiredBatteryNominalKwh,
} from './battery';
import { checkStringDesign, usablePvLimitW } from './pv';
import { checkInverterCompatibility } from './inverter';

export interface SizingInput {
  appliances: Appliance[];
  params: DesignParams;
  panel: PanelSpec;
  battery: BatterySpec;
  inverters: InverterSpec[];
  voltage: 110 | 220 | 'both';
  grid: GridModel;
  solar: SolarInputs;
  /** Modelo preferido por el usuario; se usa si es compatible. */
  preferredInverterId?: string;
}

export interface InverterRejection {
  id: string;
  model: string;
  reasons: string[];
}

export interface SizingResult {
  energy: EnergyBreakdown;
  targetBatteryKwh: number;
  batteryCount: number;
  targetPvW: number;
  panelCount: number;
  inverter: InverterSpec | null;
  autonomyH: number;
  diagnostics: Diagnostic[];
  inverterRejections: InverterRejection[];
  config: EnergySystemConfig | null;
}

function note(list: Diagnostic[], level: Diagnostic['level'], code: string, message: string): void {
  list.push({ level, code, message });
}

/** P_FV = E_d · F / (HSP · η_sistema). E_d incluye la recarga diaria prevista. */
export function requiredPvWatts(
  energy: EnergyBreakdown,
  params: DesignParams,
): number {
  const energyToGenerateKwh = energy.dayKwh + dailyRechargeKwh(energy, params);
  const denominator = Math.max(0.1, params.hsp * params.systemEfficiency);
  return (energyToGenerateKwh * params.safetyFactor * 1000) / denominator;
}

/**
 * Elige inversor y número de placas de forma conjunta: un inversor pequeño
 * puede ser compatible con la carga pero no admitir el array necesario.
 */
export function chooseInverterAndPanels(input: {
  inverters: InverterSpec[];
  panel: PanelSpec;
  battery: BatterySpec;
  params: DesignParams;
  voltage: 110 | 220 | 'both';
  continuousW: number;
  peakW: number;
  targetPvW: number;
  preferredInverterId?: string;
  diagnostics: Diagnostic[];
}): { inverter: InverterSpec | null; panelCount: number } {
  const { inverters, panel, battery, params, voltage, continuousW, peakW, targetPvW, preferredInverterId, diagnostics } = input;
  const desiredPanels = Math.ceil(targetPvW / Math.max(1, panel.powerW));
  const candidates = [...inverters].sort((a, b) => {
    if (a.id === preferredInverterId) return -1;
    if (b.id === preferredInverterId) return 1;
    return a.ratedW - b.ratedW;
  });

  for (const inverter of candidates) {
    const maxPvW = usablePvLimitW(inverter, panel, params);
    const panelCount = Math.min(desiredPanels, Math.floor(maxPvW / Math.max(1, panel.powerW)));
    if (panelCount < 1) continue;
    const check = checkInverterCompatibility({
      inverter,
      battery,
      panel,
      panelCount,
      continuousW,
      peakW,
      voltage,
      params,
    });
    if (check.compatible) return { inverter, panelCount };
  }

  note(
    diagnostics,
    'warning',
    'NO_INVERTER',
    'Ningún inversor del catálogo cumple simultáneamente potencia, arranque, batería y entrada PV. Revisa el catálogo o añade un modelo compatible.',
  );
  return { inverter: null, panelCount: desiredPanels };
}

const REJECTION_EXPLANATIONS: Record<string, string> = {
  VOLTAGE: 'No declara la tensión que usa tu vivienda.',
  INV_RATED: 'Su potencia continua es menor de la que piden tus equipos a la vez.',
  INV_SURGE: 'No admite el pico de arranque de tus motores o compresores.',
  BATT_VOLTAGE: 'La tensión del banco de baterías no coincide con la que admite.',
  INV_DISCHARGE_A: 'No puede entregar la corriente que exigiría ese arranque.',
  BATT_DISCHARGE_W: 'La batería no puede entregar esa potencia.',
  PV_INPUT: 'No admite toda la potencia de paneles calculada.',
  MPPT: 'Los strings de paneles no entran en los límites de tensión o corriente del MPPT.',
};

export function explainInverterRejections(input: {
  inverters: InverterSpec[];
  panel: PanelSpec;
  battery: BatterySpec;
  params: DesignParams;
  voltage: 110 | 220 | 'both';
  continuousW: number;
  peakW: number;
  panelCount: number;
}): InverterRejection[] {
  return input.inverters
    .map((inverter) => {
      const check = checkInverterCompatibility({ ...input, inverter });
      const codes = [...new Set(check.diagnostics.filter((d) => d.level === 'error').map((d) => d.code))];
      return {
        id: inverter.id,
        model: `${inverter.brand ? inverter.brand + ' ' : ''}${inverter.model}`.trim(),
        reasons: codes.map((code) => REJECTION_EXPLANATIONS[code] ?? code),
      };
    })
    .filter((item) => item.reasons.length > 0);
}

export function computeSizing(input: SizingInput): SizingResult {
  const demand = buildDailyDemand(input.appliances, input.params);
  const energy = analyzeEnergy(input.appliances, input.params, demand);
  const diagnostics: Diagnostic[] = [];
  const continuousW = energy.peakSimultaneousW;
  const peakW = peakDesignW(energy);

  const targetBatteryKwh = requiredBatteryNominalKwh(energy, input.params);
  const batteryCount = batteryCountFor(targetBatteryKwh, input.battery);
  const targetPvW = requiredPvWatts(energy, input.params);

  if (energy.dailyKwh <= 0) {
    note(diagnostics, 'warning', 'NO_LOADS', 'Aún no hay equipos con consumo. Añade equipos en el paso 1.');
  }
  if (batteryCount === 0 && targetBatteryKwh > 0) {
    note(diagnostics, 'error', 'NO_BATTERY', 'La capacidad de batería solicitada no es alcanzable con el modelo elegido.');
  }

  const { inverter, panelCount } = chooseInverterAndPanels({
    ...input,
    continuousW,
    peakW,
    targetPvW,
    diagnostics,
  });

  if (inverter) {
    const check = checkInverterCompatibility({
      inverter,
      battery: input.battery,
      panel: input.panel,
      panelCount,
      continuousW,
      peakW,
      voltage: input.voltage,
      params: input.params,
    });
    diagnostics.push(...check.diagnostics);
    const string = checkStringDesign(input.panel, inverter, input.params);
    diagnostics.push(...string.notes.map((n) => ({ level: 'info' as const, code: 'STRING', message: n })));
  }

  if (panelCount * input.panel.powerW < targetPvW) {
    note(
      diagnostics,
      'warning',
      'PV_LIMITED',
      'La potencia PV se ha limitado a lo que admite el inversor disponible. Puede ser necesario otro inversor o más MPPT.',
    );
  }

  const pack = batteryPack(input.battery, batteryCount, input.params);
  const criticalW = Math.max(
    1,
    Math.max(...demand.map((d) => d.byPriority.critical), 0),
  );
  const autonomy = autonomyHours(pack, criticalW, input.params);

  const inverterRejections = explainInverterRejections({
    inverters: input.inverters,
    panel: input.panel,
    battery: input.battery,
    params: input.params,
    voltage: input.voltage,
    continuousW,
    peakW,
    panelCount,
  });

  const config: EnergySystemConfig | null = inverter
    ? {
        panel: input.panel,
        panelCount,
        battery: input.battery,
        batteryCount,
        inverter,
        appliances: input.appliances,
        grid: input.grid,
        solar: input.solar,
        params: input.params,
      }
    : null;

  return {
    energy,
    targetBatteryKwh,
    batteryCount,
    targetPvW,
    panelCount,
    inverter,
    autonomyH: autonomy,
    diagnostics,
    inverterRejections,
    config,
  };
}

export interface ComparedOption {
  id: 'economica' | 'equilibrada' | 'autonomia';
  label: string;
  description: string;
  panelCount: number;
  batteryCount: number;
  batteryKwh: number;
  pvW: number;
  inverter: InverterSpec | null;
  config: EnergySystemConfig | null;
  warnings: string[];
  capacityNote: string;
  price?: number;
  currency?: 'USD' | 'CUP';
}

/**
 * Tres tamaños derivados de la necesidad real del usuario, no capacidades
 * fijas. Cada opción se valida contra el inversor disponible.
 */
export function buildComparison(input: SizingInput, base: SizingResult): ComparedOption[] {
  const variants: Array<{
    id: ComparedOption['id'];
    label: string;
    description: string;
    batteryFactor: number;
    pvFactor: number;
  }> = [
    {
      id: 'economica',
      label: 'Económica',
      description: 'Prioriza el coste inicial. Puede dejar parte del consumo sin cubrir en apagones largos.',
      batteryFactor: 0.65,
      pvFactor: 0.85,
    },
    {
      id: 'equilibrada',
      label: 'Equilibrada',
      description: 'Cubre el consumo crítico nocturno con el margen de diseño configurado.',
      batteryFactor: 1,
      pvFactor: 1,
    },
    {
      id: 'autonomia',
      label: 'Mayor autonomía',
      description: 'Más almacenamiento para apagones prolongados y mayor margen de recarga.',
      batteryFactor: 1.6,
      pvFactor: 1.15,
    },
  ];

  return variants.map((variant) => {
    const warnings: string[] = [];
    const targetBattery = base.targetBatteryKwh * variant.batteryFactor;
    const suggestedModules = targetBattery > 0 ? batteryCountFor(targetBattery, input.battery) : 0;
    // La simulación usa la capacidad objetivo derivada del consumo, no la
    // capacidad de un módulo comercial fijo. Es una estimación, no un modelo.
    const batteryForOption: BatterySpec = {
      ...input.battery,
      nominalKwh: Math.max(0.01, targetBattery),
      capacityAh: input.battery.nominalV > 0 ? (targetBattery * 1000) / input.battery.nominalV : 0,
      isReference: true,
      note: 'Capacidad objetivo calculada a partir del consumo. Selecciona un modelo real equivalente.',
    };
    const targetPv = base.targetPvW * variant.pvFactor;
    const { inverter, panelCount } = chooseInverterAndPanels({
      ...input,
      battery: batteryForOption,
      continuousW: base.energy.peakSimultaneousW,
      peakW: peakDesignW(base.energy),
      targetPvW: targetPv,
      diagnostics: [],
    });
    if (inverter && panelCount * input.panel.powerW < targetPv) {
      warnings.push('La entrada PV del inversor limita el número de paneles de esta opción.');
    }
    if (!inverter) warnings.push('No hay un inversor compatible con esta combinación.');
    const capacityNote =
      targetBattery > 0
        ? `Capacidad objetivo ${targetBattery.toFixed(2)} kWh · aprox. ${suggestedModules} módulo(s) de ${input.battery.nominalKwh} kWh.`
        : 'Sin almacenamiento: no hay consumo nocturno declarado.';
    const config: EnergySystemConfig | null = inverter
      ? {
          panel: input.panel,
          panelCount,
          battery: batteryForOption,
          batteryCount: targetBattery > 0 ? 1 : 0,
          inverter,
          appliances: input.appliances,
          grid: input.grid,
          solar: input.solar,
          params: input.params,
        }
      : null;
    const price =
      config && inverter && input.panel.price !== undefined && input.battery.price !== undefined && inverter.price !== undefined
        ? panelCount * input.panel.price + suggestedModules * input.battery.price + inverter.price
        : undefined;
    return {
      id: variant.id,
      label: variant.label,
      description: variant.description,
      panelCount,
      batteryCount: suggestedModules,
      batteryKwh: targetBattery,
      pvW: panelCount * input.panel.powerW,
      inverter,
      config,
      warnings,
      capacityNote,
      price,
      currency: inverter?.currency,
    };
  });
}
