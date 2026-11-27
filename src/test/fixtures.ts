import type {
  Appliance,
  BatterySpec,
  DesignParams,
  EnergySystemConfig,
  GridModel,
  InverterSpec,
  PanelSpec,
} from '../domain/core/types';
import { DEFAULT_PARAMS, REFERENCE_BATTERIES, REFERENCE_INVERTERS, REFERENCE_PANELS, solarFromParams } from '../domain/core/defaults';
import { buildGridModel } from '../domain/simulator/grid';

export function appliance(overrides: Partial<Appliance> = {}): Appliance {
  return {
    id: 'a1',
    name: 'Equipo de prueba',
    category: 'Otros',
    icon: 'plug',
    quantity: 1,
    powerW: 100,
    hoursPerDay: 5,
    schedule: 'day',
    startHour: 8,
    priority: 'critical',
    surgeFactor: 1,
    dutyCycle: 1,
    profile: 'constant',
    ...overrides,
  };
}

export function panel(overrides: Partial<PanelSpec> = {}): PanelSpec {
  return { ...REFERENCE_PANELS[0], ...overrides };
}

export function battery(overrides: Partial<BatterySpec> = {}): BatterySpec {
  return { ...REFERENCE_BATTERIES[0], ...overrides };
}

export function inverter(overrides: Partial<InverterSpec> = {}): InverterSpec {
  const base = REFERENCE_INVERTERS[0];
  // Copia profunda: compartir `mppt`/`acVoltages` con las plantillas del
  // módulo hacía que un test que los mutara corrompiera el resto de la suite.
  return {
    ...base,
    ...overrides,
    mppt: overrides.mppt
      ? overrides.mppt.map((m) => ({ ...m }))
      : base.mppt.map((m) => ({ ...m })),
    acVoltages: overrides.acVoltages ? [...overrides.acVoltages] : [...base.acVoltages],
  };
}

export function params(overrides: Partial<DesignParams> = {}): DesignParams {
  return { ...DEFAULT_PARAMS, ...overrides };
}

export function grid(overrides: Partial<GridModel> = {}, design = DEFAULT_PARAMS): GridModel {
  const built = buildGridModel(
    {
      hoursPerDay: 3,
      pattern: 'evening',
      startHour: 18,
      maxPowerW: 3000,
      voltage: 'both',
    },
    design,
  );
  return { ...built, ...overrides };
}

export function config(overrides: Partial<EnergySystemConfig> = {}): EnergySystemConfig {
  const p = overrides.params ?? params();
  return {
    panel: panel(),
    panelCount: 4,
    battery: battery(),
    batteryCount: 1,
    inverter: inverter(),
    appliances: [appliance()],
    grid: overrides.grid ?? grid({}, p),
    solar: solarFromParams(p),
    params: p,
    ...overrides,
  };
}
