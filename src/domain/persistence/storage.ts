import type {
  Appliance,
  BatterySpec,
  DesignParams,
  InverterSpec,
  PanelSpec,
} from '../core/types';
import type { GridInput } from '../simulator/grid';
import {
  DEFAULT_CUBA_RESIDENTIAL_GRID_LIMIT_W,
  DEFAULT_PARAMS,
  REFERENCE_BATTERIES,
  REFERENCE_INVERTERS,
  REFERENCE_PANELS,
} from '../core/defaults';
import { VERIFIED_BATTERIES, VERIFIED_INVERTERS, VERIFIED_PANELS } from '../catalog/verifiedEquipment';
import type { HouseholdProfile } from '../household/types';
import { DEFAULT_COOKING, defaultCookingActivities } from '../household/types';
import type { SystemConfiguration } from '../system/types';
import { systemParams } from '../system/types';

/**
 * Resultado guardado: una FOTO INMUTABLE del hogar y de la instalación en el
 * momento de simular. Editar el hogar o la instalación nunca reescribe estos
 * números: la historia no cambia en silencio.
 */
export interface SimulationSnapshot {
  id: string;
  createdAt: string;
  householdProfileId: string;
  systemConfigurationId: string;
  householdName: string;
  systemName: string;
  /** Energía diaria del hogar en el momento de simular (kWh). */
  householdKwhPerDay: number;
  assumptions: {
    hsp: number;
    dod: number;
    minSoc: number;
    inverterEfficiency: number;
    chargerEfficiency: number;
    gridImportLimitW: number;
  };
  metrics: {
    coverageMedian: number;
    coverageWorst: number;
    coverageBest: number;
    unservedKwhWorst: number;
    gridKwhMedian: number;
    pvKwhMedian: number;
    blackoutCoverage: number;
    blackoutUnservedKwh: number;
    cookingMealsUnmetWorst: number;
    nightDeficitKwhWorst: number;
    minSocWorst: number;
  };
}

export interface AppState {
  /** Versión del esquema persistido (SCHEMA_VERSION al guardar). */
  version: number;
  /** Hogares guardados: consumo y hábitos, sin nada de instalación. */
  households: HouseholdProfile[];
  /** Instalaciones propuestas, cada una ligada a un hogar. */
  installations: SystemConfiguration[];
  /** Resultados guardados (fotos, no cálculos en vivo). */
  simulations: SimulationSnapshot[];
  activeHouseholdId: string;
  activeInstallationId: string | null;
  panels: PanelSpec[];
  batteries: BatterySpec[];
  inverters: InverterSpec[];
}

const KEY = 'calculadora-solar-cuba:v4';
/** Versión del esquema. Subir aquí obliga a una migración explícita. */
const SCHEMA_VERSION = 4;

/** Únicos pasos de simulación admitidos (M1). */
export const SUPPORTED_STEPS = [5, 10, 15, 30, 60] as const;
export function isSupportedStep(value: unknown): value is (typeof SUPPORTED_STEPS)[number] {
  return typeof value === 'number' && (SUPPORTED_STEPS as readonly number[]).includes(value);
}

function numIn(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Valida un registro guardado campo a campo. Nunca propaga basura. */
function sanitizeCatalogItem<
  T extends { id: string; brand: string; model: string; note?: string; isReference?: boolean },
>(value: unknown, defaults: T): T {
  const source = isRecord(value) ? value : {};
  return {
    ...defaults,
    // Sólo se acepta el objeto guardado si trae un id textual utilizable.
    ...(typeof source.id === 'string' && source.id ? { id: source.id } : {}),
    brand: strOr(source.brand, defaults.brand),
    model: strOr(source.model, defaults.model),
    note: typeof source.note === 'string' ? source.note : defaults.note,
    sourceUrl: typeof source.sourceUrl === 'string' ? source.sourceUrl : undefined,
    isReference: boolOr(source.isReference, Boolean(defaults.isReference)),
    ...(typeof source.price === 'number' && Number.isFinite(source.price)
      ? { price: Math.max(0, source.price) }
      : { price: undefined }),
    currency: source.currency === 'CUP' ? 'CUP' : 'USD',
  } as T;
}

function sanitizePanel(value: unknown): PanelSpec {
  const d = sanitizeCatalogItem<PanelSpec>(value, { ...REFERENCE_PANELS[0] });
  const s = isRecord(value) ? value : {};
  return {
    ...d,
    powerW: Math.max(1, numIn(s.powerW, d.powerW, 1, 5000)),
    vmppV: Math.max(0, numIn(s.vmppV, d.vmppV, 0, 500)),
    imppA: Math.max(0, numIn(s.imppA, d.imppA, 0, 100)),
    vocV: Math.max(0, numIn(s.vocV, d.vocV, 0, 500)),
    iscA: Math.max(0, numIn(s.iscA, d.iscA, 0, 100)),
    tempCoeffVoc: numIn(s.tempCoeffVoc, d.tempCoeffVoc, -0.01, 0),
    tempCoeffPmpp: numIn(s.tempCoeffPmpp, d.tempCoeffPmpp, -0.01, 0),
    noct: Math.max(0, numIn(s.noct, d.noct, 20, 80)),
  };
}

function sanitizeBattery(value: unknown): BatterySpec {
  const d = sanitizeCatalogItem<BatterySpec>(value, { ...REFERENCE_BATTERIES[0] });
  const s = isRecord(value) ? value : {};
  return {
    ...d,
    chemistry: strOr(s.chemistry, d.chemistry),
    nominalKwh: Math.max(0.1, numIn(s.nominalKwh, d.nominalKwh, 0.1, 500)),
    nominalV: Math.max(1, numIn(s.nominalV, d.nominalV, 1, 1000)),
    capacityAh: Math.max(0, numIn(s.capacityAh, d.capacityAh, 0, 10000)),
    maxChargeW: Math.max(0, numIn(s.maxChargeW, d.maxChargeW, 0, 100000)),
    maxDischargeW: Math.max(0, numIn(s.maxDischargeW, d.maxDischargeW, 0, 100000)),
    dod: numIn(s.dod, d.dod, 0.05, 1),
    chargeEff: numIn(s.chargeEff, d.chargeEff, 0.5, 1),
    dischargeEff: numIn(s.dischargeEff, d.dischargeEff, 0.5, 1),
  };
}

function sanitizeInverter(value: unknown): InverterSpec {
  const d = sanitizeCatalogItem<InverterSpec>(value, { ...REFERENCE_INVERTERS[0], mppt: REFERENCE_INVERTERS[0].mppt.map((m) => ({ ...m })), acVoltages: [...REFERENCE_INVERTERS[0].acVoltages] });
  const s = isRecord(value) ? value : {};
  // C7: se conservan TODOS los MPPT y TODAS las tensiones declaradas.
  const rawMppt = Array.isArray(s.mppt) ? s.mppt : [];
  const mppt = rawMppt
    .filter(isRecord)
    .map((m) => ({
      maxVoltageV: Math.max(0, numIn(m.maxVoltageV, d.mppt[0].maxVoltageV, 0, 2000)),
      minVoltageV: Math.max(0, numIn(m.minVoltageV, d.mppt[0].minVoltageV, 0, 2000)),
      maxCurrentA: Math.max(0, numIn(m.maxCurrentA, d.mppt[0].maxCurrentA, 0, 200)),
      maxPowerW: Math.max(0, numIn(m.maxPowerW, d.mppt[0].maxPowerW, 0, 100000)),
    }))
    .filter((m) => m.maxVoltageV > 0 && m.minVoltageV > 0);
  const rawVoltages = Array.isArray(s.acVoltages) ? s.acVoltages : [];
  const acVoltages = [...new Set(rawVoltages.filter((v) => v === 110 || v === 220))] as Array<110 | 220>;
  return {
    ...d,
    ratedW: Math.max(1, numIn(s.ratedW, d.ratedW, 1, 100000)),
    surgeW: Math.max(1, numIn(s.surgeW, d.surgeW, 1, 100000)),
    surgeSeconds: Math.max(0, numIn(s.surgeSeconds, d.surgeSeconds, 0, 600)),
    efficiency: numIn(s.efficiency, d.efficiency, 0.5, 1),
    maxPvInputW: Math.max(0, numIn(s.maxPvInputW, d.maxPvInputW, 0, 100000)),
    maxPvVoltageV: Math.max(0, numIn(s.maxPvVoltageV, d.maxPvVoltageV, 0, 2000)),
    // Potencia del cargador AC→DC declarada por el fabricante. 0 = el inversor
    // NO carga desde red: nunca se inventa la capacidad.
    ...(typeof s.gridChargerW === 'number' && Number.isFinite(s.gridChargerW)
      ? { gridChargerW: Math.max(0, s.gridChargerW) }
      : {}),
    batteryVoltageV: Math.max(1, numIn(s.batteryVoltageV, d.batteryVoltageV, 1, 1000)),
    maxChargeA: Math.max(0, numIn(s.maxChargeA, d.maxChargeA, 0, 500)),
    maxDischargeA: Math.max(0, numIn(s.maxDischargeA, d.maxDischargeA, 0, 500)),
    mppt: mppt.length ? mppt : d.mppt.map((m) => ({ ...m })),
    acVoltages: acVoltages.length ? acVoltages : [...d.acVoltages],
  };
}

function sanitizeAppliance(value: unknown): Appliance | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  const quantity = Math.max(0, Math.round(numIn(value.quantity, 0, 0, 100)));
  if (quantity === 0) return null;
  const powerW = Math.max(0, numIn(value.powerW, 0, 0, 20000));
  if (powerW === 0) return null;
  const schedule = ['day', 'night', 'both', 'custom'].includes(String(value.schedule))
    ? (value.schedule as Appliance['schedule'])
    : 'day';
  const priority = ['critical', 'important', 'discretionary'].includes(String(value.priority))
    ? (value.priority as Appliance['priority'])
    : 'important';
  const profile = ['constant', 'cyclic', 'modulated'].includes(String(value.profile))
    ? (value.profile as Appliance['profile'])
    : 'constant';
  return {
    id: value.id,
    name: strOr(value.name, 'Equipo'),
    category: strOr(value.category, 'Otros'),
    icon: strOr(value.icon, 'plug'),
    quantity,
    powerW,
    hoursPerDay: numIn(value.hoursPerDay, 0, 0, 24),
    schedule,
    startHour: numIn(value.startHour, 8, 0, 23),
    priority,
    surgeFactor: numIn(value.surgeFactor, 1, 1, 20),
    dutyCycle: numIn(value.dutyCycle, 1, 0, 1),
    profile,
    ...(typeof value.btuPerHour === 'number' && value.btuPerHour > 0 ? { btuPerHour: value.btuPerHour } : {}),
    ...(typeof value.eer === 'number' && value.eer > 0 ? { eer: value.eer } : {}),
    powerIsEstimate: value.powerIsEstimate === true,
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
    custom: value.custom === true,
  };
}

/** Migraciones explícitas por versión de esquema. */
function migrate(state: Record<string, unknown>): Record<string, unknown> {
  let version = typeof state.version === 'number' ? state.version : 1;
  // v1 → v2: los parámetros pasan a validarse por rango y `stepMinutes` a
  // restringirse a los pasos admitidos. Los datos de equipo no cambian.
  if (version < 2) {
    version = 2;
  }
  return { ...state, version };
}

/** Parámetros saneados: nunca un paso no soportado (M1). */
function sanitizeParams(value: unknown): DesignParams {
  const raw = isRecord(value) ? value : {};
  const d = DEFAULT_PARAMS;
  const step = isSupportedStep(raw.stepMinutes) ? raw.stepMinutes : d.stepMinutes;
  return {
    stepMinutes: step,
    nightStart: numIn(raw.nightStart, d.nightStart, 0, 23),
    nightEnd: numIn(raw.nightEnd, d.nightEnd, 0, 23),
    dayStart: numIn(raw.dayStart, d.dayStart, 0, 23),
    dayEnd: numIn(raw.dayEnd, d.dayEnd, 0, 23),
    hsp: numIn(raw.hsp, d.hsp, 0.5, 10),
    systemEfficiency: numIn(raw.systemEfficiency, d.systemEfficiency, 0.4, 1),
    inverterEfficiency: numIn(raw.inverterEfficiency, d.inverterEfficiency, 0.4, 1),
    safetyFactor: numIn(raw.safetyFactor, d.safetyFactor, 1, 3),
    autonomyDays: numIn(raw.autonomyDays, d.autonomyDays, 0, 30),
    dod: numIn(raw.dod, d.dod, 0.05, 1),
    batteryChargeEff: numIn(raw.batteryChargeEff, d.batteryChargeEff, 0.5, 1),
    batteryDischargeEff: numIn(raw.batteryDischargeEff, d.batteryDischargeEff, 0.5, 1),
    chargerEfficiency: numIn(raw.chargerEfficiency, d.chargerEfficiency, 0.5, 1),
    minSoc: numIn(raw.minSoc, d.minSoc, 0, 0.5),
    minAmbientC: numIn(raw.minAmbientC, d.minAmbientC, -20, 45),
    ambientC: numIn(raw.ambientC, d.ambientC, -20, 60),
    noct: numIn(raw.noct, d.noct, 20, 80),
    tempCoeffVoc: numIn(raw.tempCoeffVoc, d.tempCoeffVoc, -0.01, 0),
    tempCoeffPmpp: numIn(raw.tempCoeffPmpp, d.tempCoeffPmpp, -0.01, 0),
    tiltFactor: numIn(raw.tiltFactor, d.tiltFactor, 0.4, 1),
    shading: numIn(raw.shading, d.shading, 0, 0.5),
    acEer: numIn(raw.acEer, d.acEer, 5, 25),
    cyclicCycleMinutes: numIn(raw.cyclicCycleMinutes, d.cyclicCycleMinutes, 5, 240),
    gridMaxPowerW: Math.max(0, numIn(raw.gridMaxPowerW, d.gridMaxPowerW, 0, 100000)),
  };
}

function sanitizeGridInput(value: unknown): GridInput {
  const raw = isRecord(value) ? value : {};
  const d = DEFAULT_GRID_INPUT;
  const pattern = ['morning', 'evening', 'split', 'custom'].includes(String(raw.pattern))
    ? (raw.pattern as GridInput['pattern'])
    : d.pattern;
  const voltage = raw.voltage === 110 || raw.voltage === 220 || raw.voltage === 'both'
    ? raw.voltage
    : d.voltage;
  return {
    hoursPerDay: numIn(raw.hoursPerDay, d.hoursPerDay, 0, 24),
    pattern,
    startHour: numIn(raw.startHour, d.startHour, 0, 23),
    maxPowerW: Math.max(0, numIn(raw.maxPowerW, d.maxPowerW, 0, 100000)),
    voltage,
  };
}

/** Hogar saneado: electrodomésticos válidos, cocción y preferencias coherentes. */
function sanitizeHousehold(value: unknown, index = 0): HouseholdProfile | null {
  if (!isRecord(value)) return null;
  // Sin identificador no es un hogar recuperable: se descarta en lugar de
  // inventar uno que nadie pidió.
  if (typeof value.id !== 'string' || !value.id) return null;
  const rawAppliances = Array.isArray(value.appliances) ? (value.appliances as unknown[]) : [];
  const appliances = rawAppliances.map(sanitizeAppliance).filter((a): a is Appliance => a !== null);
  const cooking = isRecord(value.cooking) ? value.cooking : {};
  const fuelKind = cooking.fuelKind;
  const substitution = cooking.substitution;
  const activitiesRaw = Array.isArray(value.activities) ? (value.activities as unknown[]) : [];
  const activities = defaultCookingActivities().map((base) => {
    const stored = activitiesRaw.find((item) => isRecord(item) && item.id === base.id);
    if (!isRecord(stored)) return base;
    const windowStart = numIn(stored.windowStartHour, base.windowStartHour, 0, 23.75);
    const windowEnd = Math.max(windowStart + 0.5, numIn(stored.windowEndHour, base.windowEndHour, 0.25, 24));
    return {
      ...base,
      mealHour: numIn(stored.mealHour, base.mealHour, 0, 23.75),
      windowStartHour: windowStart,
      windowEndHour: windowEnd,
      applianceIds: Array.isArray(stored.applianceIds)
        ? (stored.applianceIds as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 8)
        : [],
      powerW: Math.max(0, numIn(stored.powerW, base.powerW, 0, 20000)),
      durationMinutes: Math.max(5, Math.round(numIn(stored.durationMinutes, base.durationMinutes, 5, 480))),
      essential: stored.essential === true,
      enabled: stored.enabled !== false,
    };
  });
  const nightRaw = isRecord(value.night) ? value.night : {};
  const known = new Set(appliances.map((a) => a.id));
  return {
    id: strOr(value.id, uid('hogar')),
    name: strOr(value.name, index === 0 ? 'Mi vivienda' : `Vivienda ${index + 1}`),
    appliances,
    cooking: {
      enabled: cooking.enabled !== false,
      fuelKind: fuelKind === 'charcoal' || fuelKind === 'gas' || fuelKind === 'other' ? fuelKind : null,
      // Antes, gas era el valor predeterminado. Los perfiles antiguos deben
      // confirmar que realmente lo tienen antes de sustituir comidas con él.
      fuelConfirmed: cooking.fuelConfirmed === true,
      substitution:
        substitution === 'fuel-first' || substitution === 'never' || substitution === 'electric-first'
          ? substitution
          : DEFAULT_COOKING.substitution,
      allowFlexibleTiming: cooking.allowFlexibleTiming !== false,
    },
    activities,
    night: {
      essentialIds: Array.isArray(nightRaw.essentialIds)
        ? (nightRaw.essentialIds as unknown[]).filter((id): id is string => typeof id === 'string' && known.has(id))
        : [],
    },
    voltage: value.voltage === 110 || value.voltage === 220 || value.voltage === 'both' ? value.voltage : 'both',
    createdAt: strOr(value.createdAt, new Date().toISOString()),
    updatedAt: strOr(value.updatedAt, strOr(value.createdAt, new Date().toISOString())),
  };
}

/** Instalación saneada: ligada a un hogar existente y con equipo válido. */
function sanitizeSystem(value: unknown, households: HouseholdProfile[], catalogs: {
  panels: PanelSpec[];
  batteries: BatterySpec[];
  inverters: InverterSpec[];
}, index = 0): SystemConfiguration | null {
  if (!isRecord(value)) return null;
  const householdId = strOr(value.householdProfileId, households[0]?.id ?? '');
  if (!households.some((h) => h.id === householdId)) return null;
  const pick = <T extends { id: string }>(list: T[], value: unknown, fallback: T): T =>
    list.find((item) => item.id === value) ?? fallback;
  const params = isRecord(value.params) ? sanitizeParams(value.params) : systemParams();
  return {
    id: strOr(value.id, uid('inst')),
    householdProfileId: householdId,
    name: strOr(value.name, index === 0 ? 'Instalación principal' : `Instalación ${index + 1}`),
    panelId: pick(catalogs.panels, value.panelId, catalogs.panels[0]).id,
    panelCount: Math.round(numIn(value.panelCount, 0, 0, 200)),
    batteryId: pick(catalogs.batteries, value.batteryId, catalogs.batteries[0]).id,
    batteryCount: Math.round(numIn(value.batteryCount, 1, 0, 100)),
    inverterId: pick(catalogs.inverters, value.inverterId, catalogs.inverters[0]).id,
    installationType: value.installationType === 'offgrid' ? 'offgrid' : 'hybrid',
    params,
    origin: value.origin === 'offer' ? 'offer' : 'user',
    createdAt: strOr(value.createdAt, new Date().toISOString()),
    updatedAt: strOr(value.updatedAt, strOr(value.createdAt, new Date().toISOString())),
  };
}

function sanitizeSnapshot(value: unknown): SimulationSnapshot | null {
  if (!isRecord(value)) return null;
  const metrics = isRecord(value.metrics) ? value.metrics : {};
  const num = (key: string) => numIn(metrics[key], 0, -1e9, 1e9);
  return {
    id: strOr(value.id, uid('sim')),
    createdAt: strOr(value.createdAt, new Date().toISOString()),
    householdProfileId: strOr(value.householdProfileId, ''),
    systemConfigurationId: strOr(value.systemConfigurationId, ''),
    householdName: strOr(value.householdName, 'Vivienda'),
    systemName: strOr(value.systemName, 'Instalación'),
    householdKwhPerDay: numIn(value.householdKwhPerDay, 0, 0, 1e6),
    assumptions: isRecord(value.assumptions)
      ? (value.assumptions as unknown as SimulationSnapshot['assumptions'])
      : {
          hsp: DEFAULT_PARAMS.hsp,
          dod: DEFAULT_PARAMS.dod,
          minSoc: DEFAULT_PARAMS.minSoc,
          inverterEfficiency: DEFAULT_PARAMS.inverterEfficiency,
          chargerEfficiency: DEFAULT_PARAMS.chargerEfficiency,
          gridImportLimitW: DEFAULT_CUBA_RESIDENTIAL_GRID_LIMIT_W,
        },
    metrics: {
      coverageMedian: num('coverageMedian'),
      coverageWorst: num('coverageWorst'),
      coverageBest: num('coverageBest'),
      unservedKwhWorst: num('unservedKwhWorst'),
      gridKwhMedian: num('gridKwhMedian'),
      pvKwhMedian: num('pvKwhMedian'),
      blackoutCoverage: num('blackoutCoverage'),
      blackoutUnservedKwh: num('blackoutUnservedKwh'),
      cookingMealsUnmetWorst: num('cookingMealsUnmetWorst'),
      nightDeficitKwhWorst: num('nightDeficitKwhWorst'),
      minSocWorst: num('minSocWorst'),
    },
  };
}

export const DEFAULT_GRID_INPUT: GridInput = {
  hoursPerDay: 3,
  pattern: 'evening',
  startHour: 18,
  maxPowerW: DEFAULT_CUBA_RESIDENTIAL_GRID_LIMIT_W,
  voltage: 'both',
};

function baseCatalogs(): { panels: PanelSpec[]; batteries: BatterySpec[]; inverters: InverterSpec[] } {
  return {
    panels: [...VERIFIED_PANELS, ...REFERENCE_PANELS].map((p) => ({ ...p })),
    batteries: [...VERIFIED_BATTERIES, ...REFERENCE_BATTERIES].map((b) => ({ ...b })),
    inverters: [...VERIFIED_INVERTERS, ...REFERENCE_INVERTERS].map((i) => ({
      ...i,
      mppt: i.mppt.map((m) => ({ ...m })),
    })),
  };
}

export function createInitialState(): AppState {
  const catalogs = baseCatalogs();
  return {
    version: SCHEMA_VERSION,
    households: [],
    installations: [],
    simulations: [],
    activeHouseholdId: '',
    activeInstallationId: null,
    ...catalogs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Carga tolerante y validada (M1).
 *
 * Reglas:
 *  - Cada perfil y cada registro de catálogo se valida por separado: un
 *    elemento corrupto se descarta, los válidos se conservan.
 *  - Los parámetros se sanean por rango y el paso se restringe a
 *    `[5, 10, 15, 30, 60]` (antes `stepMinutes = 0` multiplicaba por infinito).
 *  - JSON inválido, almacenamiento inexistente o cuota agotada devuelven el
 *    estado inicial sin romper la aplicación.
 */
export function loadState(): AppState {
  const base = createInitialState();
  let parsed: unknown = null;
  try {
    // La clave v4 elimina la configuración comercial heredada. Se siguen leyendo
    // v3 y anteriores para conservar viviendas, instalaciones y simulaciones.
    const raw =
      localStorage.getItem(KEY) ??
      localStorage.getItem('calculadora-solar-cuba:v3') ??
      localStorage.getItem('calculadora-solar-cuba:v1') ??
      localStorage.getItem('calculadora-solar-cuba:v2');
    if (raw) parsed = migrate(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return createInitialState();
  }
  if (!isRecord(parsed)) return createInitialState();

  const catalogs = baseCatalogs();
  // Catálogo: los elementos guardados se sanean uno a uno y se completan con
  // las plantillas que falten (por id). Un panel con potencia inválida se
  // corrige, no se propaga como «miles de paneles».
  const mergeSanitized = <T extends { id: string }>(stored: unknown, sanitize: (v: unknown) => T, defaults: T[]): T[] => {
    const own: T[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(stored) ? (stored as unknown[]) : []) {
      const item = sanitize(raw);
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      own.push(item);
    }
    const missing = defaults.filter((item) => !seen.has(item.id)).map((item) => ({ ...item }));
    return [...own, ...missing];
  };
  const panels = mergeSanitized<PanelSpec>(parsed.panels, sanitizePanel, catalogs.panels);
  const batteries = mergeSanitized<BatterySpec>(parsed.batteries, sanitizeBattery, catalogs.batteries);
  const inverters = mergeSanitized<InverterSpec>(parsed.inverters, sanitizeInverter, catalogs.inverters);

  const storedVersion = typeof parsed.version === 'number' ? parsed.version : 1;

  // ── Migración v1/v2 → v3/v4; v3 ya contiene hogares e instalaciones. ──
  //  · Los perfiles de equipo (o los electrodomésticos sueltos) se convierten
  //    en hogares completos, con sus electrodomésticos intactos.
  //  · Se crea UNA instalación por hogar con el equipo que tenía seleccionado
  //    el usuario; las cantidades quedan a 0 y el asistente las pide. Ningún
  //    dato de consumo se pierde.
  const households: HouseholdProfile[] = [];
  if (storedVersion < 3) {
    const rawProfiles = Array.isArray(parsed.profiles) ? (parsed.profiles as unknown[]) : [];
    const seen = new Set<string>();
    rawProfiles.forEach((raw, index) => {
      const household = sanitizeHousehold(raw, index);
      if (household && !seen.has(household.id)) {
        seen.add(household.id);
        households.push(household);
      }
    });
    if (!households.length) {
      const legacyAppliances = Array.isArray(parsed.appliances)
        ? (parsed.appliances as unknown[]).map(sanitizeAppliance).filter((a): a is Appliance => a !== null)
        : [];
      households.push(
        sanitizeHousehold(
          { id: 'hogar-principal', name: 'Mi vivienda', appliances: legacyAppliances },
          0,
        ) as HouseholdProfile,
      );
    }
  } else {
    const rawHouseholds = Array.isArray(parsed.households) ? (parsed.households as unknown[]) : [];
    const seen = new Set<string>();
    rawHouseholds.forEach((raw, index) => {
      const household = sanitizeHousehold(raw, index);
      if (household && !seen.has(household.id)) {
        seen.add(household.id);
        households.push(household);
      }
    });
  }

  const installations: SystemConfiguration[] = [];
  if (storedVersion < 3 && households.length) {
    const first = households[0];
    const params = sanitizeParams(parsed.params);
    // El límite de importación antiguo vivía en `gridInput.maxPowerW`.
    params.gridMaxPowerW = sanitizeGridInput(parsed.gridInput).maxPowerW;
    installations.push(
      sanitizeSystem(
        {
          id: uid('inst'),
          householdProfileId: first.id,
          name: 'Instalación migrada',
          panelId: parsed.panelId,
          panelCount: 0,
          batteryId: parsed.batteryId,
          batteryCount: 1,
          inverterId: parsed.inverterId,
          installationType: parsed.installationType,
          params,
          origin: 'user',
          createdAt: new Date().toISOString(),
        },
        households,
        { panels, batteries, inverters },
        0,
      ) as SystemConfiguration,
    );
  } else {
    const rawSystems = Array.isArray(parsed.installations) ? (parsed.installations as unknown[]) : [];
    const seen = new Set<string>();
    rawSystems.forEach((raw, index) => {
      const system = sanitizeSystem(raw, households, { panels, batteries, inverters }, index);
      if (system && !seen.has(system.id)) {
        seen.add(system.id);
        installations.push(system);
      }
    });
  }

  const simulations = (Array.isArray(parsed.simulations) ? (parsed.simulations as unknown[]) : [])
    .map(sanitizeSnapshot)
    .filter((s): s is SimulationSnapshot => s !== null)
    .slice(0, 50);

  const requestedActive = storedVersion < 3 ? parsed.activeProfileId : parsed.activeHouseholdId;
  const activeHouseholdId =
    typeof requestedActive === 'string' && households.some((h) => h.id === requestedActive)
      ? requestedActive
      : (households[0]?.id ?? '');
  const forActive = installations.filter((s) => s.householdProfileId === activeHouseholdId);
  const activeInstallationId =
    typeof parsed.activeInstallationId === 'string' &&
    forActive.some((s) => s.id === parsed.activeInstallationId)
      ? parsed.activeInstallationId
      : (forActive[0]?.id ?? null);

  return {
    ...base,
    households,
    installations,
    simulations,
    activeHouseholdId,
    activeInstallationId,
    panels,
    batteries,
    inverters,
    version: SCHEMA_VERSION,
  };
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION }));
    // Una vez guardada correctamente la nueva estructura, se retiran las
    // claves antiguas que aún podían contener la configuración editable anterior.
    for (const legacyKey of [
      'calculadora-solar-cuba:v1',
      'calculadora-solar-cuba:v2',
      'calculadora-solar-cuba:v3',
    ]) {
      try {
        localStorage.removeItem(legacyKey);
      } catch {
        // Una clave antigua que no pueda borrarse no invalida el nuevo guardado.
      }
    }
  } catch {
    // Modo privado o cuota agotada: la aplicación sigue funcionando en memoria.
  }
}

export function clearState(): void {
  try {
    // La clave cambia de versión: se limpian también las antiguas para no
    // dejar datos obsoletos que puedan confundir.
    for (const key of ['calculadora-solar-cuba:v1', 'calculadora-solar-cuba:v2', 'calculadora-solar-cuba:v3']) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Sin almacenamiento disponible.
      }
    }
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Sin almacenamiento disponible.
    }
  } catch {
    // Sin almacenamiento disponible.
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
