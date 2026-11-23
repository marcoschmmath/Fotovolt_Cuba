import type { DesignParams, InverterSpec, PanelSpec, SolarInputs } from '../core/types';

/** Irradiancia instantánea (W/m²) con forma senoidal y área igual a HSP. */
export function irradianceAt(hour: number, solar: SolarInputs): number {
  const dayLength = solar.sunset - solar.sunrise;
  if (dayLength <= 0 || solar.hsp <= 0 || hour < solar.sunrise || hour > solar.sunset) return 0;
  const peak = (solar.hsp * 1000 * Math.PI) / (2 * dayLength);
  return Math.max(0, peak * Math.sin((Math.PI * (hour - solar.sunrise)) / dayLength));
}

/** Temperatura estimada de célula y factor de potencia térmico. */
export function cellConditions(
  irradianceWm2: number,
  solar: SolarInputs,
): { cellC: number; derate: number } {
  const cellC = solar.ambientC + ((solar.noct - 20) / 800) * irradianceWm2;
  const raw = 1 + solar.tempCoeffPmpp * (cellC - 25);
  return { cellC, derate: Math.min(1.1, Math.max(0.6, raw)) };
}

/** Potencia DC generada por el array antes de los límites del inversor. */
export function pvDcPowerAt(
  hour: number,
  installedW: number,
  solar: SolarInputs,
): number {
  const g = irradianceAt(hour, solar);
  if (g <= 0 || installedW <= 0) return 0;
  const { derate } = cellConditions(g, solar);
  return Math.max(
    0,
    installedW * (g / 1000) * derate * solar.tiltFactor * (1 - solar.shading),
  );
}

/**
 * Estado de la comprobación de strings:
 *  - `verified`     : hay datos suficientes y se cumplen todas las restricciones.
 *  - `incompatible` : hay datos suficientes y alguna restricción se incumple.
 *  - `insufficient` : faltan datos eléctricos: NO se puede verificar nada.
 */
export type StringStatus = 'verified' | 'incompatible' | 'insufficient';

export interface StringCheck {
  minSeries: number;
  maxSeries: number;
  recommendedSeries: number;
  maxParallelPerMppt: number;
  maxDcWattsPerMppt: number;
  vocColdV: number;
  vmpHotV: number;
  feasible: boolean;
  status: StringStatus;
  notes: string[];
  violations: string[];
}

/**
 * Valor estrictamente positivo y finito; cualquier otro caso es «dato ausente».
 */
function isPositiveFinite(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Preferencia de configuración por string: 3 módulos es un punto de partida
 * habitual que deja margen de tensión en frío. NO es un máximo: si la ventana
 * factible no lo admite se usa el valor factible más próximo, y si la ventana
 * está vacía no se recomienda nada.
 */
const PREFERRED_SERIES = 3;

function emptyResult(violations: string[], notes: string[], status: StringStatus): StringCheck {
  return {
    minSeries: 0,
    maxSeries: 0,
    recommendedSeries: 0,
    maxParallelPerMppt: 0,
    maxDcWattsPerMppt: 0,
    vocColdV: 0,
    vmpHotV: 0,
    feasible: false,
    status,
    notes,
    violations,
  };
}

/**
 * Comprueba la compatibilidad eléctrica panel–MPPT en el peor caso térmico.
 * No recomienda una configuración que exceda los límites del equipo.
 *
 * Nunca interpreta `Infinity` como «sin límite»: un límite no declarado deja
 * la comprobación en `insufficient`, no en `verified`.
 */
export function checkStringDesign(
  panel: PanelSpec,
  inverter: InverterSpec,
  params: DesignParams,
): StringCheck {
  const notes: string[] = [];
  const violations: string[] = [];

  const mppt = inverter.mppt?.[0];
  if (!mppt) {
    violations.push('El inversor no declara entradas MPPT. No se puede verificar el array.');
    return emptyResult(violations, notes, 'insufficient');
  }

  // --- Datos de panel necesarios: sin ellos no hay nada que verificar ---
  const missingPanel: string[] = [];
  if (!isPositiveFinite(panel.vocV)) missingPanel.push('Voc');
  if (!isPositiveFinite(panel.vmppV)) missingPanel.push('Vmpp');
  if (!isPositiveFinite(panel.iscA)) missingPanel.push('Isc');
  if (!isPositiveFinite(panel.imppA)) missingPanel.push('Imp');
  if (!isPositiveFinite(panel.powerW)) missingPanel.push('potencia nominal');
  if (missingPanel.length > 0) {
    violations.push(
      `Datos del panel insuficientes (faltan: ${missingPanel.join(', ')}). No se puede verificar la configuración de strings.`,
    );
    notes.push('Introduce los datos de la ficha técnica del panel para verificar tensión, corriente y número de módulos.');
    return emptyResult(violations, notes, 'insufficient');
  }

  // --- Límites del MPPT/inversor: deben estar declarados y ser finitos ---
  const missingMppt: string[] = [];
  if (!isPositiveFinite(mppt.maxVoltageV)) missingMppt.push('tensión máxima del MPPT');
  if (!isPositiveFinite(mppt.minVoltageV)) missingMppt.push('tensión mínima del MPPT');
  if (!isPositiveFinite(mppt.maxCurrentA)) missingMppt.push('corriente máxima del MPPT');
  if (!isPositiveFinite(mppt.maxPowerW)) missingMppt.push('potencia máxima del MPPT');
  if (!isPositiveFinite(inverter.maxPvVoltageV)) missingMppt.push('tensión absoluta de entrada del inversor');
  if (missingMppt.length > 0) {
    violations.push(
      `Límites de entrada no declarados (faltan: ${missingMppt.join(', ')}). No se puede verificar la configuración de strings.`,
    );
    notes.push('Sin esos límites no es posible comprobar si la serie de paneles entra en la ventana de tensión.');
    return emptyResult(violations, notes, 'insufficient');
  }

  const vocColdV = panel.vocV * (1 + panel.tempCoeffVoc * (params.minAmbientC - 25));
  const cellHotC = params.ambientC + ((panel.noct - 20) / 800) * 1000;
  const vmpHotV = panel.vmppV * (1 + panel.tempCoeffPmpp * (cellHotC - 25));

  if (!Number.isFinite(vocColdV) || !Number.isFinite(vmpHotV) || vmpHotV <= 0) {
    violations.push('Los coeficientes térmicos del panel no producen una tensión válida.');
    return emptyResult(violations, notes, 'insufficient');
  }

  const maxSeries = Math.floor(
    Math.min(inverter.maxPvVoltageV, mppt.maxVoltageV) / Math.max(vocColdV, 1),
  );
  const minSeries = Math.ceil(mppt.minVoltageV / Math.max(vmpHotV, 1));

  // --- Ventana factible: si está vacía no se recomienda nada ---
  const windowFeasible = maxSeries >= 1 && minSeries <= maxSeries;
  const recommendedSeries = windowFeasible
    ? Math.min(Math.max(minSeries, PREFERRED_SERIES), maxSeries)
    : 0;

  const currentPerStringA = panel.iscA * 1.1;
  const maxParallelByCurrent = Math.floor(mppt.maxCurrentA / Math.max(currentPerStringA, 0.001));
  const maxParallelByPower =
    recommendedSeries > 0
      ? Math.floor(mppt.maxPowerW / Math.max(panel.powerW * recommendedSeries, 1))
      : 0;
  const maxParallelPerMppt = Math.max(0, Math.min(maxParallelByCurrent, maxParallelByPower));
  const maxDcWattsPerMppt = Math.min(mppt.maxPowerW, mppt.maxCurrentA * mppt.maxVoltageV);

  if (maxSeries <= 0) {
    violations.push(
      `Una sola placa supera la tensión máxima del MPPT en frío (${vocColdV.toFixed(1)} V).`,
    );
  } else if (minSeries > maxSeries) {
    violations.push(
      `No hay número de placas en serie que cumpla la ventana del MPPT (mín. ${minSeries}, máx. ${maxSeries}).`,
    );
  } else if (maxParallelPerMppt <= 0) {
    violations.push('La corriente o potencia del string supera el límite del MPPT.');
  }
  if (vocColdV > inverter.maxPvVoltageV) {
    violations.push('La tensión en circuito abierto en frío supera el límite absoluto del inversor.');
  }

  notes.push(`Voc estimada a ${params.minAmbientC} °C: ${vocColdV.toFixed(1)} V (hipótesis).`);
  notes.push(`Vmp estimada a ${cellHotC.toFixed(0)} °C de célula: ${vmpHotV.toFixed(1)} V.`);
  notes.push(
    windowFeasible
      ? `Ventana de serie: ${minSeries}–${maxSeries} placas por string; recomendada ${recommendedSeries}.`
      : `Ventana de serie vacía: se necesitarían ${minSeries} placas como mínimo y sólo caben ${maxSeries}.`,
  );

  const status: StringStatus = violations.length === 0 ? 'verified' : 'incompatible';
  return {
    minSeries,
    maxSeries,
    recommendedSeries,
    maxParallelPerMppt,
    maxDcWattsPerMppt,
    vocColdV,
    vmpHotV,
    feasible: violations.length === 0,
    status,
    notes,
    violations,
  };
}

/**
 * Potencia PV máxima que el inversor puede aceptar de forma verificada.
 * Devuelve 0 cuando la comprobación no es factible o es incompleta: no se
 * propone un array que no se ha podido verificar.
 */
export function usablePvLimitW(inverter: InverterSpec, panel: PanelSpec, params: DesignParams): number {
  const string = checkStringDesign(panel, inverter, params);
  if (!string.feasible || string.recommendedSeries <= 0 || string.maxParallelPerMppt <= 0) return 0;
  const mpptCapacity = inverter.mppt.reduce((sum, m) => {
    if (!Number.isFinite(m.maxPowerW) || !Number.isFinite(m.maxCurrentA) || !Number.isFinite(m.maxVoltageV)) {
      return sum;
    }
    return sum + Math.min(m.maxPowerW, m.maxCurrentA * m.maxVoltageV);
  }, 0);
  const byCount =
    string.maxParallelPerMppt *
    string.recommendedSeries *
    inverter.mppt.length *
    panel.powerW;
  return Math.max(0, Math.min(inverter.maxPvInputW, mpptCapacity, byCount));
}
