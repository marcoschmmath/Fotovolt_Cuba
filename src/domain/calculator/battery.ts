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

export function batteryPack(
  battery: BatterySpec,
  count: number,
  params: DesignParams,
): BatteryPack {
  const nominalKwh = battery.nominalKwh * Math.max(0, count);
  const minSoc = Math.min(0.9, Math.max(params.minSoc, 1 - battery.dod));
  return {
    nominalKwh,
    usableKwh: Math.max(0, nominalKwh * (1 - minSoc)),
    minSoc,
    maxChargeW: battery.maxChargeW * Math.max(0, count),
    maxDischargeW: battery.maxDischargeW * Math.max(0, count),
    chargeEff: battery.chargeEff,
    dischargeEff: battery.dischargeEff,
    count,
  };
}

/**
 * C_b = (E_n · A) / (DoD · η)
 * η agrupa eficiencia de descarga e inversor: la energía nocturna se entrega
 * en AC, por lo que desde la batería hay que retirar más energía.
 */
export function requiredBatteryNominalKwh(
  energy: EnergyBreakdown,
  params: DesignParams,
): number {
  const eta = Math.max(0.1, params.batteryDischargeEff * params.inverterEfficiency);
  const autonomy = Math.max(0, params.autonomyDays);
  return (energy.nightKwh * autonomy) / (Math.max(0.1, params.dod) * eta);
}

/** Carga necesaria para reponer la energía consumida en batería cada día. */
export function dailyRechargeKwh(energy: EnergyBreakdown, params: DesignParams): number {
  const eta = Math.max(0.1, params.batteryChargeEff * params.inverterEfficiency);
  return energy.nightKwh / eta;
}

export function batteryCountFor(targetKwh: number, battery: BatterySpec): number {
  if (battery.nominalKwh <= 0) return 0;
  return Math.max(0, Math.ceil(targetKwh / battery.nominalKwh));
}

/** Autonomía derivada de la carga crítica real, no de una cifra fija. */
export function autonomyHours(
  pack: BatteryPack,
  criticalAcW: number,
  params: DesignParams,
): number {
  if (criticalAcW <= 0 || pack.usableKwh <= 0) return 0;
  const acDeliverable =
    pack.usableKwh * 1000 * pack.dischargeEff * params.inverterEfficiency;
  return acDeliverable / criticalAcW;
}

export function dischargeCurrentA(powerAcW: number, battery: BatterySpec, params: DesignParams): number {
  return powerAcW / Math.max(1, battery.nominalV * battery.dischargeEff * params.inverterEfficiency);
}
