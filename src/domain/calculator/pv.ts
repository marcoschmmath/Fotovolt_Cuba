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

export interface StringCheck {
  minSeries: number;
  maxSeries: number;
  recommendedSeries: number;
  maxParallelPerMppt: number;
  maxDcWattsPerMppt: number;
  vocColdV: number;
  vmpHotV: number;
  feasible: boolean;
  notes: string[];
  violations: string[];
}

/**
 * Comprueba la compatibilidad eléctrica panel–MPPT en el peor caso térmico.
 * No recomienda una configuración que exceda los límites del equipo.
 */
export function checkStringDesign(
  panel: PanelSpec,
  inverter: InverterSpec,
  params: DesignParams,
): StringCheck {
  const notes: string[] = [];
  const violations: string[] = [];
  const mppt = inverter.mppt[0];
  if (!mppt) {
    return {
      minSeries: 0,
      maxSeries: 0,
      recommendedSeries: 0,
      maxParallelPerMppt: 0,
      maxDcWattsPerMppt: 0,
      vocColdV: 0,
      vmpHotV: 0,
      feasible: false,
      notes,
      violations: ['El inversor no declara entradas MPPT. No se puede verificar el array.'],
    };
  }

  const vocColdV = panel.vocV * (1 + panel.tempCoeffVoc * (params.minAmbientC - 25));
  const cellHotC = params.ambientC + ((panel.noct - 20) / 800) * 1000;
  const vmpHotV = panel.vmppV * (1 + panel.tempCoeffPmpp * (cellHotC - 25));

  const maxSeries = Math.floor(
    Math.min(inverter.maxPvVoltageV, mppt.maxVoltageV) / Math.max(vocColdV, 1),
  );
  const minSeries = Math.ceil(mppt.minVoltageV / Math.max(vmpHotV, 1));
  const recommendedSeries = maxSeries > 0 ? Math.max(minSeries, Math.min(maxSeries, 3)) : 0;

  const currentPerStringA = panel.iscA * 1.1;
  const maxParallelByCurrent = Math.floor(mppt.maxCurrentA / Math.max(currentPerStringA, 0.001));
  const maxParallelByPower = Math.floor(mppt.maxPowerW / Math.max(panel.powerW * recommendedSeries, 1));
  const maxParallelPerMppt = Math.max(0, Math.min(maxParallelByCurrent, maxParallelByPower));
  const maxDcWattsPerMppt = Math.min(mppt.maxPowerW, mppt.maxCurrentA * mppt.maxVoltageV);

  if (maxSeries <= 0) {
    violations.push(
      `Una sola placa supera la tensión máxima del MPPT en frío (${vocColdV.toFixed(1)} V).`,
    );
  }
  if (minSeries > maxSeries && maxSeries > 0) {
    violations.push(
      `No hay número de placas en serie que cumpla la ventana del MPPT (mín. ${minSeries}, máx. ${maxSeries}).`,
    );
  }
  if (maxParallelPerMppt <= 0) {
    violations.push('La corriente o potencia del string supera el límite del MPPT.');
  }
  if (vocColdV > inverter.maxPvVoltageV) {
    violations.push('La tensión en circuito abierto en frío supera el límite absoluto del inversor.');
  }
  notes.push(`Voc estimada a ${params.minAmbientC} °C: ${vocColdV.toFixed(1)} V (hipótesis).`);
  notes.push(`Vmp estimada a ${cellHotC.toFixed(0)} °C de célula: ${vmpHotV.toFixed(1)} V.`);
  notes.push(
    `Ventana de serie: ${minSeries}–${maxSeries} placas por string; recomendada ${recommendedSeries}.`,
  );

  return {
    minSeries,
    maxSeries,
    recommendedSeries,
    maxParallelPerMppt,
    maxDcWattsPerMppt,
    vocColdV,
    vmpHotV,
    feasible: violations.length === 0,
    notes,
    violations,
  };
}

/** Potencia PV máxima que el inversor puede aceptar de forma verificada. */
export function usablePvLimitW(inverter: InverterSpec, panel: PanelSpec, params: DesignParams): number {
  const string = checkStringDesign(panel, inverter, params);
  const mpptCapacity = inverter.mppt.reduce(
    (sum, m) => sum + Math.min(m.maxPowerW, m.maxCurrentA * m.maxVoltageV),
    0,
  );
  const byCount = string.maxParallelPerMppt * string.recommendedSeries * Math.max(0, inverter.mppt.length) * panel.powerW;
  return Math.max(0, Math.min(inverter.maxPvInputW, mpptCapacity, byCount));
}

export function pvEnergyPotentialKwh(solar: SolarInputs): number {
  return solar.hsp;
}
