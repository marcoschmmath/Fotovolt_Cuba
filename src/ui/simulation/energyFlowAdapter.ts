import type { IntervalResult } from '../../domain/core/types';
import type { EnergyFlowFrame } from './energyFlow';

/**
 * Traduce cada intervalo del motor al contrato visual.
 * Se conservan las fronteras eléctricas indicadas por IntervalResult:
 * AC, DC del array y lado de almacenamiento de la batería.
 * La hora mostrada es el INICIO del intervalo.
 */
export function toEnergyFlowFrames(
  intervals: IntervalResult[],
  stepMinutes: number,
  gridAvailability: boolean[],
): EnergyFlowFrame[] {
  return intervals.map((interval) => {
    // `index` es el orden del reproductor; `clockIndex` conserva la hora civil
    // cuando la simulación empieza, por ejemplo, a las 08:00 y cruza medianoche.
    const clockIndex = interval.clockIndex ?? interval.index;
    const minuteOfDay = (clockIndex * stepMinutes) % (24 * 60);
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;

    return {
      time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      pvProductionDcW: interval.pvDcW,
      pvToLoadAcW: interval.pvAcW,
      pvToBatteryStoredW: interval.batteryChargePvW,
      gridToLoadAcW: interval.gridToLoadW,
      gridToBatteryAcW: interval.gridChargeW,
      batteryToLoadAcW: interval.batteryDischargeAcW,
      loadDemandAcW: interval.demandW,
      loadServedAcW: interval.servedW,
      loadUnservedAcW: interval.unservedW,
      batteryChargeStoredW: interval.batteryChargeW,
      batterySoc: interval.soc * 100,
      gridAvailable: gridAvailability[clockIndex] === true,
      activeLoads: interval.activeLoads ?? [],
      pvCurtailedDcW: interval.curtailedW,
      pvClippedDcW: interval.pvClippedW,
    };
  });
}
