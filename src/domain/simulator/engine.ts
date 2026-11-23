import type {
  Diagnostic,
  EnergySystemConfig,
  IntervalResult,
  Priority,
  SimulationResult,
  SimulationTotals,
} from '../core/types';
import {
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
 * Simulación discreta con conservación del balance energético en cada
 * intervalo. La interfaz sólo consume estos resultados.
 */
export function simulate(config: EnergySystemConfig, options: SimulationOptions = {}): SimulationResult {
  const { params, inverter, panel, battery, grid, solar } = config;
  const days = Math.max(1, Math.floor(options.days ?? 1));
  const count = intervalCount(params);
  const dt = stepHours(params);
  const dtKwh = dt / 1000;
  const demand = config.appliances.length
    ? buildDemandFromAppliances(config)
    : new Array(count).fill(emptyPriorityRecord());
  const pack = batteryPack(battery, config.batteryCount, params);
  const nominalKwh = Math.max(0.001, pack.nominalKwh);
  const minEnergy = pack.minSoc * nominalKwh;
  const maxChargeW = Math.min(pack.maxChargeW, inverter.maxChargeA * battery.nominalV);
  const maxDischargeW = Math.min(pack.maxDischargeW, inverter.maxDischargeA * battery.nominalV);
  const installedW = config.panelCount * panel.powerW;

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
    const hour = stepIndex * dt;
    const gridOn = grid.available[stepIndex] === true;
    const demandStep = demand[stepIndex];

    // --- Generación fotovoltaica ---
    const pvDcRaw = pvDcPowerAt(hour, installedW, solar);
    const dcAccepted = Math.min(pvDcRaw, inverter.maxPvInputW);
    const clippedDc = Math.max(0, pvDcRaw - dcAccepted);
    let pvAc = dcAccepted * inverter.efficiency;
    const clippedAc = Math.max(0, pvAc - inverter.ratedW);
    pvAc = Math.min(pvAc, inverter.ratedW);
    const pvClippedKwh = (clippedDc * inverter.efficiency + clippedAc) * dtKwh;

    let pvKwh = pvAc * dtKwh;
    const pvProducedKwh = pvDcRaw * dtKwh;
    let gridUsedKwh = 0;
    let battAcKwh = 0;
    let battDrawnDcKwh = 0;
    let chargeFromPvKwh = 0;
    let chargeFromGridKwh = 0;
    let exportedKwh = 0;
    let curtailedKwh = 0;
    const servedByPriority = emptyPriorityRecord();
    const unservedByPriority = emptyPriorityRecord();

    // --- Reparto de demanda por prioridad: críticas primero ---
    for (const priority of PRIORITIES) {
      let need = demandStep[priority] * dtKwh;
      totals.demandKwh += need;

      const fromPv = Math.min(pvKwh, need);
      pvKwh -= fromPv;
      need -= fromPv;
      servedByPriority[priority] += fromPv;

      if (need > 1e-12) {
        const availableEnergy = Math.max(0, storedKwh - minEnergy);
        const fromBattery = Math.min(
          need,
          maxDischargeW * dtKwh,
          availableEnergy * pack.dischargeEff * params.inverterEfficiency,
        );
        const drawn = fromBattery / Math.max(0.1, pack.dischargeEff * params.inverterEfficiency);
        storedKwh = Math.max(0, storedKwh - drawn);
        battDrawnDcKwh += drawn;
        battAcKwh += fromBattery;
        need -= fromBattery;
        servedByPriority[priority] += fromBattery;
      }

      if (need > 1e-12 && gridOn) {
        const gridLimitKwh = grid.maxPowerW * dtKwh;
        const fromGrid = Math.min(need, Math.max(0, gridLimitKwh - gridUsedKwh));
        gridUsedKwh += fromGrid;
        need -= fromGrid;
        servedByPriority[priority] += fromGrid;
      }

      if (need > 1e-12) {
        unservedByPriority[priority] += need;
        if (priority === 'critical' && firstCriticalFailure === null) firstCriticalFailure = hour;
      }
    }

    // --- Carga de batería con excedente PV ---
    const chargeRoomKwh = Math.max(0, nominalKwh - storedKwh);
    const maxChargeKwh = maxChargeW * dtKwh;
    if (pvKwh > 1e-12 && pack.chargeEff > 0) {
      chargeFromPvKwh = Math.min(pvKwh, maxChargeKwh, chargeRoomKwh / pack.chargeEff);
      storedKwh += chargeFromPvKwh * pack.chargeEff;
      pvKwh -= chargeFromPvKwh;
    }

    // --- Carga desde red: limitada por potencia real y por horas conectado ---
    if (gridOn) {
      const spareGrid = Math.max(0, grid.maxPowerW * dtKwh - gridUsedKwh);
      const gridChargeLimit = Math.min(
        spareGrid,
        grid.chargerPowerW * dtKwh,
        inverter.maxChargeA * battery.nominalV * dtKwh,
      );
      const roomKwh = Math.max(0, nominalKwh - storedKwh);
      if (gridChargeLimit > 0 && roomKwh > 0 && pack.chargeEff > 0) {
        chargeFromGridKwh = Math.min(gridChargeLimit, roomKwh / pack.chargeEff);
        storedKwh += chargeFromGridKwh * pack.chargeEff;
        gridUsedKwh += chargeFromGridKwh;
      }
    }

    // --- Excedente: exportación opcional o vertido ---
    if (pvKwh > 1e-9) {
      if (grid.allowExport && gridOn) exportedKwh = pvKwh;
      else curtailedKwh = pvKwh;
      pvKwh = 0;
    }

    storedKwh = Math.min(nominalKwh, Math.max(0, storedKwh));
    if (storedKwh <= minEnergy + 1e-9) hitMinSoc = true;
    if (storedKwh >= nominalKwh - 1e-9) hitFullSoc = true;
    const soc = storedKwh / nominalKwh;

    const servedKwh = PRIORITIES.reduce((sum, p) => sum + servedByPriority[p], 0);
    const unservedKwh = PRIORITIES.reduce((sum, p) => sum + unservedByPriority[p], 0);
    const availableKwh = pvAc * dtKwh + gridUsedKwh + battAcKwh;
    const usedKwh =
      servedKwh + chargeFromPvKwh + chargeFromGridKwh + exportedKwh + curtailedKwh;
    const balanceError = Math.abs(availableKwh - usedKwh);
    maxBalanceErrorKwh = Math.max(maxBalanceErrorKwh, balanceError);

    totals.pvProducedKwh += pvProducedKwh;
    totals.pvClippedKwh += pvClippedKwh;
    totals.gridKwh += gridUsedKwh;
    totals.batteryChargeKwh += chargeFromPvKwh + chargeFromGridKwh;
    totals.batteryDischargeKwh += battDrawnDcKwh;
    totals.exportedKwh += exportedKwh;
    totals.curtailedKwh += curtailedKwh;
    totals.servedKwh += servedKwh;
    totals.unservedKwh += unservedKwh;
    totals.pvUsedKwh += pvAc * dtKwh - exportedKwh - curtailedKwh;
    for (const p of PRIORITIES) totals.unservedByPriorityKwh[p] += unservedByPriority[p];
    totals.maxDemandW = Math.max(
      totals.maxDemandW,
      PRIORITIES.reduce((sum, p) => sum + demandStep[p], 0),
    );

    intervals.push({
      index: i,
      hour,
      pvDcW: pvDcRaw,
      pvAcW: pvAc,
      pvClippedW: pvClippedKwh / dtKwh,
      demandW: PRIORITIES.reduce((sum, p) => sum + demandStep[p], 0),
      demandByPriorityW: { ...demandStep },
      servedW: servedKwh / dtKwh,
      unservedW: unservedKwh / dtKwh,
      servedByPriority,
      unservedByPriority,
      gridW: gridUsedKwh / dtKwh,
      batteryChargeW: (chargeFromPvKwh + chargeFromGridKwh) / dtKwh,
      batteryDischargeAcW: battAcKwh / dtKwh,
      batteryDrawnDcW: battDrawnDcKwh / dtKwh,
      exportedW: exportedKwh / dtKwh,
      curtailedW: curtailedKwh / dtKwh,
      soc,
      inverterLossW: (dcAccepted - pvAc + battDrawnDcKwh / dtKwh - battAcKwh / dtKwh),
      batteryLossW: (battDrawnDcKwh / dtKwh) * (1 - pack.dischargeEff),
    });
  }

  totals.coverage = totals.demandKwh > 0 ? totals.servedKwh / totals.demandKwh : 0;
  totals.solarFraction = totals.demandKwh > 0 ? totals.pvUsedKwh / totals.demandKwh : 0;
  totals.finalSoc = socOfLast(intervals, 1);
  totals.minSoc = intervals.reduce((min, x) => Math.min(min, x.soc), 1);
  totals.peakSurgeW = peakDesignWFromConfig(config);

  if (totals.unservedByPriorityKwh.critical > 0.01) {
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

function socOfLast(intervals: IntervalResult[], fallback: number): number {
  return intervals.length ? intervals[intervals.length - 1].soc : fallback;
}

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Se importa aquí para evitar un ciclo entre los módulos de carga y simulación.
import { buildDailyDemand, analyzeEnergy, peakDesignW as peakDesignWFn } from '../calculator/energy';

function buildDemandFromAppliances(config: EnergySystemConfig) {
  return buildDailyDemand(config.appliances, config.params).map((d) => ({
    critical: d.byPriority.critical,
    important: d.byPriority.important,
    discretionary: d.byPriority.discretionary,
  }));
}

function peakDesignWFromConfig(config: EnergySystemConfig): number {
  const energy = analyzeEnergy(config.appliances, config.params);
  return peakDesignWFn(energy);
}

export function unservedEvents(
  result: SimulationResult,
  stepMinutes: number,
): Array<{ hour: number; kwh: number; cause: string }> {
  const dtKwh = stepMinutes / 60 / 1000;
  const events: Array<{ hour: number; kwh: number; cause: string }> = [];
  for (const interval of result.intervals) {
    if (interval.unservedW <= 1) continue;
    const cause = priorityCause(interval.unservedByPriority);
    const last = events[events.length - 1];
    if (last && last.cause === cause && interval.hour - last.hour < 0.5) {
      last.kwh += interval.unservedW * dtKwh;
    } else {
      events.push({
        hour: interval.hour,
        kwh: interval.unservedW * dtKwh,
        cause,
      });
    }
  }
  return events;
}

function priorityCause(unserved: Record<Priority, number>): string {
  if (unserved.critical > 0) return 'Falta de energía para equipos imprescindibles';
  if (unserved.important > 0) return 'Se desconectaron equipos importantes';
  return 'Se desconectaron equipos prescindibles';
}

export { PRIORITIES };
