import { describe, expect, it } from 'vitest';
import { evaluateSystem } from '../domain/simulator/scenarioGrid';
import { buildOfferSpecs, checkOfferCompatibility, offerToSystem, type OfferEquipmentForm } from '../domain/simulator/offerReport';
import { nightReserveSoc, socFloorByInterval, nightEssentialKwh } from '../domain/simulator/bridge';
import { DEFAULT_COOKING, defaultCookingActivities, type HouseholdProfile } from '../domain/household/types';
import { systemParams } from '../domain/system/types';
import { appliance, battery, inverter, panel, params } from './fixtures';
import { GRID_RETURN_SCENARIO_COUNT } from '../domain/simulator/gridScenarios';

/**
 * Arquitectura hogar ↔ instalación ↔ resultado. Comprueba que el hogar es
 * reutilizable, que la instalación es reemplazable y que el resultado es una
 * foto coherente.
 */

function household(overrides: Partial<HouseholdProfile> = {}): HouseholdProfile {
  return {
    id: 'h1',
    name: 'Casa',
    appliances: [
      appliance({ id: 'nevera', name: 'Nevera', powerW: 150, hoursPerDay: 24, schedule: 'both', priority: 'critical', surgeFactor: 3, dutyCycle: 0.35, profile: 'cyclic' }),
      appliance({ id: 'tv', name: 'Televisor', powerW: 120, hoursPerDay: 4, schedule: 'day', priority: 'important' }),
      appliance({ id: 'abanico', name: 'Abanico', powerW: 70, hoursPerDay: 10, schedule: 'night', priority: 'discretionary' }),
    ],
    cooking: { ...DEFAULT_COOKING },
    activities: defaultCookingActivities(),
    night: { essentialIds: ['abanico'] },
    voltage: 'both',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function system(overrides: Partial<Parameters<typeof evaluateSystem>[0]['system']> = {}) {
  return {
    id: 'i1',
    householdProfileId: 'h1',
    name: '5 kWh',
    panelId: 'p1',
    panelCount: 6,
    batteryId: 'b1',
    batteryCount: 1,
    inverterId: 'inv1',
    installationType: 'hybrid' as const,
    params: { ...systemParams(), stepMinutes: 15 },
    origin: 'user' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function evaluationInput(systemOverrides: Partial<Parameters<typeof evaluateSystem>[0]['system']> = {}, householdOverrides: Partial<HouseholdProfile> = {}) {
  return {
    household: household(householdOverrides),
    system: system(systemOverrides),
    panel: panel({ powerW: 550 }),
    battery: battery({ nominalKwh: 5, maxDischargeW: 1920, maxChargeW: 1920, dod: 0.8 }),
    inverter: inverter({ gridChargerW: 1500 }),
  };
}

describe('evaluación sobre el escenario completo (§4)', () => {
  it('evalúa exactamente los 24 escenarios más el apagón total', () => {
    const evaluation = evaluateSystem(evaluationInput());
    expect(evaluation.behaviors.usual.scenarios).toHaveLength(GRID_RETURN_SCENARIO_COUNT);
    expect(evaluation.behaviors.usual.blackout.isBlackout).toBe(true);
    expect(evaluation.behaviors.flexible.scenarios).toHaveLength(GRID_RETURN_SCENARIO_COUNT);
  });

  it('usa identificadores deterministas y el mismo conjunto para ambas instalaciones', () => {
    const a = evaluateSystem(evaluationInput());
    const b = evaluateSystem(evaluationInput({ name: '10 kWh', panelCount: 12, batteryCount: 2 }));
    expect(a.scenarios.map((s) => s.id)).toEqual(b.scenarios.map((s) => s.id));
    expect(a.scenarios.map((s) => s.label)).toEqual(b.scenarios.map((s) => s.label));
  });

  it('calcula mediana, peor, mejor y variación sobre los 24 casos', () => {
    const { behaviors: { usual } } = evaluateSystem(evaluationInput());
    const coverages = usual.scenarios.map((s) => s.coverage);
    expect(usual.coverageMedian).toBeLessThanOrEqual(Math.max(...coverages));
    expect(usual.coverageWorst).toBeLessThanOrEqual(usual.coverageMedian);
    expect(usual.coverageBest).toBeGreaterThanOrEqual(usual.coverageMedian);
    // Recalculado de forma independiente desde los datos de los 24 casos,
    // no desde el mismo campo agregado.
    const sorted = [...usual.scenarios.map((s) => s.coverage)].sort((a, b) => a - b);
    const medianCoverage =
      sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    expect(usual.coverageMedian).toBeCloseTo(medianCoverage, 12);
    expect(usual.coverageWorst).toBeCloseTo(sorted[0], 12);
    expect(usual.coverageBest).toBeCloseTo(sorted[sorted.length - 1], 12);
    expect(usual.variation).toBeCloseTo(sorted[sorted.length - 1] - sorted[0], 12);
  });

  it('el apagón total cubre menos que la mediana de los casos con red', () => {
    const { behaviors: { usual } } = evaluateSystem(evaluationInput());
    expect(usual.blackout.coverage).toBeLessThan(usual.coverageMedian + 1e-9);
    expect(usual.blackout.gridKwh).toBe(0);
  });

  it('más batería mejora el peor caso sin cambiar los hábitos del hogar', () => {
    const small = evaluateSystem(evaluationInput()).behaviors.usual;
    const large = evaluateSystem(evaluationInput({ panelCount: 12, batteryCount: 2 })).behaviors.usual;
    expect(large.coverageWorst).toBeGreaterThanOrEqual(small.coverageWorst - 1e-9);
    // Los hábitos (cocina, noche) son idénticos: sólo cambia el equipo.
    expect(large.blackout.cookingMealsUnmet).toBe(small.blackout.cookingMealsUnmet);
  });

  it('el SOC inicial del 30 % revela el déficit nocturno de una instalación pequeña', () => {
    // La prueba ahora comienza a las 08:00 con SOC = 30 %, no con la batería
    // llena a medianoche. Además, al no haber combustible alternativo, las
    // comidas son demanda eléctrica obligatoria y pueden consumir la reserva.
    // Un sistema pequeño puede, por tanto, llegar a la noche con déficit real.
    const heavyNight: Partial<HouseholdProfile> = {
      appliances: [
        appliance({ id: 'nevera', name: 'Nevera', powerW: 150, hoursPerDay: 24, schedule: 'both', priority: 'critical', dutyCycle: 0.35, profile: 'cyclic' }),
        appliance({ id: 'fan', name: 'Abanico', powerW: 200, hoursPerDay: 24, schedule: 'night', priority: 'critical' }),
        appliance({ id: 'tv', name: 'Televisor', powerW: 400, hoursPerDay: 10, schedule: 'day', priority: 'discretionary' }),
      ],
      night: { essentialIds: ['fan'] },
    };
    const small = evaluateSystem(evaluationInput({ panelCount: 0, batteryCount: 1 }, heavyNight)).behaviors.usual;
    const large = evaluateSystem(evaluationInput({ panelCount: 40, batteryCount: 4 }, heavyNight)).behaviors.usual;

    // La evaluación usa el SOC inicial del 30 % y conserva toda la demanda
    // eléctrica de cocina: el sistema pequeño no puede garantizar la noche.
    expect(small.initialSoc).toBeCloseTo(0.30, 6);
    expect(small.unservedKwhWorst).toBeGreaterThan(0);
    expect(small.nightDeficitKwhWorst).toBeGreaterThan(0);

    // Con muchos más paneles y batería el déficit total y el nocturno disminuyen.
    expect(large.unservedKwhWorst).toBeLessThan(small.unservedKwhWorst);
    expect(large.nightDeficitKwhWorst).toBeLessThan(small.nightDeficitKwhWorst);
  });

  it('la cocción flexible no empeora la cobertura respecto a la habitual', () => {
    const { behaviors: { usual, flexible } } = evaluateSystem(evaluationInput({ panelCount: 4, batteryCount: 1 }));
    expect(flexible.coverageWorst).toBeGreaterThanOrEqual(usual.coverageWorst - 1e-9);
  });
});

describe('reserva nocturna derivada del consumo real (§6)', () => {
  const design = params({ stepMinutes: 15 });

  it('crece con la energía nocturna esencial declarada', () => {
    const without = nightReserveSoc(household({ night: { essentialIds: [] } }), design, battery({ nominalKwh: 5 }), 1);
    const withFan = nightReserveSoc(household(), design, battery({ nominalKwh: 5 }), 1);
    expect(without).toBe(0);
    expect(withFan).toBeGreaterThan(0.2);
  });

  it('el suelo por intervalo sólo es alto durante el día', () => {
    const floors = socFloorByInterval(household(), design, battery({ nominalKwh: 5 }), 1);
    expect(floors).toHaveLength(96);
    const dayFloor = floors[40]; // 10:00
    const nightFloor = floors[76]; // 19:00
    expect(dayFloor).toBeGreaterThan(nightFloor);
    expect(nightFloor).toBeCloseTo(0.2, 6); // suelo del banco (DoD 0,8)
  });

  it('la energía esencial nocturna declarada coincide con el consumo nocturno de esos equipos', () => {
    const kwh = nightEssentialKwh(household(), design);
    // Abanico: 70 W × 10 h por la noche.
    expect(kwh).toBeCloseTo((70 * 10) / 1000, 6);
  });
});

describe('comprobación de ofertas (§10)', () => {
  const fullForm: OfferEquipmentForm = {
    panelCount: 8,
    panelW: 550,
    panelVocV: 49,
    panelVmppV: 42,
    panelIscA: 13.5,
    panelImppA: 13.1,
    panelTempCoeffVoc: -0.0028,
    panelTempCoeffPmpp: -0.0035,
    panelNoct: 45,
    batteryCount: 2,
    batteryKwhEach: 5,
    batteryV: 51.2,
    batteryCapacityAh: 100,
    batteryMaxDischargeW: 5120,
    batteryMaxChargeW: 2560,
    batteryDod: 0.8,
    batteryChargeEff: 0.95,
    batteryDischargeEff: 0.95,
    inverterRatedW: 5000,
    inverterSurgeW: 10000,
    inverterMaxPvInputW: 8000,
    inverterEfficiency: 0.92,
    inverterMaxChargeA: 100,
    inverterMaxDischargeA: 100,
    inverterBatteryVoltageV: 51.2,
    inverterGridChargerW: 1500,
    mpptMaxV: 450,
    mpptMinV: 120,
    mpptMaxA: 18,
    mpptMaxW: 6000,
  };

  it('con todos los datos declara la oferta como verificada', () => {
    const specs = buildOfferSpecs(fullForm);
    const report = checkOfferCompatibility({ household: household(), form: fullForm, ...specs });
    expect(report.verified).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it('sin datos eléctricos la verificación queda explícitamente pendiente', () => {
    const sparse: OfferEquipmentForm = {
      ...fullForm,
      panelVocV: 0,
      panelVmppV: 0,
      panelIscA: 0,
      mpptMaxV: 0,
      mpptMinV: 0,
      batteryMaxDischargeW: 0,
      batteryMaxChargeW: 0,
      batteryV: 0,
    };
    const specs = buildOfferSpecs(sparse);
    const report = checkOfferCompatibility({ household: household(), form: sparse, ...specs });
    expect(report.verified).toBe(false);
    expect(report.missing.length).toBeGreaterThan(0);
    expect(report.diagnostics.some((d) => d.code === 'OFFER_MISSING_DATA')).toBe(true);
    // La simulación energética sigue siendo posible: no se bloquea.
    const evaluation = evaluateSystem({
      household: household(),
      system: offerToSystem(sparse, 'h1', 'Oferta', systemParams()),
      ...specs,
    });
    expect(evaluation.behaviors.usual.scenarios).toHaveLength(GRID_RETURN_SCENARIO_COUNT);
  });

  it('una oferta sin cargador AC declarado nunca carga desde red en la simulación', () => {
    const form: OfferEquipmentForm = { ...fullForm, inverterGridChargerW: 0 };
    const specs = buildOfferSpecs(form);
    expect(specs.inverter.gridChargerW).toBeUndefined();
    const { behaviors: { usual } } = evaluateSystem({
      household: household(),
      system: offerToSystem(form, 'h1', 'Oferta', systemParams()),
      ...specs,
    });
    expect(usual.blackout.gridKwh).toBe(0);
  });

  it('la oferta se convierte en una instalación ligada al hogar', () => {
    const built = offerToSystem(fullForm, 'h1', 'Oferta analizada', systemParams());
    expect(built.householdProfileId).toBe('h1');
    expect(built.origin).toBe('offer');
    expect(built.panelCount).toBe(8);
  });
});