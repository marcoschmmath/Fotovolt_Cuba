import type {
  Diagnostic,
  EnergySystemConfig,
  IntervalResult,
  Priority,
  SimulationResult,
  SimulationTotals,
} from '../core/types';
import {
  buildDailyDemand,
  emptyPriorityRecord,
  intervalCount,
  PRIORITIES,
  stepHours,
} from '../calculator/energy';
import { batteryPack } from '../calculator/battery';
import { pvDcPowerAt } from '../calculator/pv';

export interface SimulationOptions {
  days?: number;
  startSoc?: number;
}

/**
 * Tolerancia de desprecio (kWh) para decidir si algo «no se ha servido».
 * 1e-9 kWh = 3,6 mJ: por encima del ruido de coma flotante y muy por debajo
 * de cualquier carga real (15 W durante 15 min ya son 0,0375 kWh). No es un
 * umbral comercial: no oculta interrupciones genuinas.
 */
export const UNSERVED_EPSILON_KWH = 1e-9;

/**
 * Simulación discreta con conservación del balance energético en cada
 * intervalo. La interfaz sólo consume estos resultados.
 *
 * ═══ Convención de energía ═══
 *
 * Dos barreras físicas, dos conjuntos de eficiencias:
 *
 *   Bus DC                     Bus AC
 *   ──────                     ──────
 *   array ──η_inv──→           carga AC
 *   array ──η_carga─→ batería                 (acoplamiento DC por el MPPT;
 *                                              el inversor NO interviene)
 *   red ──η_rectificador──→ batería            (η = params.chargerEfficiency)
 *   red ────────────────→ carga AC             (sin pérdida de inversor)
 *   batería ──η_descarga·η_inv──→ carga AC
 *
 * Los límites del banco (`pack.maxChargeW`/`maxDischargeW`) y del inversor
 * (`maxChargeA·V`/`maxDischargeA·V`) están expresados en el LADO DE LA
 * BATERÍA y actúan sobre la energía DC que entra o sale del almacén:
 *
 *   - Descarga: UN presupuesto por intervalo, compartido entre las tres
 *     prioridades (antes cada prioridad recibía el presupuesto completo y en
 *     un solo intervalo se podían extraer hasta 3× la potencia nominal).
 *   - Carga: UN presupuesto por intervalo, compartido entre la fuente
 *     fotovoltaica y la red (antes cada fuente usaba el presupuesto completo
 *     y la ruta por red omitía además el límite del BMS).
 *
 * `dt` es el paso en HORAS. `kwhPerWatt = dt/1000` es el factor de conversión
 * `kWh = potencia[W] × kwhPerWatt` (no es ni el paso en horas ni un energía).
 */
export function simulate(config: EnergySystemConfig, options: SimulationOptions = {}): SimulationResult {
  const { params, inverter, panel, battery, grid, solar } = config;
  const days = Math.max(1, Math.floor(options.days ?? 1));
  const count = intervalCount(params);
  const dtHours = stepHours(params);
  const kwhPerWatt = dtHours / 1000;

  const demand = config.appliances.length
    ? buildDailyDemand(config.appliances, config.params).map((d) => ({
        critical: d.byPriority.critical,
        important: d.byPriority.important,
        discretionary: d.byPriority.discretionary,
      }))
    : Array.from({ length: count }, () => emptyPriorityRecord());

  const pack = batteryPack(battery, config.batteryCount, params);
  const nominalKwh = Math.max(0.001, pack.nominalKwh);
  const minEnergy = pack.minSoc * nominalKwh;

  const etaInverter = eff(inverter.efficiency) || eff(params.inverterEfficiency) || 0.92;
  const etaCharge = eff(pack.chargeEff);
  const etaDischarge = eff(pack.dischargeEff);
  const etaCharger = eff(params.chargerEfficiency) || 0.95;
  const acPerStoreKwh = Math.max(0.1, etaDischarge * etaInverter);

  const maxChargePowerW = Math.min(
    Math.max(0, pack.maxChargeW),
    Math.max(0, inverter.maxChargeA) * Math.max(0, battery.nominalV),
  );
  const maxDischargePowerW = Math.min(
    Math.max(0, pack.maxDischargeW),
    Math.max(0, inverter.maxDischargeA) * Math.max(0, battery.nominalV),
  );
  const maxChargeEnergyKwh = maxChargePowerW * kwhPerWatt;
  const maxDischargeEnergyKwh = maxDischargePowerW * kwhPerWatt;
  const maxAcOutputKwh = Math.max(0, inverter.ratedW) * kwhPerWatt;
  const maxPvInputKwh = Math.max(0, inverter.maxPvInputW) * kwhPerWatt;
  const maxGridImportKwh = Math.max(0, grid.maxPowerW) * kwhPerWatt;
  const maxGridChargeKwh = Math.max(0, grid.chargerPowerW) * kwhPerWatt;
  const installedW = Math.max(0, config.panelCount) * Math.max(0, panel.powerW);

  let storedKwh = nominalKwh * Math.min(1, Math.max(pack.minSoc, options.startSoc ?? 1));
  const intervals: IntervalResult[] = [];
  const diagnostics: Diagnostic[] = [];
  let maxBalanceErrorKwh = 0;
  let firstCriticalFailure: number | null = null;
  let hitMinSoc = false;
  let hitFullSoc = false;

  const totals: SimulationTotals = {
    demandKwh: 0,
    servedKwh: 0,
    unservedKwh: 0,
    pvProducedKwh: 0,
    pvUsedKwh: 0,
    pvClippedKwh: 0,
    gridKwh: 0,
    batteryChargeKwh: 0,
    batteryDischargeKwh: 0,
    exportedKwh: 0,
    curtailedKwh: 0,
    unservedByPriorityKwh: emptyPriorityRecord(),
    coverage: 0,
    solarFraction: 0,
    maxDemandW: 0,
    finalSoc: 0,
    minSoc: 1,
    peakSurgeW: 0,
  };

  for (let i = 0; i < count * days; i += 1) {
    const stepIndex = i % count;
    // Punto medio del intervalo, igual que buildDailyDemand: PV y demanda se
    // muestrean en el mismo instante (evita medio paso de desfase).
    const hour = (stepIndex + 0.5) * dtHours;
    const gridOn = grid.available[stepIndex] === true;
    const demandStep = demand[stepIndex];
    const previousStoredKwh = storedKwh;

    const demandKwh = PRIORITIES.reduce((sum, p) => sum + demandStep[p], 0) * kwhPerWatt;
    const demandTotalW = PRIORITIES.reduce((sum, p) => sum + demandStep[p], 0);

    // ── Producción fotovoltaica en el bus DC ──
    const pvDcRawKwh = pvDcPowerAt(hour, installedW, solar) * kwhPerWatt;
    const pvDcAvailableKwh = Math.min(pvDcRawKwh, maxPvInputKwh);
    const clippedDcKwh = Math.max(0, pvDcRawKwh - pvDcAvailableKwh);

    // PV DC → AC: sólo la fracción que la carga AC puede absorber y sin
    // superar la potencia nominal. El resto permanece en el bus DC y puede
    // recargar la batería sin invertir y volver a rectificar.
    const dcForAcKwh = Math.min(
      pvDcAvailableKwh,
      Math.min(demandKwh, maxAcOutputKwh) / Math.max(0.1, etaInverter),
    );
    const pvAcProducedKwh = dcForAcKwh * etaInverter;
    const acBudgetLeftKwh = Math.max(0, maxAcOutputKwh - pvAcProducedKwh) / Math.max(0.1, etaInverter);
    let pvAcKwh = pvAcProducedKwh;
    let pvDcKwh = pvDcAvailableKwh - dcForAcKwh;

    let gridUsedKwh = 0;
    let gridToLoadKwh = 0;
    let gridChargeAcKwh = 0;
    let battAcKwh = 0;
    let battDrawnDcKwh = 0;
    let chargedFromPvKwh = 0;
    let chargedFromGridKwh = 0;
    const servedByPriorityKwh = emptyPriorityRecord();
    const unservedByPriorityKwh = emptyPriorityRecord();

    // ── Reparto de demanda por prioridad: críticas primero ──
    let dischargeBudgetKwh = maxDischargeEnergyKwh;
    for (const priority of PRIORITIES) {
      let need = demandStep[priority] * kwhPerWatt;
      totals.demandKwh += need;

      const fromPv = Math.min(pvAcKwh, need);
      pvAcKwh -= fromPv;
      need -= fromPv;
      servedByPriorityKwh[priority] += fromPv;

      if (need > 1e-12) {
        const availableStoreKwh = Math.max(0, storedKwh - minEnergy);
        // Límite aplicado en el lado DC del almacén y consumido una sola vez
        // para todas las prioridades del intervalo.
        const storeDrawnKwh = Math.min(
          availableStoreKwh,
          dischargeBudgetKwh,
          need / acPerStoreKwh,
        );
        const fromBattery = storeDrawnKwh * acPerStoreKwh;
        storedKwh = Math.max(0, storedKwh - storeDrawnKwh);
        battDrawnDcKwh += storeDrawnKwh;
        battAcKwh += fromBattery;
        dischargeBudgetKwh = Math.max(0, dischargeBudgetKwh - storeDrawnKwh);
        need -= fromBattery;
        servedByPriorityKwh[priority] += fromBattery;
      }

      if (need > 1e-12 && gridOn) {
        const fromGrid = Math.min(need, Math.max(0, maxGridImportKwh - gridUsedKwh));
        gridUsedKwh += fromGrid;
        gridToLoadKwh += fromGrid;
        need -= fromGrid;
        servedByPriorityKwh[priority] += fromGrid;
      }

      if (need > 1e-12) {
        unservedByPriorityKwh[priority] += need;
        if (priority === 'critical' && firstCriticalFailure === null) firstCriticalFailure = hour;
      }
    }

    // ── Carga de la batería: un único presupuesto por intervalo ──
    const chargeRoomKwh = Math.max(0, nominalKwh - storedKwh);
    let chargeBudgetKwh = maxChargeEnergyKwh;
    let storedNowKwh = 0;

    // (a) Excedente del array por el bus DC (η_carga, sin η_inv).
    if (pvDcKwh > 1e-12 && etaCharge > 0) {
      const inputFromPvKwh = Math.min(
        pvDcKwh,
        chargeBudgetKwh / etaCharge,
        Math.max(0, chargeRoomKwh - storedNowKwh) / etaCharge,
      );
      chargedFromPvKwh = inputFromPvKwh * etaCharge;
      pvDcKwh -= inputFromPvKwh;
      storedNowKwh += chargedFromPvKwh;
      chargeBudgetKwh = Math.max(0, chargeBudgetKwh - chargedFromPvKwh);
    }

    // (b) Desde la red: cargador (η_rectificador) y batería (η_carga),
    //     además del límite del cargador en AC y del resto de importación.
    if (gridOn && etaCharge > 0 && etaCharger > 0) {
      const acPerStored = 1 / Math.max(0.1, etaCharger * etaCharge);
      const gridSpareKwh = Math.max(0, maxGridImportKwh - gridUsedKwh);
      const inputFromGridKwh = Math.min(
        gridSpareKwh,
        maxGridChargeKwh,
        chargeBudgetKwh * acPerStored,
        Math.max(0, chargeRoomKwh - storedNowKwh) * acPerStored,
      );
      chargedFromGridKwh = inputFromGridKwh * etaCharger * etaCharge;
      gridChargeAcKwh = inputFromGridKwh;
      gridUsedKwh += inputFromGridKwh;
      storedNowKwh += chargedFromGridKwh;
      chargeBudgetKwh = Math.max(0, chargeBudgetKwh - chargedFromGridKwh);
    }
    storedKwh += storedNowKwh;

    // ── Excedente DC: exportación o vertido ──
    let exportedDcKwh = 0;
    let curtailedDcKwh = 0;
    if (pvDcKwh > 1e-9) {
      if (grid.allowExport && gridOn) {
        exportedDcKwh = Math.min(pvDcKwh, acBudgetLeftKwh);
        curtailedDcKwh = pvDcKwh - exportedDcKwh;
      } else {
        curtailedDcKwh = pvDcKwh;
      }
    }
    const exportedAcKwh = exportedDcKwh * etaInverter;

    storedKwh = Math.min(nominalKwh, Math.max(0, storedKwh));
    if (storedKwh <= minEnergy + 1e-9) hitMinSoc = true;
    if (storedKwh >= nominalKwh - 1e-9) hitFullSoc = true;
    const soc = storedKwh / nominalKwh;

    const servedKwh = PRIORITIES.reduce((sum, p) => sum + servedByPriorityKwh[p], 0);
    const unservedKwh = PRIORITIES.reduce((sum, p) => sum + unservedByPriorityKwh[p], 0);

    // ── Balance independiente ──
    // Se comparan magnitudes conocidas por separado, no la misma expresión
    // algebraica a ambos lados:
    //   · demanda construida desde los electrodomésticos vs. servida + no servida
    //   · ΔSOC observado vs. (almacenado − retirado)
    //   · límites de potencia declarados vs. energía realmente usada
    const demandErrorKwh = Math.abs(servedKwh + unservedKwh - demandKwh);
    const storeErrorKwh = Math.abs(
      storedKwh - previousStoredKwh - (storedNowKwh - battDrawnDcKwh),
    );
    const limitErrorKwh = Math.max(
      0,
      gridUsedKwh - maxGridImportKwh,
      battDrawnDcKwh - maxDischargeEnergyKwh,
      storedNowKwh - maxChargeEnergyKwh,
      dcForAcKwh - pvDcAvailableKwh,
    );
    const balanceErrorKwh = Math.max(demandErrorKwh, storeErrorKwh, limitErrorKwh);
    maxBalanceErrorKwh = Math.max(maxBalanceErrorKwh, balanceErrorKwh);

    // ── Pérdidas, sin dobles conteos ──
    const inverterLossKwh =
      dcForAcKwh * (1 - etaInverter) +
      gridChargeAcKwh * (1 - etaCharger) +
      battDrawnDcKwh * etaDischarge * (1 - etaInverter);
    const batteryLossKwh =
      battDrawnDcKwh * (1 - etaDischarge) +
      (chargedFromPvKwh + chargedFromGridKwh) * (1 / Math.max(0.1, etaCharge) - 1);

    totals.pvProducedKwh += pvDcRawKwh;
    totals.pvUsedKwh += dcForAcKwh + (etaCharge > 0 ? chargedFromPvKwh / etaCharge : 0);
    totals.pvClippedKwh += clippedDcKwh;
    totals.gridKwh += gridUsedKwh;
    totals.batteryChargeKwh += storedNowKwh;
    totals.batteryDischargeKwh += battDrawnDcKwh;
    totals.exportedKwh += exportedAcKwh;
    totals.curtailedKwh += curtailedDcKwh;
    totals.servedKwh += servedKwh;
    totals.unservedKwh += unservedKwh;
    for (const p of PRIORITIES) totals.unservedByPriorityKwh[p] += unservedByPriorityKwh[p];
    totals.maxDemandW = Math.max(totals.maxDemandW, demandTotalW);

    intervals.push({
      index: i,
      hour,
      pvDcW: pvDcRawKwh / kwhPerWatt,
      pvAcW: pvAcProducedKwh / kwhPerWatt,
      pvClippedW: clippedDcKwh / kwhPerWatt,
      demandW: demandTotalW,
      demandByPriorityW: { ...demandStep },
      servedW: servedKwh / kwhPerWatt,
      unservedW: unservedKwh / kwhPerWatt,
      servedByPriorityKwh,
      unservedByPriorityKwh,
      gridW: gridUsedKwh / kwhPerWatt,
      gridToLoadW: gridToLoadKwh / kwhPerWatt,
      gridChargeW: gridChargeAcKwh / kwhPerWatt,
      batteryChargeW: storedNowKwh / kwhPerWatt,
      batteryChargePvW: chargedFromPvKwh / kwhPerWatt,
      batteryChargeGridW: chargedFromGridKwh / kwhPerWatt,
      batteryDischargeAcW: battAcKwh / kwhPerWatt,
      batteryDrawnDcW: battDrawnDcKwh / kwhPerWatt,
      exportedW: exportedAcKwh / kwhPerWatt,
      curtailedW: curtailedDcKwh / kwhPerWatt,
      soc,
      inverterLossW: inverterLossKwh / kwhPerWatt,
      batteryLossW: batteryLossKwh / kwhPerWatt,
    });
  }

  totals.coverage = totals.demandKwh > 0 ? totals.servedKwh / totals.demandKwh : 0;
  totals.solarFraction = totals.demandKwh > 0 ? totals.pvUsedKwh / totals.demandKwh : 0;
  totals.finalSoc = socOfLast(intervals, 1);
  totals.minSoc = intervals.reduce((min, x) => Math.min(min, x.soc), 1);
  totals.peakSurgeW = peakDesignWFromConfig(config);

  if (totals.unservedByPriorityKwh.critical > UNSERVED_EPSILON_KWH) {
    diagnostics.push({
      level: 'warning',
      code: 'CRITICAL_UNSERVED',
      message: `La simulación no cubre toda la carga crítica${firstCriticalFailure !== null ? ` (primera vez a las ${formatHour(firstCriticalFailure)})` : ''}. Aumenta batería o producción, o revisa los equipos marcados como imprescindibles.`,
    });
  }
  if (hitMinSoc) {
    diagnostics.push({
      level: 'info',
      code: 'SOC_MIN',
      message: 'La batería alcanzó su estado de carga mínimo durante la simulación.',
    });
  }
  if (hitFullSoc && totals.curtailedKwh > 0.05) {
    diagnostics.push({
      level: 'info',
      code: 'PV_CURTAILED',
      message: 'Existió excedente fotovoltaico que no se pudo almacenar. La batería se llenó antes del final del día.',
    });
  }
  if (totals.pvClippedKwh > 0.05) {
    diagnostics.push({
      level: 'warning',
      code: 'PV_CLIPPED',
      message: 'El inversor limitó parte de la producción PV. Revisa la entrada máxima y los MPPT.',
    });
  }

  return {
    intervals,
    totals,
    diagnostics,
    maxBalanceErrorKwh,
    valid: maxBalanceErrorKwh < 1e-6 * Math.max(1, days),
  };
}

function eff(value: number): number {
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0;
}

function socOfLast(intervals: IntervalResult[], fallback: number): number {
  return intervals.length ? intervals[intervals.length - 1].soc : fallback;
}

function formatHour(hour: number): string {
  const totalMinutes = Math.round(hour * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function peakDesignWFromConfig(config: EnergySystemConfig): number {
  return peakDesignW(analyzeEnergy(config.appliances, config.params));
}

export function unservedEvents(
  result: SimulationResult,
  stepMinutes: number,
): Array<{ hour: number; kwh: number; cause: string }> {
  const kwhPerWatt = stepMinutes / 60 / 1000;
  const events: Array<{ hour: number; kwh: number; cause: string; lastIndex: number }> = [];
  for (const interval of result.intervals) {
    if (interval.unservedW * kwhPerWatt <= UNSERVED_EPSILON_KWH) continue;
    const cause = priorityCause(interval.unservedByPriorityKwh);
    const last = events[events.length - 1];
    // Se compara por índice de intervalo: la hora vuelve a 0 al cruzar la
    // medianoche y por hora los eventos de días distintos se fusionarían.
    if (last && last.cause === cause && interval.index === last.lastIndex + 1) {
      last.kwh += interval.unservedW * kwhPerWatt;
      last.lastIndex = interval.index;
    } else {
      events.push({
        hour: interval.hour,
        kwh: interval.unservedW * kwhPerWatt,
        cause,
        lastIndex: interval.index,
      });
    }
  }
  return events.map(({ hour, kwh, cause }) => ({ hour, kwh, cause }));
}

function priorityCause(unserved: Record<Priority, number>): string {
  if (unserved.critical > UNSERVED_EPSILON_KWH) return 'Falta de energía para equipos imprescindibles';
  if (unserved.important > UNSERVED_EPSILON_KWH) return 'Se desconectaron equipos importantes';
  return 'Se desconectaron equipos prescindibles';
}

// Se importa aquí para evitar un ciclo entre los módulos de carga y simulación.
import { analyzeEnergy, peakDesignW } from '../calculator/energy';

export { PRIORITIES };
