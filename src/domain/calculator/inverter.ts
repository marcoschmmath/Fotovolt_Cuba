import type {
  BatterySpec,
  DesignParams,
  Diagnostic,
  InverterSpec,
  PanelSpec,
} from '../core/types';
import { checkStringDesign } from './pv';

export interface InverterCheck {
  compatible: boolean;
  diagnostics: Diagnostic[];
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
  continuousW: number;
  peakW: number;
  voltage: 110 | 220 | 'both';
  params: DesignParams;
}): InverterCheck {
  const { inverter, battery, panel, panelCount, continuousW, peakW, voltage, params } = options;
  const diagnostics: Diagnostic[] = [];
  const requiredContinuous = continuousW * 1.1;

  if (voltage !== 'both' && !inverter.acVoltages.includes(voltage)) {
    add(
      diagnostics,
      'error',
      'VOLTAGE',
      `El inversor no declara salida de ${voltage} V.`,
    );
  }
  if (inverter.ratedW < requiredContinuous) {
    add(
      diagnostics,
      'error',
      'INV_RATED',
      `Potencia continua insuficiente: se requieren ${Math.round(requiredContinuous)} W y el inversor declara ${inverter.ratedW} W.`,
    );
  }
  if (inverter.surgeW < peakW) {
    add(
      diagnostics,
      'error',
      'INV_SURGE',
      `Arranque insuficiente: se estiman ${Math.round(peakW)} W de pico y el inversor admite ${inverter.surgeW} W.`,
    );
  } else {
    add(
      diagnostics,
      'info',
      'INV_SURGE_OK',
      `Margen de arranque: ${Math.round(inverter.surgeW - peakW)} W sobre el pico estimado.`,
    );
  }
  // Un banco LiFePO₄ de 51,2 V es equivalente a la clase de 48 V.
  const voltageDifference = Math.abs(battery.nominalV - inverter.batteryVoltageV);
  const voltageCompatible =
    voltageDifference <= 5 || Math.abs(battery.nominalV - inverter.batteryVoltageV) / Math.max(1, inverter.batteryVoltageV) <= 0.12;
  if (!voltageCompatible) {
    add(
      diagnostics,
      'error',
      'BATT_VOLTAGE',
      `Tensión de batería incompatible: banco de ${battery.nominalV} V frente a ${inverter.batteryVoltageV} V del inversor.`,
    );
  }
  const dischargeA = peakW / Math.max(1, battery.nominalV * battery.dischargeEff * params.inverterEfficiency);
  if (dischargeA > inverter.maxDischargeA) {
    add(
      diagnostics,
      'error',
      'INV_DISCHARGE_A',
      `Corriente de descarga estimada ${dischargeA.toFixed(0)} A supera el límite de ${inverter.maxDischargeA} A.`,
    );
  }
  if (dischargeA * battery.nominalV > battery.maxDischargeW) {
    add(
      diagnostics,
      'error',
      'BATT_DISCHARGE_W',
      `El pico exigido supera la potencia máxima de descarga de la batería (${battery.maxDischargeW} W).`,
    );
  }
  const pvDcW = panelCount * panel.powerW;
  if (pvDcW > inverter.maxPvInputW) {
    add(
      diagnostics,
      'error',
      'PV_INPUT',
      `Array de ${pvDcW} W por encima de la entrada PV máxima (${inverter.maxPvInputW} W).`,
    );
  }
  const string = checkStringDesign(panel, inverter, params);
  diagnostics.push(...string.violations.map((v) => ({ level: 'error' as const, code: 'MPPT', message: v })));
  if (string.feasible && string.violations.length === 0) {
    add(diagnostics, 'info', 'MPPT_OK', string.notes[2] ?? 'Configuración MPPT verificable.');
  }

  return {
    compatible: !diagnostics.some((d) => d.level === 'error'),
    diagnostics,
  };
}

/** Selecciona el inversor compatible más pequeño que cubre la demanda. */
export function selectInverter(options: {
  inverters: InverterSpec[];
  battery: BatterySpec;
  panel: PanelSpec;
  panelCount: number;
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
