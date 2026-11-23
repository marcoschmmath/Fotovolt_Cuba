/**
 * Tipos compartidos del dominio energético.
 * Esta capa no contiene ninguna referencia a React ni a la interfaz.
 */

export type Priority = 'critical' | 'important' | 'discretionary';
export type Schedule = 'day' | 'night' | 'both' | 'custom';
export type LoadProfileKind = 'constant' | 'cyclic' | 'modulated';

export interface Appliance {
  id: string;
  name: string;
  category: string;
  icon: string;
  quantity: number;
  /** Potencia eléctrica activa en W (no térmica). */
  powerW: number;
  /** Horas de uso al día. */
  hoursPerDay: number;
  /** Franja horaria de uso. */
  schedule: Schedule;
  /** Hora de inicio cuando schedule === 'custom'. */
  startHour: number;
  priority: Priority;
  /** Factor de arranque: 1 = sin pico, 3-6 típico en motores y compresores. */
  surgeFactor: number;
  /** Fracción del tiempo activo en la que el equipo consume su potencia nominal. */
  dutyCycle: number;
  profile: LoadProfileKind;
  /** BTU/h conocidos (sólo climatización). Nunca se confunden con vatios. */
  btuPerHour?: number;
  /** true cuando powerW se estimó a partir de BTU/h y aún no se corrigió con la placa. */
  powerIsEstimate?: boolean;
  /** Eficiencia energética usada para estimar W a partir de BTU/h. */
  eer?: number;
  note?: string;
  custom?: boolean;
}

export interface SolarInputs {
  /** Horas solares pico (energía incidente diaria en kWh/m²). Hipótesis configurable. */
  hsp: number;
  sunrise: number;
  sunset: number;
  ambientC: number;
  noct: number;
  /** Coeficiente térmico de potencia, por °C (normalmente negativo). */
  tempCoeffPmpp: number;
  /** Factor de orientación/inclinación respecto al óptimo (0.8 - 1.0). */
  tiltFactor: number;
  /** Pérdidas por sombras y suciedad (0 - 0.3). */
  shading: number;
}

export interface MpptSpec {
  maxVoltageV: number;
  minVoltageV: number;
  maxCurrentA: number;
  maxPowerW: number;
}

export interface PanelSpec {
  id: string;
  brand: string;
  model: string;
  powerW: number;
  vmppV: number;
  imppA: number;
  vocV: number;
  iscA: number;
  tempCoeffVoc: number;
  tempCoeffPmpp: number;
  noct: number;
  /** Precio opcional. Undefined = no configurado, nunca se inventa. */
  price?: number;
  currency?: 'USD' | 'CUP';
  /** Enlace a la ficha o fuente del fabricante, cuando existe. */
  sourceUrl?: string;
  isReference?: boolean;
  note?: string;
}

export interface InverterSpec {
  id: string;
  brand: string;
  model: string;
  /** Potencia continua en W (AC). */
  ratedW: number;
  /** Potencia de arranque/sobrecarga admitida en W. */
  surgeW: number;
  /** Segundos que admite la sobrecarga. */
  surgeSeconds: number;
  efficiency: number;
  /** Potencia PV máxima admitida en entrada (W). */
  maxPvInputW: number;
  /** Máxima tensión absoluta de entrada PV (V). */
  maxPvVoltageV: number;
  mppt: MpptSpec[];
  /** Tensión nominal del banco de baterías (V). */
  batteryVoltageV: number;
  maxChargeA: number;
  maxDischargeA: number;
  acVoltages: Array<110 | 220>;
  price?: number;
  currency?: 'USD' | 'CUP';
  /** Enlace a la ficha o fuente del fabricante, cuando existe. */
  sourceUrl?: string;
  isReference?: boolean;
  note?: string;
}

export interface BatterySpec {
  id: string;
  brand: string;
  model: string;
  nominalKwh: number;
  nominalV: number;
  capacityAh: number;
  maxChargeW: number;
  maxDischargeW: number;
  dod: number;
  chargeEff: number;
  dischargeEff: number;
  chemistry: string;
  price?: number;
  currency?: 'USD' | 'CUP';
  /** Enlace a la ficha o fuente del fabricante, cuando existe. */
  sourceUrl?: string;
  isReference?: boolean;
  note?: string;
}

/**
 * Parámetros de diseño, todos configurables. Ningún valor se presenta como
 * dato universal exacto: la interfaz los muestra como hipótesis.
 */
export interface DesignParams {
  stepMinutes: number;
  nightStart: number;
  nightEnd: number;
  dayStart: number;
  dayEnd: number;
  hsp: number;
  systemEfficiency: number;
  inverterEfficiency: number;
  safetyFactor: number;
  autonomyDays: number;
  dod: number;
  batteryChargeEff: number;
  batteryDischargeEff: number;
  minSoc: number;
  /** Temperatura mínima estimada para calcular Voc en el peor caso. */
  minAmbientC: number;
  ambientC: number;
  noct: number;
  tempCoeffVoc: number;
  tempCoeffPmpp: number;
  tiltFactor: number;
  shading: number;
  /** EER orientativo para estimar vatios eléctricos a partir de BTU/h. */
  acEer: number;
  cyclicCycleMinutes: number;
  gridMaxPowerW: number;
  gridChargePowerW: number;
  allowExport: boolean;
}

export interface GridModel {
  /** Disponibilidad de red por intervalo; longitud = intervalos del día. */
  available: boolean[];
  maxPowerW: number;
  voltage: 110 | 220 | 'both';
  allowExport: boolean;
  chargerPowerW: number;
}

export interface EnergySystemConfig {
  panel: PanelSpec;
  panelCount: number;
  battery: BatterySpec;
  batteryCount: number;
  inverter: InverterSpec;
  appliances: Appliance[];
  grid: GridModel;
  solar: SolarInputs;
  params: DesignParams;
}

export interface IntervalResult {
  index: number;
  hour: number;
  pvDcW: number;
  pvAcW: number;
  pvClippedW: number;
  demandW: number;
  demandByPriorityW: Record<Priority, number>;
  servedW: number;
  unservedW: number;
  servedByPriority: Record<Priority, number>;
  unservedByPriority: Record<Priority, number>;
  gridW: number;
  batteryChargeW: number;
  batteryDischargeAcW: number;
  batteryDrawnDcW: number;
  exportedW: number;
  curtailedW: number;
  soc: number;
  inverterLossW: number;
  batteryLossW: number;
}

export interface SimulationTotals {
  demandKwh: number;
  servedKwh: number;
  unservedKwh: number;
  pvProducedKwh: number;
  pvUsedKwh: number;
  pvClippedKwh: number;
  gridKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  curtailedKwh: number;
  unservedByPriorityKwh: Record<Priority, number>;
  /** Cobertura de la demanda (energía servida / demanda). */
  coverage: number;
  /** Fracción solar: energía de origen PV (directa + almacenada) / demanda. */
  solarFraction: number;
  maxDemandW: number;
  finalSoc: number;
  minSoc: number;
  peakSurgeW: number;
}

export interface Diagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface SimulationResult {
  intervals: IntervalResult[];
  totals: SimulationTotals;
  diagnostics: Diagnostic[];
  /** Diferencia AC entre entradas y salidas por intervalo (debe ser ~0). */
  maxBalanceErrorKwh: number;
  valid: boolean;
}
