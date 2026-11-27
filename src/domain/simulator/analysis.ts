import type { Diagnostic, EnergySystemConfig, SimulationResult } from '../core/types';
import { batteryPack } from '../calculator/battery';
import { checkInverterCompatibility } from '../calculator/inverter';
import { gridHoursPerDay } from './grid';
import { peakDesignW, analyzeEnergy } from '../calculator/energy';
import { simulate } from './engine';

/**
 * Autonomía probada: sin sol, sin red, batería llena, carga crítica real.
 *
 * M13: el tiempo sigue pasando aunque un intervalo no tenga carga crítica
 * (la batería se gasta igual con las demás prioridades), así que se cuentan
 * TODOS los intervalos transcurridos hasta el primer fallo crítico. Si no
 * falla en los 2 días simulados el valor está truncado por abajo.
 */
export function testedAutonomyHours(config: EnergySystemConfig): number {
  const isolated: EnergySystemConfig = {
    ...config,
    solar: { ...config.solar, hsp: 0 },
    grid: { ...config.grid, available: config.grid.available.map(() => false) },
  };
  const result = simulate(isolated, { days: 2, startSoc: 1 });
  if (!result.intervals.some((i) => i.demandByPriorityW.critical > 0)) return 0;
  const stepH = config.params.stepMinutes / 60;
  let hours = 0;
  for (const interval of result.intervals) {
    if (interval.unservedByPriorityKwh.critical > 0) break;
    hours += stepH;
  }
  return hours;
}

/**
 * Horas de carga reales (intervalos en el que el SOC sube) para pasar del
 * SOC mínimo al completo. null = no se alcanza en los 3 días simulados.
 *
 * M13: antes devolvía `(índice global + 1) · paso`, contando también la
 * noche en la que no se carga nada y mezclando días distintos.
 */
export function estimateRechargeHours(
  config: EnergySystemConfig,
  mode: 'solar-grid' | 'solar-only' = 'solar-grid',
): number | null {
  const pack = batteryPack(config.battery, config.batteryCount, config.params);
  const scenario: EnergySystemConfig =
    mode === 'solar-only'
      ? { ...config, grid: { ...config.grid, available: config.grid.available.map(() => false) } }
      : config;
  const result = simulate(scenario, { days: 3, startSoc: pack.minSoc });
  const stepH = config.params.stepMinutes / 60;
  const fullIndex = result.intervals.findIndex((i) => i.soc >= 0.995);
  if (fullIndex < 0) return null;
  let chargingHours = 0;
  let previousSoc = pack.minSoc;
  for (let i = 0; i <= fullIndex; i += 1) {
    const soc = result.intervals[i].soc;
    if (soc > previousSoc + 1e-9) chargingHours += stepH;
    previousSoc = soc;
  }
  return chargingHours;
}

export function analyzeBottlenecks(
  config: EnergySystemConfig,
  result: SimulationResult,
): Diagnostic[] {
  const list: Diagnostic[] = [];
  const pack = batteryPack(config.battery, config.batteryCount, config.params);
  const gridHours = gridHoursPerDay(config.grid, config.params);
  const energy = analyzeEnergy(config.appliances, config.params);
  const peak = peakDesignW(energy);
  const compatibility = checkInverterCompatibility({
    inverter: config.inverter,
    battery: config.battery,
    panel: config.panel,
    panelCount: config.panelCount,
    batteryCount: config.batteryCount,
    continuousW: energy.peakSimultaneousW,
    peakW: peak,
    voltage: config.grid.voltage,
    params: config.params,
  });
  list.push(...compatibility.diagnostics.filter((d) => d.level !== 'info'));

  if (result.totals.unservedByPriorityKwh.critical > 0.01) {
    if (result.totals.minSoc <= pack.minSoc + 0.02) {
      list.push({
        level: 'warning',
        code: 'BOTTLE_BATTERY',
        message: 'Cuello de botella: la batería se agota antes de terminar el apagón. Aumenta la capacidad almacenada.',
      });
    } else if (result.totals.pvClippedKwh > 0.05 || result.totals.curtailedKwh > 0.05) {
      list.push({
        level: 'warning',
        code: 'BOTTLE_STORAGE_TIMING',
        message: 'Cuello de botella: hay energía disponible por horas pero no se puede almacenar o entregar cuando se necesita.',
      });
    } else {
      list.push({
        level: 'warning',
        code: 'BOTTLE_PV',
        message: 'Cuello de botella: la producción fotovoltaica no basta para cubrir la demanda en el escenario simulado.',
      });
    }
  }
  if (result.totals.curtailedKwh > 0.2 && result.totals.minSoc > 0.95) {
    list.push({
      level: 'info',
      code: 'BOTTLE_RECHARGE_WINDOW',
      message: 'Sobran paneles respecto a la batería: el excedente se pierde. Más almacenamiento aprovecharía mejor la inversión.',
    });
  }
  if (result.totals.pvClippedKwh > 0.05) {
    list.push({
      level: 'warning',
      code: 'BOTTLE_INVERTER',
      message: 'El inversor recorta producción PV. Revisa la potencia de entrada y los MPPT antes de añadir paneles.',
    });
  }
  if (gridHours < 4 && result.totals.gridKwh > 0 && result.totals.unservedKwh > 0.1) {
    list.push({
      level: 'info',
      code: 'BOTTLE_GRID_TIME',
      message: `La red sólo estuvo disponible ${gridHours.toFixed(1)} h. Ese tiempo limita la recarga: comprobar la potencia real de carga del inversor.`,
    });
  }
  if (config.inverter.surgeW > 0 && peak > config.inverter.surgeW * 0.85) {
    list.push({
      level: 'warning',
      code: 'SURGE_MARGIN',
      message: 'El margen de arranque de motores es pequeño. Conviene confirmar la corriente de arranque real en la ficha técnica.',
    });
  }
  if (config.grid.voltage === 'both') {
    list.push({
      level: 'info',
      code: 'STUDY_VOLTAGE',
      message: 'La vivienda tiene 110 V y 220 V: hace falta un estudio para distribuir circuitos y confirmar la configuración del inversor.',
    });
  }
  if (config.panel.isReference || config.battery.isReference || config.inverter.isReference) {
    list.push({
      level: 'warning',
      code: 'REFERENCE_DATA',
      message: 'Se usaron plantillas genéricas de equipo. Sustitúyelas por fichas técnicas reales antes de tomar una decisión de compra.',
    });
  }
  list.push({
    level: 'info',
    code: 'STUDY_REQUIRED',
    message: 'Esta simulación es una estimación preliminar. No sustituye un diseño eléctrico ni una visita técnica presencial.',
  });
  return list;
}
