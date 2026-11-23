import type { Appliance, DesignParams, Priority } from '../core/types';

export interface DemandInterval {
  index: number;
  hour: number;
  byPriority: Record<Priority, number>;
  totalW: number;
}

export interface EnergyBreakdown {
  /** E_d = Σ(Pᵢ·nᵢ·hᵢ)/1000, en kWh. */
  dailyKwh: number;
  /** E_n = energía consumida en franja nocturna, en kWh. */
  nightKwh: number;
  dayKwh: number;
  criticalKwh: number;
  byPriorityKwh: Record<Priority, number>;
  /** Potencia media de demanda. */
  averageW: number;
  /** Máxima potencia simultánea de la serie temporal. */
  peakSimultaneousW: number;
  peaks: PeakInfo[];
}

export interface PeakInfo {
  applianceId: string;
  name: string;
  runningW: number;
  surgeW: number;
  extraW: number;
}

export const PRIORITIES: Priority[] = ['critical', 'important', 'discretionary'];

export function emptyPriorityRecord(): Record<Priority, number> {
  return { critical: 0, important: 0, discretionary: 0 };
}

export function wrapHours(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

export function hoursBetween(start: number, end: number): number {
  const span = wrapHours(end - start);
  return span === 0 ? 24 : span;
}

export function isWithinWindow(hour: number, start: number, end: number): boolean {
  const h = wrapHours(hour);
  const s = wrapHours(start);
  const e = wrapHours(end);
  if (s === e) return true;
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
}

export function intervalCount(params: DesignParams): number {
  return Math.round((24 * 60) / params.stepMinutes);
}

export function stepHours(params: DesignParams): number {
  return params.stepMinutes / 60;
}

/**
 * Potencia eléctrica efectiva. Si el usuario sólo introdujo BTU/h, se estima
 * con un EER configurable y se marca como aproximada; si introdujo la potencia
 * de la placa, ésta tiene prioridad.
 */
export function effectivePowerW(appliance: Appliance, params: DesignParams): number {
  if (appliance.btuPerHour && appliance.btuPerHour > 0 && appliance.powerIsEstimate !== false) {
    const eer = appliance.eer && appliance.eer > 0 ? appliance.eer : params.acEer;
    return appliance.btuPerHour / eer;
  }
  return appliance.powerW;
}

/** Fracción de un intervalo en la que un equipo con ciclo de trabajo está activo. */
export function dutyOnFraction(
  offsetHours: number,
  dt: number,
  dutyCycle: number,
  periodHours: number,
): number {
  const duty = Math.min(1, Math.max(0, dutyCycle));
  if (duty >= 1) return 1;
  if (duty <= 0) return 0;
  const period = Math.max(1e-6, periodHours);
  const onWindow = period * duty;
  let on = 0;
  let t = offsetHours;
  const end = offsetHours + dt;
  let guard = 0;
  while (t < end - 1e-9 && guard < 1000) {
    const rawPhase = wrapPeriod(t, period);
    // Evita que un error de coma flotante cerca del límite de periodo
    // produzca pasos infinitamente pequeños y pérdida de energía.
    const phase = rawPhase > period - 1e-9 ? 0 : rawPhase;
    const remainingInPeriod = period - phase;
    const next = Math.min(t + (remainingInPeriod > 1e-12 ? remainingInPeriod : period), end);
    const phaseEnd = phase + (next - t);
    on += Math.max(0, Math.min(phaseEnd, onWindow) - phase);
    t = next;
    guard += 1;
  }
  return Math.min(1, on / dt);
}

function wrapPeriod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

interface ActiveWindow {
  start: number;
  hours: number;
}

function windowsFor(appliance: Appliance, params: DesignParams): ActiveWindow[] {
  const h = Math.max(0, Math.min(24, appliance.hoursPerDay));
  if (h === 0) return [];
  if (appliance.schedule === 'custom') {
    return [{ start: appliance.startHour, hours: h }];
  }
  if (appliance.schedule === 'day') {
    return [{ start: params.dayStart, hours: h }];
  }
  if (appliance.schedule === 'night') {
    return [{ start: params.nightStart, hours: h }];
  }
  // 'both': se reparte proporcionalmente según la duración de cada franja.
  const dayLen = hoursBetween(params.dayStart, params.nightStart);
  const nightLen = 24 - dayLen;
  const dayHours = h * (dayLen / 24);
  return [
    { start: params.dayStart, hours: Math.min(dayLen, dayHours) },
    { start: params.nightStart, hours: Math.min(nightLen, h - dayHours) },
  ];
}

function isActiveAt(hour: number, window: ActiveWindow): boolean {
  const offset = wrapHours(hour - window.start);
  return offset < window.hours;
}

function offsetIn(hour: number, window: ActiveWindow): number {
  return wrapHours(hour - window.start);
}

/**
 * Construye la demanda eléctrica AC de cada intervalo del día, respetando
 * prioridades. Es la única fuente de demanda usada por el dimensionamiento y
 * por el simulador, para que ambos sean coherentes.
 */
export function buildDailyDemand(
  appliances: Appliance[],
  params: DesignParams,
): DemandInterval[] {
  const count = intervalCount(params);
  const dt = stepHours(params);
  const intervals: DemandInterval[] = [];
  const period = params.cyclicCycleMinutes / 60;

  for (let i = 0; i < count; i += 1) {
    const hour = (i + 0.5) * dt;
    const byPriority = emptyPriorityRecord();
    for (const appliance of appliances) {
      if (!appliance || appliance.quantity <= 0) continue;
      const rated = effectivePowerW(appliance, params);
      if (rated <= 0) continue;
      for (const window of windowsFor(appliance, params)) {
        if (!isActiveAt(hour, window)) continue;
        const offset = offsetIn(hour, window);
        let fraction: number;
        if (appliance.profile === 'cyclic') {
          fraction = dutyOnFraction(offset, dt, appliance.dutyCycle, period);
        } else if (appliance.profile === 'modulated') {
          const shape = 1 + 0.35 * Math.cos((2 * Math.PI * offset) / Math.max(window.hours, 0.1));
          fraction = Math.max(0, Math.min(1.3, appliance.dutyCycle * shape));
        } else {
          fraction = appliance.dutyCycle;
        }
        byPriority[appliance.priority] += rated * appliance.quantity * fraction;
      }
    }
    const totalW = PRIORITIES.reduce((sum, p) => sum + byPriority[p], 0);
    intervals.push({ index: i, hour, byPriority, totalW });
  }
  return intervals;
}

export function analyzeEnergy(
  appliances: Appliance[],
  params: DesignParams,
  demand = buildDailyDemand(appliances, params),
): EnergyBreakdown {
  const dt = stepHours(params);
  const byPriorityKwh = emptyPriorityRecord();
  let dailyKwh = 0;
  let nightKwh = 0;
  let dayKwh = 0;
  let peak = 0;
  for (const interval of demand) {
    const kwh = (interval.totalW * dt) / 1000;
    dailyKwh += kwh;
    peak = Math.max(peak, interval.totalW);
    for (const p of PRIORITIES) byPriorityKwh[p] += (interval.byPriority[p] * dt) / 1000;
    const isNight =
      isWithinWindow(interval.hour, params.nightStart, params.nightEnd) &&
      params.nightStart !== params.nightEnd;
    if (isNight) nightKwh += kwh;
    else dayKwh += kwh;
  }

  const peaks: PeakInfo[] = appliances
    .filter((a) => a.quantity > 0 && a.surgeFactor > 1.01)
    .map((a) => {
      const runningW = effectivePowerW(a, params) * a.quantity;
      return {
        applianceId: a.id,
        name: a.name,
        runningW,
        surgeW: runningW * a.surgeFactor,
        extraW: runningW * (a.surgeFactor - 1),
      };
    })
    .sort((a, b) => b.extraW - a.extraW);

  return {
    dailyKwh,
    nightKwh,
    dayKwh,
    criticalKwh: byPriorityKwh.critical,
    byPriorityKwh,
    averageW: (dailyKwh * 1000) / 24,
    peakSimultaneousW: peak,
    peaks,
  };
}

/**
 * Demanda de pico a efectos de inversor: potencia simultánea más el arranque
 * del motor individual más grande. No suma todos los arranques a la vez
 * (sería conservador en exceso) y tampoco ignora los picos.
 */
export function peakDesignW(energy: EnergyBreakdown): number {
  const largestExtra = energy.peaks.reduce((max, p) => Math.max(max, p.extraW), 0);
  return energy.peakSimultaneousW + largestExtra;
}

export function appliancePowerInput(
  appliance: Appliance,
  params: DesignParams,
): { watts: number; estimatedFromBtu: boolean } {
  return {
    watts: effectivePowerW(appliance, params),
    estimatedFromBtu: Boolean(
      appliance.btuPerHour && appliance.btuPerHour > 0 && appliance.powerIsEstimate !== false,
    ),
  };
}
