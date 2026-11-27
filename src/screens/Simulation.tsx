import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { resolveInstallation } from '../app/useCalculation';
import { buildEnergySystemConfig, socFloorByInterval } from '../domain/simulator/bridge';
import { simulate } from '../domain/simulator/engine';
import { gridReturnScenarios, scenarioById } from '../domain/simulator/gridScenarios';
import { batteryPack } from '../domain/calculator/battery';
import { Badge, Button, Field, Note, Panel, SectionTitle, Stepper } from '../ui/components';
import { SimulationPlayer } from '../ui/simulation/SimulationPlayer';
import { toEnergyFlowFrames } from '../ui/simulation/energyFlowAdapter';

export function Simulation({
  navigate,
  installationId,
}: {
  navigate: (path: string) => void;
  installationId?: string;
}) {
  const { state } = useApp();
  const active = resolveInstallation(state, installationId);
  const { household, system, panel, battery, inverter } = active;
  const initialSoc = useMemo(
    () => (system && battery ? Math.max(0.30, batteryPack(battery, system.batteryCount, system.params).minSoc) : 0.30),
    [system, battery],
  );
  const [scenarioId, setScenarioId] = useState('rt-14');

  const scenarioOptions = useMemo(
    () => (system ? gridReturnScenarios(system.params) : []),
    [system],
  );
  const scenario = useMemo(
    () => (system ? scenarioById(scenarioId, system.params) : null),
    [scenarioId, system],
  );

  const simulation = useMemo(() => {
    if (!household || !system || !panel || !battery || !inverter || !scenario) return null;
    return simulate(
      buildEnergySystemConfig({
        household,
        system,
        panel,
        battery,
        inverter,
        gridAvailable: scenario.available,
      }),
      {
        cooking: {
          activities: household.activities,
          mode: household.cooking.allowFlexibleTiming ? 'flexible' : 'usual',
          substitution: household.cooking.substitution,
          hasFuel: household.cooking.fuelKind !== null && household.cooking.fuelConfirmed,
        },
        socFloorByInterval: socFloorByInterval(household, system.params, battery, system.batteryCount, inverter),
        startHour: 8,
        startSoc: initialSoc,
      },
    );
  }, [household, system, panel, battery, inverter, scenario, initialSoc]);

  const frames = useMemo(
    () => (simulation && system && scenario
      ? toEnergyFlowFrames(simulation.intervals, system.params.stepMinutes, scenario.available)
      : []),
    [simulation, system, scenario],
  );

  if (active.requestedInstallationMissing) {
    return (
      <div className="stack wizard-page">
        <Stepper step={2} labels={['Sistema', 'Simulación', 'Resultados']} />
        <Panel tone="paper">
          <SectionTitle title="Instalación no encontrada" description="El enlace puede estar desactualizado. No hemos sustituido la instalación solicitada por otra configuración." />
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => navigate('/')}>Volver al inicio</Button>
            <Button onClick={() => navigate('/instalacion')}>Crear una instalación</Button>
          </div>
        </Panel>
      </div>
    );
  }

  if (!household || !system || !panel || !battery || !inverter || active.needsDesign) {
    return (
      <div className="stack wizard-page">
        <Stepper step={2} labels={['Sistema', 'Simulación', 'Resultados']} />
        <Panel tone="paper">
          <SectionTitle title="Todavía no hay una instalación lista" description="Guarda primero una vivienda y configura paneles, batería e inversor para poder reproducir los flujos de energía." />
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => navigate('/hogar')}>Configurar vivienda</Button>
            <Button onClick={() => navigate('/instalacion')}>Configurar sistema</Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="stack wizard-page simulation-screen">
      <Stepper step={2} labels={['Sistema', 'Simulación', 'Resultados']} />
      <SectionTitle
        eyebrow={system.name}
        title="Así trabaja tu instalación"
        description={`La prueba comienza a las 08:00 con un SOC del ${Math.round(initialSoc * 100)} % y recorre 24 horas completas, hasta las 08:00 del día siguiente.`}
      />

      <Panel tone="paper" className="simulation-panel">
        <div className="simulation-panel__head">
          <div>
            <span className="eyebrow">ESCENARIO DE RED</span>
            <h3>{scenario?.label ?? 'Escenario seleccionado'}</h3>
          </div>
          <Badge tone="storage">08:00 → 08:00 · SOC inicial {Math.round(initialSoc * 100)} %</Badge>
        </div>
        <Field label="Explora un horario representativo" htmlFor="simulation-scenario">
          <select id="simulation-scenario" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
            {scenarioOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </Field>
        {frames.length > 0 && (
          <SimulationPlayer frames={frames} autoPlay baseTickMs={800} initialSpeed={4} />
        )}
        <div className="simulation-key">
          <span><i className="simulation-key__dot simulation-key__dot--pv" /> Paneles</span>
          <span><i className="simulation-key__dot simulation-key__dot--grid" /> Red</span>
          <span><i className="simulation-key__dot simulation-key__dot--battery" /> Batería</span>
          <span><i className="simulation-key__dot simulation-key__dot--load" /> Vivienda</span>
        </div>
      </Panel>

      <Note level="info">
        Este reproductor muestra un escenario representativo. Los resultados comparan los 24 horarios de retorno de la red y, por separado, un apagón completo de 24 horas.
      </Note>

      <div className="wizard-actions">
        <Button variant="quiet" onClick={() => navigate(`/instalacion?id=${system.id}`)}>Editar sistema</Button>
        <Button icon="chevron" trailing onClick={() => navigate(`/resultado?id=${system.id}`)}>Ver resultados</Button>
      </div>
    </div>
  );
}
