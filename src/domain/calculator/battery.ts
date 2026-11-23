import type { BatterySpec, DesignParams } from '../core/types';
import type { EnergyBreakdown } from './energy';

export interface BatteryPack {
  nominalKwh: number;
  usableKwh: number;
  minSoc: number;
  maxChargeW: number;
  maxDischargeW: number;
  chargeEff: number;
  dischargeEff: number;
  count: number;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Eficiencia válida para usar en un denominador. */
function eta(value: number): number {
  return Math.min(1, Math.max(0.1, Number.isFinite(value) ? value : 0.1));
}

/**
 * SOC mínimo efectivo. ÚNICA definición de capacidad utilizable de la app.
 *
 * Convención de los tres límites (todos son restricciones independientes de
 * descarga, de modo que se aplica el SOC más restrictivo de los tres):
 *
 *   - `params.minSoc`   : suelo configurado por el usuario (hipótesis).
 *   - `params.dod`      : profundidad de descarga máxima admisible por diseño.
 *   - `battery.dod`     : profundidad de descarga máxima del fabricante.
 *
 *      minSocEfectivo = min(0.9, max(minSoc, 1 − dodDiseño, 1 − dodFabricante))
 *
 * El tope de 0,9 garantiza que siempre quede al menos un 10 % utilizable.
 * El dimensionamiento (`requiredBatteryNominalKwh`) y el simulador
 * (`batteryPack`, que es el que usa el motor) comparten esta función, de modo
 * que la batería recomendada nunca queda por debajo de lo que la simulación
 * considera utilizable.
 */
export function effectiveMinSoc(
  params: DesignParams,
  battery?: Pick<BatterySpec, 'dod'> | null,
): number {
  const floors = [clamp01(params.minSoc), 1 - clamp01(params.dod)];
  if (battery) floors.push(1 - clamp01(battery.dod));
  return Math.min(0.9, Math.max(...floors));
}

/** Fracción de la capacidad nominal realmente utilizable (0 ≤ f ≤ 1). */
export function usableFraction(
  params: DesignParams,
  battery?: Pick<BatterySpec, 'dod'> | null,
): number {
  return Math.max(0, 1 - effectiveMinSoc(params, battery));
}

export function batteryPack(
  battery: BatterySpec,
  count: number,
  params: DesignParams,
): BatteryPack {
  const nominalKwh = battery.nominalKwh * Math.max(0, count);
  const minSoc = effectiveMinSoc(params, battery);
  return {
    nominalKwh,
    usableKwh: Math.max(0, nominalKwh * (1 - minSoc)),
    minSoc,
    maxChargeW: battery.maxChargeW * Math.max(0, count),
    maxDischargeW: battery.maxDischargeW * Math.max(0, count),
    chargeEff: clamp01(battery.chargeEff),
    dischargeEff: clamp01(battery.dischargeEff),
    count,
  };
}

/** η de la cadena de descarga batería → carga AC: descarga · inversor. */
function dischargeChain(params: DesignParams, battery?: Pick<BatterySpec, 'dischargeEff'> | null): number {
  return eta(battery?.dischargeEff ?? params.batteryDischargeEff) * eta(params.inverterEfficiency);
}

/** η de la cadena de carga: corriente continua → almacén (η_chg) más rectificador. */
function chargeChain(
  params: DesignParams,
  battery?: Pick<BatterySpec, 'chargeEff'> | null,
): { etaCharge: number; etaRectifier: number } {
  return {
    etaCharge: eta(battery?.chargeEff ?? params.batteryChargeEff),
    etaRectifier: eta(params.chargerEfficiency),
  };
}

/**
 * C_b = (E_n · A) / (f_util · η_descarga)
 *
 * Fronteras de energía:
 *   1. `energy.nightKwh` es energía AC consumida por la carga nocturna.
 *   2. Para entregarla en AC hay que retirar del almacén
 *      `nightKwh / (η_descarga · η_inversor)`.
 *   3. Eso es exactamente lo que hay que volver a almacenar.
 *   4. `f_util = 1 − minSocEfectivo` convierte esa energía utilizable en
 *      capacidad nominal, con un único DoD (ver `effectiveMinSoc`).
 */
export function requiredBatteryNominalKwh(
  energy: EnergyBreakdown,
  params: DesignParams,
  battery?: Pick<BatterySpec, 'dod' | 'dischargeEff'> | null,
): number {
  if (energy.nightKwh <= 0) return 0;
  const usable = Math.max(0.1, usableFraction(params, battery));
  const autonomy = Math.max(0, params.autonomyDays);
  return (energy.nightKwh * autonomy) / (usable * dischargeChain(params, battery));
}

/**
 * Energía DC que el array debe producir cada día, además del consumo directo
 * diurno, para reponer la batería tras la descarga nocturna.
 *
 * Cadenas implicadas, sin repetir ninguna eficiencia dos veces:
 *   - AC nocturno → almacén : `nightKwh / (η_descarga · η_inversor)`
 *     (el inversor sí está en la descarga: batería DC → carga AC).
 *   - Almacén repuesto 1:1 con la energía retirada.
 *   - DC del array → almacén : `× 1/η_carga` (acoplamiento DC por el MPPT,
 *     el inversor DC→AC NO interviene en esta ruta).
 *
 * Devuelve energía DC de panel, la misma base que usa `requiredPvWatts`.
 */
export function dailyRechargeKwh(
  energy: EnergyBreakdown,
  params: DesignParams,
  battery?: Pick<BatterySpec, 'dischargeEff' | 'chargeEff'> | null,
): number {
  if (energy.nightKwh <= 0) return 0;
  const { etaCharge } = chargeChain(params, battery);
  return energy.nightKwh / Math.max(0.1, dischargeChain(params, battery) * etaCharge);
}

export function batteryCountFor(targetKwh: number, battery: BatterySpec): number {
  if (battery.nominalKwh <= 0) return 0;
  return Math.max(0, Math.ceil(targetKwh / battery.nominalKwh));
}

/**
 * UNA sola definición de autonomía (C5/M9): horas que la batería puede
 * sostener una carga crítica AC constante, partiendo de SOC completo y sin
 * sol ni red. Devuelve 0 cuando no hay carga crítica ni capacidad utilizable
 * (antes un `Math.max(1, …)` en el llamante convertía eso en 3496 h).
 */
export function autonomyHours(
  pack: BatteryPack,
  criticalAcW: number,
  params: DesignParams,
): number {
  if (!(criticalAcW > 0) || pack.usableKwh <= 0) return 0;
  const acDeliverable = pack.usableKwh * 1000 * dischargeChain(params, {
    dischargeEff: pack.dischargeEff,
  });
  return acDeliverable / criticalAcW;
}

/**
 * Corriente de descarga estimada para una potencia AC dada (lado batería).
 */
export function dischargeCurrentA(powerAcW: number, battery: BatterySpec, params: DesignParams): number {
  const chain = eta(battery.dischargeEff) * eta(params.inverterEfficiency);
  return powerAcW / Math.max(1, battery.nominalV * chain);
}
