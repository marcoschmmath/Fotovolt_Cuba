/**
 * Contrato visual entre el motor de simulación y el diagrama.
 *
 * Los campos representan mediciones publicadas por el motor; no se mezclan
 * potencias AC, potencias del lado DC ni energía ya almacenada en batería.
 * La interfaz no reconstruye balances a partir de magnitudes de fronteras
 * eléctricas distintas.
 */
export interface EnergyFlowFrame {
  /** Hora simulada del intervalo, formato "HH:MM". */
  time: string;
  /** Array fotovoltaico, lado DC, antes de clipping del inversor. */
  pvProductionDcW: number;
  /** Potencia PV que el motor convierte y entrega a las cargas, lado AC. */
  pvToLoadAcW: number;
  /** Potencia efectivamente almacenada desde PV, lado batería. */
  pvToBatteryStoredW: number;
  /** Importación de red usada directamente por las cargas, lado AC. */
  gridToLoadAcW: number;
  /** Entrada AC al cargador de batería desde la red. */
  gridToBatteryAcW: number;
  /** Potencia entregada por batería a cargas, lado AC. */
  batteryToLoadAcW: number;
  /** Demanda eléctrica del intervalo, lado AC. */
  loadDemandAcW: number;
  /** Demanda efectivamente servida, lado AC. */
  loadServedAcW: number;
  /** Demanda que quedó sin suministrar, lado AC. */
  loadUnservedAcW: number;
  /** Potencia almacenada en batería durante el intervalo, lado batería. */
  batteryChargeStoredW: number;
  /** Estado de carga de la batería al final del intervalo, 0–100. */
  batterySoc: number;
  /** true si había red en este intervalo. */
  gridAvailable: boolean;
  /** Cargas solicitando energía en este intervalo, con potencia media estimada. */
  activeLoads?: Array<{
    id: string;
    name: string;
    powerW: number;
    kind: 'appliance' | 'cooking';
  }>;
  /** Energía PV DC no aprovechada por falta de consumo o almacenamiento. */
  pvCurtailedDcW?: number;
  /** PV DC recortada por el límite de entrada del inversor. */
  pvClippedDcW?: number;
}

/** Duración de un intervalo de simulación, en horas (15 min). */
export const INTERVAL_HOURS = 0.25;

/**
 * Convierte energía de un intervalo (kWh) a potencia media (W).
 * P(W) = E(kWh) * 1000 / 0.25. Aplicar UNA sola vez: si el motor ya entrega W, no usar.
 */
export function intervalEnergyKwhToW(kwh: number, intervalHours: number = INTERVAL_HOURS): number {
  return (kwh * 1000) / intervalHours;
}

export interface FrameTotals {
  pvProductionDcW: number;
  pvToLoadAcW: number;
  pvToBatteryStoredW: number;
  pvCurtailedDcW: number;
  pvClippedDcW: number;
  gridToLoadAcW: number;
  gridToBatteryAcW: number;
  gridImportAcW: number;
  loadDemandAcW: number;
  loadServedAcW: number;
  loadUnservedAcW: number;
  batteryChargeStoredW: number;
  batteryToLoadAcW: number;
  socPct: number;
}

/** Valores no finitos o negativos se dibujan como 0 (la UI no debe romperse por un NaN). */
const safe = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;

/** Normaliza campos medidos; no suma fuentes ni resta fronteras diferentes. */
export function frameTotals(f: EnergyFlowFrame): FrameTotals {
  const soc = Number.isFinite(f.batterySoc) ? f.batterySoc : 0;
  return {
    pvProductionDcW: safe(f.pvProductionDcW),
    pvToLoadAcW: safe(f.pvToLoadAcW),
    pvToBatteryStoredW: safe(f.pvToBatteryStoredW),
    pvCurtailedDcW: safe(f.pvCurtailedDcW),
    pvClippedDcW: safe(f.pvClippedDcW),
    gridToLoadAcW: safe(f.gridToLoadAcW),
    gridToBatteryAcW: safe(f.gridToBatteryAcW),
    // Ambos componentes son potencias de entrada AC de la red.
    gridImportAcW: safe(f.gridToLoadAcW) + safe(f.gridToBatteryAcW),
    loadDemandAcW: safe(f.loadDemandAcW),
    loadServedAcW: safe(f.loadServedAcW),
    loadUnservedAcW: safe(f.loadUnservedAcW),
    batteryChargeStoredW: safe(f.batteryChargeStoredW),
    batteryToLoadAcW: safe(f.batteryToLoadAcW),
    socPct: Math.min(100, Math.max(0, soc)),
  };
}

const numberFormat = new Intl.NumberFormat('es', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 850 → "850 W"; 1200 → "1,2 kW". */
export function formatPower(w: number): string {
  const v = Number.isFinite(w) && Math.abs(w) >= 0.5 ? w : 0;
  if (Math.abs(v) >= 1000) return `${numberFormat.format(v / 1000)} kW`;
  return `${Math.round(v)} W`;
}

/** Resumen en texto del frame, para lectores de pantalla. */
export function describeFrame(f: EnergyFlowFrame): string {
  const t = frameTotals(f);
  const grid = f.gridAvailable ? `la red importa ${formatPower(t.gridImportAcW)}` : 'no hay red eléctrica';
  let battery = `la batería está al ${Math.round(t.socPct)} %`;
  if (t.batteryChargeStoredW >= 1) battery += ` y almacena ${formatPower(t.batteryChargeStoredW)}`;
  else if (t.batteryToLoadAcW >= 1) battery += ` y entrega ${formatPower(t.batteryToLoadAcW)} a las cargas`;
  const unserved = t.loadUnservedAcW >= 1 ? `; quedan ${formatPower(t.loadUnservedAcW)} sin suministrar` : '';
  const curtailed = t.pvCurtailedDcW >= 1 ? `; se desaprovechan ${formatPower(t.pvCurtailedDcW)} de PV en DC` : '';
  const clipped = t.pvClippedDcW >= 1 ? `; el inversor recorta ${formatPower(t.pvClippedDcW)} de entrada PV en DC` : '';

  return (
    `A las ${f.time}: el array produce ${formatPower(t.pvProductionDcW)} en DC; ` +
    `la demanda es ${formatPower(t.loadDemandAcW)} y se sirven ${formatPower(t.loadServedAcW)} en AC; ` +
    `${grid}; ${battery}${unserved}${curtailed}${clipped}.`
  );
}
