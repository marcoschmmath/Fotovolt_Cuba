/**
 * Puente entre las entidades del producto (hogar + instalación) y el motor
 * físico (`EnergySystemConfig`). El motor no sabe qué es un hogar ni una
 * instalación: aquí se traduce, con las mismas reglas para TODAS las
 * instalaciones, para que las comparaciones sean coherentes.
 */

import type {
  Appliance,
  DesignParams,
  EnergySystemConfig,
  GridModel,
  InverterSpec,
  Priority,
} from '../core/types';
import { solarFromParams } from '../core/defaults';
import type { HouseholdProfile } from '../household/types';
import { effectivePriority, isNightEssential } from '../household/types';
import type { SystemConfiguration } from '../system/types';
import { batteryPack } from '../calculator/battery';
import { inverterWithParallelUnits } from '../calculator/inverter';
import { buildDailyDemand } from '../calculator/energy';

export interface Catalog {
  panels: Array<{ id: string }>;
  batteries: Array<{ id: string }>;
  inverters: Array<{ id: string }>;
}

/**
 * Eficiencia del inversor con la MISMA precedencia que usa el motor: primero
 * la del equipo, luego la de los parámetros, luego 0,92. La reserva nocturna y
 * la simulación no pueden usar eficiencias distintas.
 */
export function effectiveInverterEfficiency(
  inverter: Pick<InverterSpec, 'efficiency'> | null | undefined,
  params: DesignParams,
): number {
  const declared: number | undefined = inverter?.efficiency;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0 && declared <= 1) return declared;
  if (Number.isFinite(params.inverterEfficiency) && params.inverterEfficiency > 0 && params.inverterEfficiency <= 1) {
    return params.inverterEfficiency;
  }
  return 0.92;
}

export interface BridgeInput {
  household: HouseholdProfile;
  system: SystemConfiguration;
  /** Equipo resuelto por id desde el catálogo del usuario. */
  panel: EnergySystemConfig['panel'];
  battery: EnergySystemConfig['battery'];
  inverter: EnergySystemConfig['inverter'];
  /** Disponibilidad de red del escenario (longitud = intervalos del día). */
  gridAvailable: boolean[];
}

/** Prioridad efectiva de un equipo: los esenciales de noche no caen a «opcional». */
function householdAppliances(household: HouseholdProfile): Appliance[] {
  return household.appliances.map((appliance) => ({
    ...appliance,
    priority: effectivePriority(appliance, household.night) as Priority,
  }));
}

/** Configuración física a simular para este hogar y esta instalación. */
export function buildEnergySystemConfig(input: BridgeInput): EnergySystemConfig {
  const grid: GridModel = {
    available: input.gridAvailable,
    maxPowerW: Math.max(0, input.system.params.gridMaxPowerW),
    voltage: input.household.voltage,
  };
  return {
    panel: input.panel,
    panelCount: Math.max(0, input.system.panelCount),
    battery: input.battery,
    batteryCount: Math.max(0, input.system.batteryCount),
    inverter: inverterWithParallelUnits(input.inverter, input.system.inverterCount ?? 1),
    appliances: householdAppliances(input.household),
    grid,
    solar: solarFromParams(input.system.params),
    params: input.system.params,
  };
}

/**
 * Suelo de SOC por intervalo (§6): de día la batería no baja de la reserva
 * que necesitan los equipos esenciales de noche; de noche baja al suelo
 * mínimo del banco (DoD/manufacturero).
 *
 * La reserva NO es un porcentaje arbitrario: se calcula con la energía
 * nocturna real de los equipos que el hogar marcó como esenciales,
 * convertida a energía interna mediante las eficiencias de descarga.
 */
export function nightReserveSoc(
  household: HouseholdProfile,
  params: DesignParams,
  battery: EnergySystemConfig['battery'],
  batteryCount: number,
  inverter?: Pick<InverterSpec, 'efficiency'> | null,
): number {
  if (!household.night.essentialIds.length) return 0;
  const essentials = household.appliances.filter((a) => isNightEssential(a, household.night) && a.quantity > 0);
  if (!essentials.length) return 0;
  const demand = buildDailyDemand(essentials, params);
  const dt = params.stepMinutes / 60;
  const nightKwh = demand.reduce((sum, interval) => {
    const isNight =
      params.nightStart !== params.nightEnd &&
      ((interval.hour >= params.nightStart && interval.hour < 24) ||
        (interval.hour >= 0 && interval.hour < params.nightEnd));
    return sum + (isNight ? (interval.totalW * dt) / 1000 : 0);
  }, 0);
  const pack = batteryPack(battery, batteryCount, params);
  const etaDischarge = Math.max(0.1, pack.dischargeEff);
  const etaInverter = effectiveInverterEfficiency(inverter, params);
  const storedKwh = nightKwh / (etaDischarge * etaInverter);
  const reserveSoc = pack.minSoc + storedKwh / Math.max(0.001, pack.nominalKwh);
  return Math.min(1, Math.max(pack.minSoc, reserveSoc));
}

/** Suelo por intervalo: de día reserva, de noche suelo del banco. */
export function socFloorByInterval(
  household: HouseholdProfile,
  params: DesignParams,
  battery: EnergySystemConfig['battery'],
  batteryCount: number,
  inverter?: Pick<InverterSpec, 'efficiency'> | null,
): number[] {
  const pack = batteryPack(battery, batteryCount, params);
  const reserve = nightReserveSoc(household, params, battery, batteryCount, inverter);
  const count = Math.round((24 * 60) / params.stepMinutes);
  const dt = params.stepMinutes / 60;
  return Array.from({ length: count }, (_, index) => {
    const hour = (index + 0.5) * dt;
    const isNight =
      params.nightStart !== params.nightEnd &&
      ((hour >= params.nightStart && hour < 24) || (hour >= 0 && hour < params.nightEnd));
    return isNight ? pack.minSoc : reserve;
  });
}

/** Energía nocturna esencial declarada por el hogar (kWh/día). */
export function nightEssentialKwh(household: HouseholdProfile, params: DesignParams): number {
  const essentials = household.appliances.filter((a) => isNightEssential(a, household.night) && a.quantity > 0);
  if (!essentials.length) return 0;
  const dt = params.stepMinutes / 60;
  return buildDailyDemand(essentials, params).reduce((sum, interval) => {
    const isNight =
      params.nightStart !== params.nightEnd &&
      ((interval.hour >= params.nightStart && interval.hour < 24) || (interval.hour >= 0 && interval.hour < params.nightEnd));
    return sum + (isNight ? (interval.totalW * dt) / 1000 : 0);
  }, 0);
}