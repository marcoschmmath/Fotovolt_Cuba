import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { useEvaluation, useHouseholdComparison } from '../app/useCalculation';
import type { BehaviorOutcome } from '../domain/simulator/scenarioGrid';
import { scenarioById, HIGHLIGHT_SCENARIO_IDS } from '../domain/simulator/gridScenarios';
import { buildEnergySystemConfig, socFloorByInterval, nightEssentialKwh } from '../domain/simulator/bridge';
import { simulate } from '../domain/simulator/engine';
import { analyzeEnergy, peakDesignW } from '../domain/calculator/energy';
import { checkInverterCompatibility } from '../domain/calculator/inverter';
import { batteryPack } from '../domain/calculator/battery';
import { BatteryRing, SocChart } from '../ui/charts';
import { Badge, Button, Note, Panel, SectionTitle, Segmented, Stat, Stepper, Toast, fmtKwh } from '../ui/components';
import { Icon } from '../ui/icons';

type Behavior = 'usual' | 'flexible';
type ResultTab = 'summary' | 'scenarios' | 'detail';

const BEHAVIOR_LABELS: Array<{ value: Behavior; label: string }> = [
  { value: 'usual', label: 'Hábitos habituales' },
  { value: 'flexible', label: 'Preparación flexible' },
];
const RESULT_TABS: Array<{ value: ResultTab; label: string }> = [
  { value: 'summary', label: 'Resumen' },
  { value: 'scenarios', label: 'Escenarios' },
  { value: 'detail', label: 'Detalle' },
];
const cents = (value: number) => `${Math.round(value * 100)} %`;

export function Result({ navigate, installationId }: { navigate: (path: string) => void; installationId?: string }) {
  const { state, saveSnapshot } = useApp();
  const { evaluation, active } = useEvaluation(state, installationId);
  const [behavior, setBehavior] = useState<Behavior>('usual');
  const [resultTab, setResultTab] = useState<ResultTab>('summary');
  const [focusScenarioId, setFocusScenarioId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const household = active.household;
  const system = active.system;
  const panel = active.panel;
  const battery = active.battery;
  const inverter = active.inverter;
  const comparison = useHouseholdComparison(state, household?.id ?? '');
  const initialSoc = system && battery
    ? Math.min(1, Math.max(0.30, batteryPack(battery, system.batteryCount, system.params).minSoc))
    : 0.30;

  const intervals = useMemo(() => {
    if (!household || !system || !panel || !battery || !inverter) return null;
    const scenario = scenarioById(focusScenarioId ?? 'rt-09', system.params);
    return simulate(
      buildEnergySystemConfig({ household, system, panel, battery, inverter, gridAvailable: scenario.available }),
      {
        cooking: {
          activities: household.activities,
          mode: behavior,
          substitution: household.cooking.substitution,
          hasFuel: household.cooking.fuelKind !== null && household.cooking.fuelConfirmed,
        },
        socFloorByInterval: socFloorByInterval(household, system.params, battery, system.batteryCount, inverter),
        startHour: 8,
        startSoc: initialSoc,
      },
    );
  }, [household, system, panel, battery, inverter, focusScenarioId, behavior, initialSoc]);

  const outcome: BehaviorOutcome | null = evaluation ? evaluation.behaviors[behavior] : null;

  if (active.requestedInstallationMissing) {
    return (
      <div className="stack wizard-page">
        <Stepper step={3} labels={['Sistema', 'Simulación', 'Resultados']} />
        <Panel tone="paper">
          <SectionTitle title="Instalación no encontrada" description="El resultado solicitado no está disponible. Comprueba el enlace o selecciona una instalación guardada desde Inicio." />
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => navigate('/')}>Ir a mis instalaciones</Button>
            <Button onClick={() => navigate('/instalacion')}>Crear una instalación</Button>
          </div>
        </Panel>
      </div>
    );
  }

  // Una instalación sólo puede producir resultados si sus tres equipos
  // seleccionados siguen existiendo en el catálogo local.
  if (!household || !system || !panel || !battery || !inverter || !evaluation || !outcome) {
    return (
      <div className="stack wizard-page">
        <Stepper step={3} labels={['Sistema', 'Simulación', 'Resultados']} />
        <Panel tone="paper">
          <SectionTitle title="Todavía no hay resultados" description="Configura una vivienda y una instalación para comparar cómo se comportaría el sistema." />
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => navigate('/')}>Volver al inicio</Button>
            <Button icon="home" onClick={() => navigate('/hogar')}>Configurar vivienda</Button>
          </div>
        </Panel>
      </div>
    );
  }

  const nightKwh = nightEssentialKwh(household, system.params);

  const save = () => {
    const energy = analyzeEnergy(household.appliances, system.params);
    saveSnapshot({
      householdProfileId: household.id,
      systemConfigurationId: system.id,
      householdName: household.name,
      systemName: system.name,
      householdKwhPerDay: energy.dailyKwh,
      assumptions: {
        hsp: system.params.hsp,
        dod: system.params.dod,
        minSoc: system.params.minSoc,
        inverterEfficiency: system.params.inverterEfficiency,
        chargerEfficiency: system.params.chargerEfficiency,
        gridImportLimitW: system.params.gridMaxPowerW,
      },
      metrics: {
        coverageMedian: outcome.coverageMedian,
        coverageWorst: outcome.coverageWorst,
        coverageBest: outcome.coverageBest,
        unservedKwhWorst: outcome.unservedKwhWorst,
        gridKwhMedian: outcome.gridKwhMedian,
        pvKwhMedian: outcome.pvKwhMedian,
        blackoutCoverage: outcome.blackout.coverage,
        blackoutUnservedKwh: outcome.blackout.unservedKwh,
        cookingMealsUnmetWorst: outcome.cookingMealsUnmetWorst,
        nightDeficitKwhWorst: outcome.nightDeficitKwhWorst,
        minSocWorst: Math.min(...outcome.scenarios.map((s) => s.minSoc), 1),
      },
    });
    setToast('Resultado guardado. Quedará como foto aunque cambies los datos después.');
  };

  const comparisons = comparison.map((row) => ({
    inst: row.system,
    outcome: row.evaluation.behaviors[behavior],
    panels: row.system.panelCount,
    kwh: (state.batteries.find((b) => b.id === row.system.batteryId)?.nominalKwh ?? 0) * row.system.batteryCount,
  }));

  const fullCoverage = outcome.coverageWorst >= 0.999;
  const energyCompatible = fullCoverage && outcome.energySustainable && outcome.cookingMealsUnmetWorst === 0;
  const householdDemand = analyzeEnergy(household.appliances, system.params);
  const technicalCheck = checkInverterCompatibility({
    inverter, battery, panel, panelCount: system.panelCount, batteryCount: system.batteryCount,
    continuousW: householdDemand.peakSimultaneousW,
    peakW: peakDesignW(householdDemand),
    voltage: household.voltage, params: system.params,
  });
  const compatible = energyCompatible && technicalCheck.status === 'verified';
  const energyFavorableButPartial = energyCompatible && technicalCheck.status === 'partial';
  const technicalIncompatibility = technicalCheck.status === 'incompatible';

  return (
    <div className="stack wizard-page result-screen">
      <Stepper step={3} labels={['Sistema', 'Simulación', 'Resultados']} />
      <SectionTitle
        eyebrow={`${household.name} · ${system.name}`}
        title="Resultados de tu sistema"
        description={`${system.panelCount} paneles de ${panel?.powerW ?? 0} W · ${system.batteryCount} baterías de ${battery?.nominalKwh ?? 0} kWh · inversor de ${inverter?.ratedW ?? 0} W`}
      />

      <div className="result-tabs" role="tablist" aria-label="Secciones de resultados">
        {RESULT_TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.value}
            aria-selected={resultTab === tab.value}
            className={resultTab === tab.value ? 'is-active' : ''}
            onClick={() => setResultTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="result-tab-panel" hidden={resultTab !== 'summary'}>
        <Panel tone="paper" className="result-overview">
          <div className="result-overview__headline">
            <span className="result-overview__check"><Icon name={compatible ? 'check' : 'bolt'} size={25} /></span>
            <div>
              <h2>{compatible ? 'Sistema compatible con esta vivienda' : energyFavorableButPartial ? 'Cobertura favorable · verificación parcial' : technicalIncompatibility && energyCompatible ? 'La energía alcanza, pero hay incompatibilidades técnicas' : fullCoverage && !outcome.energySustainable ? 'Cubre el día, pero no repone la batería' : `Cobertura típica del ${cents(outcome.coverageMedian)}`}</h2>
              <p>
                {compatible
                  ? 'Cubre la demanda en los 24 horarios habituales y termina el día con al menos el SOC inicial. Las comprobaciones técnicas disponibles no muestran incompatibilidades.'
                  : energyFavorableButPartial
                    ? 'La simulación energética es favorable, pero faltan datos para verificar completamente la conexión eléctrica. Consulta los avisos antes de instalar.'
                    : technicalIncompatibility && energyCompatible
                      ? 'La simulación energética es favorable, pero se detectó al menos una incompatibilidad eléctrica conocida. No instales la configuración sin corregirla.'
                      : fullCoverage
                        ? `La energía alcanza para este día, pero la batería termina por debajo del ${Math.round(outcome.initialSoc * 100)} % inicial. No se puede asegurar que el resultado se repita cada día.`
                        : 'La cobertura cambia según la hora a la que vuelve la electricidad. Revisa el peor escenario antes de decidir.'}
              </p>
            </div>
          </div>
          <div className="result-metrics">
            <Stat tone="solar" value={cents(outcome.coverageMedian)} label="Cobertura típica" />
            <Stat tone="demand" value={cents(outcome.coverageWorst)} label="Peor escenario" />
            <Stat value={fmtKwh(outcome.unservedKwhWorst)} label="Energía no suministrada" />
          </div>
          <div className="result-overview__note">
            <Icon name="bolt" size={19} />
            <span>
              La prueba comienza a las 08:00 con un SOC inicial de {Math.round(outcome.initialSoc * 100)} % y termina a las 08:00 del día siguiente.
              {nightKwh > 0 ? ` Tus equipos esenciales necesitan ${fmtKwh(nightKwh)} durante la noche; si la cocina consume esa reserva, el déficit se refleja en los resultados.` : ' Aún no has marcado equipos esenciales de noche en tu vivienda.'}
            </span>
          </div>
          {technicalCheck.status !== 'verified' && (
            <Note level={technicalCheck.status === 'incompatible' ? 'error' : 'warning'} title={technicalCheck.status === 'incompatible' ? 'Incompatibilidades técnicas detectadas' : 'Datos técnicos pendientes de verificar'}>
              <ul className="diagnostic-list">
                {technicalCheck.diagnostics.filter((diagnostic) => diagnostic.level !== 'info' || !['INV_SURGE_OK', 'MPPT_OK'].includes(diagnostic.code)).map((diagnostic) => (
                  <li key={diagnostic.code}>{diagnostic.message}</li>
                ))}
              </ul>
              La simulación estima el comportamiento energético, pero no sustituye la comprobación de tensiones, corrientes, protecciones y conexión por un instalador profesional.
              <div style={{ marginTop: '.65rem' }}>
                <Button variant="outline" onClick={() => navigate('/contacto')}>Consultar con el instalador</Button>
              </div>
            </Note>
          )}
          <p className="field__hint" style={{ margin: '.75rem 0 0' }}>
            «Compatible» significa que cubre la demanda, repone el SOC inicial en los 24 horarios habituales y no presenta incompatibilidades técnicas conocidas con los datos declarados. Si faltan datos eléctricos, el resultado será parcial; el apagón completo de 24 horas se muestra aparte como prueba de estrés.
          </p>
        </Panel>

        <Panel tone="paper" className="result-actions-card">
          <div className="panel__head"><h3>Explora tu instalación</h3></div>
          <Segmented value={behavior} options={BEHAVIOR_LABELS} label="Comportamiento de cocina" onChange={setBehavior} />
          <p className="field__hint" style={{ margin: '.6rem 0 0' }}>
            {behavior === 'usual'
              ? 'Las comidas se preparan a las horas habituales. Si falta electricidad se utiliza combustible alternativo cuando existe.'
              : 'La preparación puede adelantarse dentro de la ventana permitida. La hora de servir la comida no cambia.'}
          </p>
          <div className="wizard-actions">
            <Button variant="quiet" icon="play" onClick={() => navigate(`/simulacion?id=${system.id}`)}>Ver simulación</Button>
            <Button icon="doc" onClick={save}>Guardar resultado</Button>
          </div>
          <div className="result-edit-links">
            <button type="button" className="linkish" onClick={() => navigate(`/hogar?id=${household.id}`)}>Editar vivienda</button>
            <button type="button" className="linkish" onClick={() => navigate(`/instalacion?id=${system.id}`)}>Editar instalación</button>
          </div>
        </Panel>
      </div>

      <div className="result-tab-panel" hidden={resultTab !== 'scenarios'}>
        <Panel tone="paper">
          <div className="panel__head">
            <h3>Cómo cambia según el horario del apagón</h3>
            <Badge tone="neutral">24 escenarios · 3 h de red</Badge>
          </div>
          <p className="field__hint" style={{ marginTop: 0 }}>
            Cada fila representa un horario posible de suministro. Selecciona uno para consultar su curva de batería en la pestaña Detalle.
          </p>
          <div className="table-scroll" tabIndex={0}>
            <table className="scenario-table">
              <caption className="visually-hidden">Cobertura por hora de retorno de la red</caption>
              <thead><tr><th scope="col">Retorno de la luz</th><th scope="col">Cobertura</th><th scope="col">Sin suministrar</th><th scope="col">De la red</th><th scope="col">Comidas</th></tr></thead>
              <tbody>
                {outcome.scenarios.map((item) => {
                  const highlighted = HIGHLIGHT_SCENARIO_IDS.find((h) => h.id === item.scenarioId);
                  const selected = (focusScenarioId ?? 'rt-09') === item.scenarioId;
                  return (
                    <tr
                      key={item.scenarioId}
                      className={`${highlighted ? 'is-key' : ''} ${selected ? 'is-selected' : ''}`}
                      onClick={() => setFocusScenarioId(item.scenarioId)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setFocusScenarioId(item.scenarioId);
                        }
                      }}
                    >
                      <th scope="row"><span className="mono">{item.label}</span>{highlighted && <span className="field__hint" style={{ display: 'block' }}>{highlighted.why}</span>}</th>
                      <td><span className={`coverage-pill ${item.coverage >= 0.95 ? 'is-good' : item.coverage >= 0.7 ? 'is-mid' : 'is-bad'}`}>{cents(item.coverage)}</span></td>
                      <td>{fmtKwh(item.unservedKwh)}</td>
                      <td>{fmtKwh(item.gridKwh)}</td>
                      <td>
                        {item.cookingMealsUnmet > 0 ? <Badge tone="warning">{item.cookingMealsUnmet} sin cocinar</Badge>
                          : item.cookingMealsSubstituted > 0 ? <Badge tone="solar">{item.cookingMealsSubstituted} con {household.cooking.fuelKind === 'charcoal' ? 'carbón' : household.cooking.fuelKind === 'gas' ? 'gas' : 'alternativo'}</Badge>
                            : <Badge tone="neutral">Eléctrico</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => setResultTab('detail')}>Ver batería del escenario</Button>
            <Button onClick={() => navigate(`/simulacion?id=${system.id}`)}>Reproducir día</Button>
          </div>
        </Panel>
      </div>

      <div className="result-tab-panel stack" hidden={resultTab !== 'detail'}>
        <Panel tone="green">
          <div className="panel__head">
            <h3>Apagón total de 24 horas</h3>
            <Badge tone={outcome.blackout.coverage >= 0.95 ? 'solar' : 'warning'}>{outcome.blackout.coverage >= 0.95 ? 'Aguanta el día' : 'No cubre el día completo'}</Badge>
          </div>
          <p className="result-description">Un sistema que va bien con tres horas de luz al día puede no bastar para un día completo sin red. En este escenario sólo cuentan los paneles y la batería.</p>
          <div className="stat-grid stat-grid--four">
            <Stat value={fmtKwh(outcome.blackout.unservedKwh)} label="Sin suministrar" sub="En 24 h" />
            <Stat value={fmtKwh(outcome.blackout.pvUsedKwh)} label="Aprovechado del sol" />
            <Stat value={fmtKwh(outcome.blackout.batteryDischargeKwh)} label="Sacado de la batería" />
            <Stat tone="demand" value={`${outcome.blackout.cookingMealsUnmet}`} label="Comidas sin cocinar" sub={household.cooking.fuelKind ? `de ${household.activities.filter((a) => a.enabled).length} posibles` : 'sin combustible alternativo'} />
          </div>
          {outcome.blackout.coverage < 0.6 && <Note level="warning" title="Este sistema no aguanta un apagón completo">Habría {fmtKwh(outcome.blackout.unservedKwh)} sin suministrar. Revisa batería, paneles o los equipos marcados como imprescindibles.</Note>}
        </Panel>

        <Panel tone="paper">
          <div className="panel__head"><h3>Comodidad de noche</h3><Badge tone={outcome.nightDeficitKwhWorst > 0 ? 'warning' : 'storage'}>{outcome.nightDeficitKwhWorst > 0 ? 'Con déficit' : 'Cubierta'}</Badge></div>
          <p className="result-description">{nightKwh > 0 ? `Tus equipos esenciales de noche necesitan unos ${fmtKwh(nightKwh)}. La batería reserva esa energía durante el día.` : 'No has marcado equipos esenciales de noche, así que no hay energía reservada para la madrugada.'}</p>
          <div className="stat-grid stat-grid--four">
            <Stat tone="storage" value={nightKwh > 0 ? fmtKwh(nightKwh) : '—'} label="Necesidad nocturna" />
            <Stat tone="demand" value={fmtKwh(outcome.nightDeficitKwhWorst)} label="Déficit en el peor caso" />
            <Stat value={cents(outcome.blackout.coverage)} label="Cobertura en apagón" />
            <Stat value={`${outcome.cookingMealsUnmetWorst}`} label="Comidas sin cocinar" sub="Peor caso" />
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="panel__head"><h3>Cómo va la batería</h3><Badge tone="neutral">{scenarioById(focusScenarioId ?? 'rt-09', system.params).label}</Badge></div>
          {intervals && <><SocChart intervals={intervals.intervals} minSoc={system.params.minSoc + (household.night.essentialIds.length ? 0.01 : 0)} startHour={8} /><BatteryRing soc={intervals.totals.finalSoc} size={92} /><p className="field__hint">Curva del escenario seleccionado en la pestaña Escenarios.</p></>}
        </Panel>

        <Panel tone="paper">
          <div className="panel__head"><h3>Comparar instalaciones de esta vivienda</h3><Badge tone="neutral">{comparisons.length} guardadas</Badge></div>
          {comparisons.length > 1 ? (
            <div className="table-scroll" tabIndex={0}>
              <table className="scenario-table">
                <thead><tr><th scope="col">Instalación</th><th scope="col">Equipo</th><th scope="col">Peor cobertura</th><th scope="col">Apagón 24 h</th><th scope="col"></th></tr></thead>
                <tbody>{comparisons.map((row) => (
                  <tr key={row.inst.id} className={row.inst.id === system.id ? 'is-selected' : ''}>
                    <th scope="row">{row.inst.name}</th>
                    <td>{row.panels} × {panel?.powerW ?? 0} W · {row.kwh} kWh</td>
                    <td><span className="coverage-pill is-mid">{cents(row.outcome!.coverageWorst)}</span></td>
                    <td><span className="coverage-pill is-mid">{cents(row.outcome!.blackout.coverage)}</span></td>
                    <td><button type="button" className="btn btn--quiet" onClick={() => navigate(`/resultado?id=${row.inst.id}`)}>Abrir</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Note level="info">Diseña otra instalación para esta misma vivienda y aquí podrás comparar cuál rinde mejor en el peor caso.</Note>}
          <div className="wizard-actions">
            <Button variant="quiet" icon="plus" onClick={() => navigate(`/instalacion?hogar=${household.id}`)}>Otra instalación</Button>
            <Button icon="doc" onClick={save}>Guardar resultado</Button>
          </div>
        </Panel>
      </div>

      <Toast message={toast} tone="info" />
    </div>
  );
}
