import type {
  BatterySpec,
  DesignParams,
  Diagnostic,
  InverterSpec,
  PanelSpec,
} from '../core/types';
import { checkBalancedArrayConfiguration } from './pv';

export type TechnicalVerificationStatus = 'verified' | 'partial' | 'incompatible';

export interface InverterCheck {
  /** Puede simularse energéticamente si no hay incompatibilidades conocidas. */
  compatible: boolean;
  /** Distingue compatibilidad verificada de una simulación basada en datos parciales. */
  status: TechnicalVerificationStatus;
  diagnostics: Diagnostic[];
}

/**
 * Devuelve la capacidad equivalente de varias unidades idénticas conectadas
 * en paralelo. La tensión máxima PV y las ventanas de cada MPPT no se suman:
 * se replican los MPPT por unidad; las potencias y corrientes sí se agregan.
 * La cantidad se limita a lo declarado en la ficha del modelo.
 */
export function inverterWithParallelUnits(inverter: InverterSpec, requestedUnits = 1): InverterSpec {
  const maxUnits = Math.max(1, Math.floor(inverter.maxParallelUnits ?? 1));
  const units = Math.max(1, Math.min(maxUnits, Math.floor(requestedUnits)));
  if (units === 1) return inverter;
  return {
    ...inverter,
    ratedW: inverter.ratedW * units,
    surgeW: inverter.surgeW * units,
    maxPvInputW: inverter.maxPvInputW * units,
    maxChargeA: inverter.maxChargeA * units,
    maxDischargeA: inverter.maxDischargeA * units,
    ...(inverter.gridChargerW !== undefined ? { gridChargerW: inverter.gridChargerW * units } : {}),
    mppt: Array.from({ length: units }, () => inverter.mppt.map((item) => ({ ...item }))).flat(),
  };
}

function add(
  list: Diagnostic[],
  level: Diagnostic['level'],
  code: string,
  message: string,
): void {
  list.push({ level, code, message });
}

export function checkInverterCompatibility(options: {
  inverter: InverterSpec;
  battery: BatterySpec;
  panel: PanelSpec;
  panelCount: number;
  /** Número de baterías en paralelo; escala la potencia total admisible del BMS. */
  batteryCount?: number;
  continuousW: number;
  peakW: number;
  voltage: 110 | 220 | 'both';
  params: DesignParams;
}): InverterCheck {
  const { inverter, battery, panel, panelCount, continuousW, peakW, voltage, params } = options;
  const batteryCount = Math.max(1, Math.floor(options.batteryCount ?? 1));
  const diagnostics: Diagnostic[] = [];
  const requiredContinuous = continuousW * 1.1;

  if (inverter.acVoltages.length > 0 && voltage !== 'both' && !inverter.acVoltages.includes(voltage)) {
    add(diagnostics, 'error', 'VOLTAGE', `El inversor no declara salida de ${voltage} V.`);
  } else if (inverter.acVoltages.length === 0) {
    add(diagnostics, 'info', 'AC_VOLTAGE_UNKNOWN', 'El vendedor no indicó si la salida admite 110 V, 220 V o ambas. Compruébalo antes de instalar.');
  } else if (voltage === 'both' && !(inverter.acVoltages.includes(110) && inverter.acVoltages.includes(220))) {
    add(diagnostics, 'warning', 'AC_BOTH_UNVERIFIED', 'La vivienda utiliza 110 V y 220 V, pero el inversor no declara ambas tensiones de salida. La distribución de circuitos requiere confirmación profesional.');
  }

  if (inverter.ratedW < requiredContinuous) {
    add(
      diagnostics,
      'error',
      'INV_RATED',
      `Potencia continua insuficiente: se requieren ${Math.round(requiredContinuous)} W y el inversor declara ${inverter.ratedW} W.`,
    );
  }

  if (inverter.surgeW > 0) {
    if (inverter.surgeW < peakW) {
      add(diagnostics, 'error', 'INV_SURGE', `Arranque insuficiente: se estiman ${Math.round(peakW)} W de pico y el inversor admite ${inverter.surgeW} W.`);
    } else {
      add(diagnostics, 'info', 'INV_SURGE_OK', `Margen de arranque: ${Math.round(inverter.surgeW - peakW)} W sobre el pico estimado.`);
    }
  } else {
    add(diagnostics, 'info', 'INV_SURGE_UNKNOWN', 'No se conoce la potencia de sobrecarga. La simulación usa sólo la potencia continua y no acredita capacidad de arranque adicional.');
  }

  // Un banco LiFePO₄ de 51,2 V es equivalente a la clase de 48 V.
  if (battery.nominalV > 0 && inverter.batteryVoltageV > 0) {
    const voltageDifference = Math.abs(battery.nominalV - inverter.batteryVoltageV);
    const voltageCompatible =
      voltageDifference <= 5 || Math.abs(battery.nominalV - inverter.batteryVoltageV) / Math.max(1, inverter.batteryVoltageV) <= 0.12;
    if (!voltageCompatible) {
      add(diagnostics, 'error', 'BATT_VOLTAGE', `Tensión de batería incompatible: banco de ${battery.nominalV} V frente a ${inverter.batteryVoltageV} V del inversor.`);
    }
  } else {
    add(diagnostics, 'info', 'BATT_VOLTAGE_UNKNOWN', 'Falta la tensión nominal del banco o la tensión de batería admitida por el inversor. No se puede verificar esta conexión.');
  }

  const dischargeEfficiency = battery.dischargeEff > 0 ? battery.dischargeEff : params.batteryDischargeEff;
  const inverterEfficiency = inverter.efficiency > 0 ? inverter.efficiency : params.inverterEfficiency;
  const batteryDcRequiredW = peakW / Math.max(0.1, dischargeEfficiency * inverterEfficiency);
  const hasBankVoltage = battery.nominalV > 0;
  const dischargeA = hasBankVoltage ? batteryDcRequiredW / battery.nominalV : 0;
  if (hasBankVoltage && inverter.maxDischargeA > 0 && dischargeA > inverter.maxDischargeA) {
    add(diagnostics, 'error', 'INV_DISCHARGE_A', `Corriente de descarga estimada ${dischargeA.toFixed(0)} A supera el límite de ${inverter.maxDischargeA} A.`);
  } else if (!hasBankVoltage) {
    add(diagnostics, 'info', 'INV_DISCHARGE_UNVERIFIED', 'No se puede comprobar la corriente de descarga del inversor sin conocer la tensión del banco de baterías.');
  } else if (inverter.maxDischargeA <= 0) {
    add(diagnostics, 'info', 'INV_DISCHARGE_UNKNOWN', 'No se declara la corriente máxima de descarga del inversor; se estima a partir de la potencia y los límites de batería disponibles.');
  }
  if (inverter.maxChargeA <= 0) {
    add(diagnostics, 'info', 'INV_CHARGE_UNKNOWN', 'No se declara la corriente máxima de carga del inversor; la simulación aplica el límite energético estimado de la batería.');
  }
  if (!(inverter.gridChargerW && inverter.gridChargerW > 0)) {
    add(diagnostics, 'info', 'GRID_CHARGER_UNKNOWN', 'No se conoce la potencia del cargador AC. Para no sobreestimar la recarga, no se cuenta con carga de batería desde la red.');
  }
  const bankMaxDischargeW = battery.maxDischargeW > 0 ? battery.maxDischargeW * batteryCount : 0;
  if (bankMaxDischargeW > 0 && batteryDcRequiredW > bankMaxDischargeW) {
    add(diagnostics, 'error', 'BATT_DISCHARGE_W', `El pico exige aproximadamente ${Math.round(batteryDcRequiredW)} W desde el banco y supera la potencia máxima conjunta de descarga (${Math.round(bankMaxDischargeW)} W para ${batteryCount} batería(s)).`);
  } else if (battery.maxDischargeW <= 0) {
    add(diagnostics, 'info', 'BATT_DISCHARGE_UNKNOWN', 'No se conoce el límite de descarga del BMS. La simulación usa una hipótesis conservadora de 0,2 C.');
  }

  const pvDcW = panelCount * panel.powerW;
  if (inverter.maxPvInputW > 0 && pvDcW > inverter.maxPvInputW) {
    add(diagnostics, 'error', 'PV_INPUT', `Array de ${pvDcW} W por encima de la entrada PV máxima (${inverter.maxPvInputW} W).`);
  } else if (inverter.maxPvInputW <= 0) {
    add(diagnostics, 'info', 'PV_INPUT_UNKNOWN', 'No se declara la potencia fotovoltaica máxima admitida. No se puede comprobar el tamaño total del campo solar.');
  }

  const arrayCheck = checkBalancedArrayConfiguration(panel, inverter, panelCount, params);
  if (arrayCheck.status === 'insufficient') {
    add(
      diagnostics,
      'info',
      'PV_STRINGS_UNVERIFIED',
      arrayCheck.violations[0] ?? 'Faltan datos eléctricos para comprobar la conexión de los paneles. La simulación energética puede continuar.',
    );
  } else if (arrayCheck.status === 'incompatible') {
    diagnostics.push(...arrayCheck.violations.map((message) => ({ level: 'error' as const, code: 'MPPT', message })));
  } else {
    add(diagnostics, 'info', 'MPPT_OK', arrayCheck.notes[0]);
    if (arrayCheck.notes.some((note) => note.includes('hipótesis'))) {
      add(diagnostics, 'info', 'PV_THERMAL_ESTIMATE', arrayCheck.notes[arrayCheck.notes.length - 1]);
    }
  }

  if (inverter.efficiency <= 0) {
    add(diagnostics, 'info', 'INV_EFFICIENCY_ESTIMATED', `No se conoce la eficiencia del inversor. Se utiliza la hipótesis configurable del ${Math.round(params.inverterEfficiency * 100)} %.`);
  }
  if (battery.dod <= 0 || battery.chargeEff <= 0 || battery.dischargeEff <= 0 || battery.maxChargeW <= 0 || battery.maxDischargeW <= 0) {
    add(diagnostics, 'info', 'BATTERY_PARAMETERS_ESTIMATED', 'Faltan parámetros de batería (DoD, eficiencias o límite de carga). La simulación utiliza hipótesis internas explícitas.');
  }

  const incompatible = diagnostics.some((diagnostic) => diagnostic.level === 'error');
  const partialCodes = new Set([
    'AC_VOLTAGE_UNKNOWN', 'AC_BOTH_UNVERIFIED', 'BATT_VOLTAGE_UNKNOWN', 'INV_SURGE_UNKNOWN',
    'INV_DISCHARGE_UNKNOWN', 'INV_DISCHARGE_UNVERIFIED', 'INV_CHARGE_UNKNOWN', 'BATT_DISCHARGE_UNKNOWN',
    'PV_INPUT_UNKNOWN', 'PV_STRINGS_UNVERIFIED', 'PV_THERMAL_ESTIMATE',
    'INV_EFFICIENCY_ESTIMATED', 'BATTERY_PARAMETERS_ESTIMATED',
  ]);
  const partial = diagnostics.some((diagnostic) => partialCodes.has(diagnostic.code));
  return {
    compatible: !incompatible,
    status: incompatible ? 'incompatible' : partial ? 'partial' : 'verified',
    diagnostics,
  };
}

/** Selecciona el inversor compatible más pequeño que cubre la demanda. */
export function selectInverter(options: {
  inverters: InverterSpec[];
  battery: BatterySpec;
  panel: PanelSpec;
  panelCount: number;
  /** Número de baterías en paralelo; escala la potencia total admisible del BMS. */
  batteryCount?: number;
  continuousW: number;
  peakW: number;
  voltage: 110 | 220 | 'both';
  params: DesignParams;
}): { inverter: InverterSpec | null; rejected: Array<{ inverter: InverterSpec; check: InverterCheck }> } {
  const rejected: Array<{ inverter: InverterSpec; check: InverterCheck }> = [];
  const valid = options.inverters
    .map((inverter) => ({
      inverter,
      check: checkInverterCompatibility({ ...options, inverter }),
    }))
    .filter((entry) => {
      if (!entry.check.compatible) rejected.push(entry);
      return entry.check.compatible;
    })
    .sort((a, b) => a.inverter.ratedW - b.inverter.ratedW);
  return { inverter: valid[0]?.inverter ?? null, rejected };
}
