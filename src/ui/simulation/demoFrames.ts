import type { EnergyFlowFrame } from './energyFlow';
import { INTERVAL_HOURS } from './energyFlow';

/**
 * DATOS FICTICIOS para probar el dibujo y la reproducción del diagrama.
 *
 * Esto NO es el motor de SolarAPP: es un despacho mínimo (sin eficiencias, sin
 * reserva nocturna) que produce frames físicamente coherentes. Bórralo cuando
 * el adaptador de `IntervalResult` esté conectado.
 */
export interface DemoFramesOptions {
  /** Hora de inicio de la ventana de red (0–23). */
  gridStartHour?: number;
  gridHours?: number;
  panelPeakW?: number;
  batteryCapacityWh?: number;
  minSocPct?: number;
  startSocPct?: number;
  batteryPowerLimitW?: number;
  gridLimitW?: number;
}

const clock = (interval: number): string => {
  const minutes = interval * 15;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
};

function demoSolarW(hour: number, peakW: number): number {
  if (hour < 6.5 || hour > 18.5) return 0;
  const s = Math.max(0, Math.sin((Math.PI * (hour - 6.5)) / 12));
  return peakW * s ** 1.5;
}

function demoLoadW(hour: number): number {
  let w = 180; // nevera
  if (hour >= 22 || hour < 6) w += 300; // ventilador de noche
  if (hour >= 7 && hour < 8) w += 1000; // desayuno
  if (hour >= 11.5 && hour < 12.5) w += 1500; // almuerzo
  if (hour >= 18.5 && hour < 19.5) w += 1500; // comida
  if (hour >= 18 && hour < 22) w += 300; // luces y TV
  return w;
}

export function buildDemoFrames(options: DemoFramesOptions = {}): EnergyFlowFrame[] {
  const {
    gridStartHour = 9,
    gridHours = 3,
    panelPeakW = 2400,
    batteryCapacityWh = 5000,
    minSocPct = 20,
    startSocPct = 90,
    batteryPowerLimitW = 2000,
    gridLimitW = 3000,
  } = options;

  const minWh = (batteryCapacityWh * minSocPct) / 100;
  let energyWh = (batteryCapacityWh * startSocPct) / 100;
  const frames: EnergyFlowFrame[] = [];

  for (let i = 0; i < 96; i += 1) {
    const hour = i * INTERVAL_HOURS;
    const pv = demoSolarW(hour, panelPeakW);
    const load = demoLoadW(hour);
    const gridAvailable = (hour - gridStartHour + 24) % 24 < gridHours;

    // 1) PV alimenta cargas; 2) la red cubre el resto; 3) la batería, si aún falta.
    const pvToLoadW = Math.min(pv, load);
    let remaining = load - pvToLoadW;
    const gridToLoadW = gridAvailable ? Math.min(remaining, gridLimitW) : 0;
    remaining -= gridToLoadW;

    const maxDischargeW = Math.max(0, (energyWh - minWh) / INTERVAL_HOURS);
    const batteryToLoadW = Math.min(remaining, batteryPowerLimitW, maxDischargeW);

    // 4) El excedente PV carga batería; lo que sobra se pierde (sin exportación).
    const pvSurplusW = pv - pvToLoadW;
    const maxChargeW = Math.min(
      batteryPowerLimitW,
      Math.max(0, (batteryCapacityWh - energyWh) / INTERVAL_HOURS),
    );
    const pvToBatteryW = Math.min(pvSurplusW, maxChargeW);
    const pvCurtailedW = pvSurplusW - pvToBatteryW;

    // 5) Con red disponible, el margen de importación también recarga la batería.
    const gridHeadroomW = gridAvailable ? gridLimitW - gridToLoadW : 0;
    const gridToBatteryW = Math.min(gridHeadroomW, maxChargeW - pvToBatteryW);

    energyWh += (pvToBatteryW + gridToBatteryW - batteryToLoadW) * INTERVAL_HOURS;

    const servedW = pvToLoadW + gridToLoadW + batteryToLoadW;
    const unservedW = Math.max(0, load - servedW);
    frames.push({
      time: clock(i),
      pvProductionDcW: pv,
      pvToLoadAcW: pvToLoadW,
      pvToBatteryStoredW: pvToBatteryW,
      gridToLoadAcW: gridToLoadW,
      gridToBatteryAcW: gridToBatteryW,
      batteryToLoadAcW: batteryToLoadW,
      loadDemandAcW: load,
      loadServedAcW: servedW,
      loadUnservedAcW: unservedW,
      batteryChargeStoredW: pvToBatteryW + gridToBatteryW,
      batterySoc: (energyWh / batteryCapacityWh) * 100,
      gridAvailable,
      pvCurtailedDcW: pvCurtailedW,
      pvClippedDcW: 0,
    });
  }

  return frames;
}
