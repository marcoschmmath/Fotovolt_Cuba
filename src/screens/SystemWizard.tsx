import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { DEFAULT_CUBA_RESIDENTIAL_GRID_LIMIT_W } from '../domain/core/defaults';
import { batteryPack } from '../domain/calculator/battery';
import { analyzeEnergy, peakDesignW } from '../domain/calculator/energy';
import { checkInverterCompatibility, inverterWithParallelUnits } from '../domain/calculator/inverter';
import { checkBalancedArrayConfiguration } from '../domain/calculator/pv';
import { householdForRecommendation } from '../domain/household/recommendationProfile';
import { uid } from '../domain/persistence/storage';
import { systemParams, type SystemConfiguration } from '../domain/system/types';
import type { BatterySpec, DesignParams, InverterSpec, PanelSpec } from '../domain/core/types';
import { ManualEquipmentForm } from './system/ManualEquipmentForm';
import {
  Badge,
  Button,
  Field,
  Note,
  NumberField,
  Panel,
  RangeField,
  SectionTitle,
  Stat,
  Stepper,
  Toast,
  fmtKwh,
  fmtW,
} from '../ui/components';
import { Icon } from '../ui/icons';

/** Workflow B — diseñar (o editar) una instalación para un hogar existente. */
export function SystemWizard({ navigate, installationId, initialHouseholdId }: { navigate: (path: string) => void; installationId?: string; initialHouseholdId?: string }) {
  const { state, patch } = useApp();
  const households = state.households;
  const editing = installationId ? state.installations.find((i) => i.id === installationId) : undefined;
  // Sólo reutilizamos una instalación cuando llega un id explícito para editar.
  // Entrar con `?hogar=...` siempre significa crear una instalación nueva.
  const activeInstallation = editing;

  const [householdId, setHouseholdId] = useState(
    editing?.householdProfileId ?? initialHouseholdId ?? state.activeHouseholdId ?? households[0]?.id ?? '',
  );
  const [draft, setDraft] = useState<SystemConfiguration>(
    () =>
      activeInstallation ?? {
        id: uid('inst'),
        householdProfileId: editing?.householdProfileId ?? initialHouseholdId ?? state.activeHouseholdId ?? households[0]?.id ?? '',
        name: 'Instalación principal',
        panelId: state.panels[0]?.id ?? '',
        panelCount: 0,
        batteryId: state.batteries[0]?.id ?? '',
        batteryCount: 1,
        inverterId: state.inverters[0]?.id ?? '',
        inverterCount: 1,
        installationType: 'hybrid',
        params: systemParams(),
        origin: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
  );
  const [advanced, setAdvanced] = useState(false);
  const [manualKind, setManualKind] = useState<'panels' | 'batteries' | 'inverters' | null>(null);
  const [saved, setSaved] = useState('');

  const household = households.find((h) => h.id === householdId) ?? null;
  const panel = state.panels.find((p) => p.id === draft.panelId) ?? null;
  const battery = state.batteries.find((b) => b.id === draft.batteryId) ?? null;
  const inverter = state.inverters.find((i) => i.id === draft.inverterId) ?? null;
  const forHousehold = useMemo(() => state.installations.filter((i) => i.householdProfileId === householdId), [state.installations, householdId]);

  if (installationId && !editing) {
    return (
      <div className="stack wizard-page">
        <Panel tone="paper">
          <SectionTitle
            title="Instalación no encontrada"
            description="El enlace apunta a una instalación que ya no existe. No hemos abierto ni modificado otra configuración guardada."
          />
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => navigate('/')}>Volver al inicio</Button>
            <Button
              icon="plus"
              onClick={() => {
                const targetHouseholdId = householdId || state.activeHouseholdId || households[0]?.id;
                navigate(targetHouseholdId ? `/instalacion?hogar=${targetHouseholdId}` : '/hogar');
              }}
            >
              Crear otra instalación
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  if (!household) {
    return (
      <Panel tone="paper">
        <SectionTitle
          title="Primero configura una vivienda"
          description="La instalación se evalúa siempre contra el consumo real de una vivienda guardada."
        />
        <div className="wizard-actions">
          <Button variant="quiet" onClick={() => navigate('/')}>Volver al inicio</Button>
          <Button icon="house" onClick={() => navigate('/hogar')}>Configurar mi vivienda</Button>
        </div>
      </Panel>
    );
  }

  const installedW = (panel?.powerW ?? 0) * draft.panelCount;
  const pack = battery ? batteryPack(battery, draft.batteryCount, draft.params) : null;
  const bankKwh = pack?.nominalKwh ?? 0;
  const arrayCheck = panel && inverter && draft.panelCount > 0
    ? checkBalancedArrayConfiguration(panel, inverter, draft.panelCount, draft.params)
    : null;
  const designHousehold = draft.recommendationTier
    ? householdForRecommendation(household, draft.recommendationTier)
    : household;
  const householdDemand = analyzeEnergy(designHousehold.appliances, draft.params);
  const effectiveInverter = inverter ? inverterWithParallelUnits(inverter, draft.inverterCount ?? 1) : null;
  const technicalCheck = panel && battery && inverter && draft.panelCount > 0 && draft.batteryCount > 0
    ? checkInverterCompatibility({
        inverter: effectiveInverter!, battery, panel, panelCount: draft.panelCount, batteryCount: draft.batteryCount,
        continuousW: householdDemand.peakSimultaneousW,
        peakW: peakDesignW(householdDemand),
        voltage: household.voltage, params: draft.params,
      })
    : null;
  const gridChargerW = (inverter?.gridChargerW ?? 0) * (draft.inverterCount ?? 1);
  const basicDataReady = Boolean(
    panel && panel.powerW > 0 && battery && battery.nominalKwh > 0 && battery.nominalV > 0 &&
    inverter && inverter.ratedW > 0 && inverter.maxPvInputW > 0 && inverter.batteryVoltageV > 0
  );

  function addManualEquipment(kind: 'panels' | 'batteries' | 'inverters', equipment: PanelSpec | BatterySpec | InverterSpec) {
    if (kind === 'panels') {
      patch({ panels: [...state.panels, equipment as PanelSpec] });
      setDraft((current) => ({ ...current, panelId: equipment.id }));
    } else if (kind === 'batteries') {
      patch({ batteries: [...state.batteries, equipment as BatterySpec] });
      setDraft((current) => ({ ...current, batteryId: equipment.id }));
    } else {
      patch({ inverters: [...state.inverters, equipment as InverterSpec] });
      setDraft((current) => ({ ...current, inverterId: equipment.id }));
    }
    setManualKind(null);
  }

  function setParams(change: Partial<DesignParams>) {
    setDraft((current) => ({ ...current, params: { ...current.params, ...change } }));
  }

  function save() {
    const now = new Date().toISOString();
    const record: SystemConfiguration = {
      ...draft,
      id: draft.id || uid('inst'),
      householdProfileId: householdId,
      updatedAt: now,
    };
    patch((current) => ({
      installations: current.installations.some((i) => i.id === record.id)
        ? current.installations.map((i) => (i.id === record.id ? record : i))
        : [...current.installations, record],
      activeHouseholdId: householdId,
      activeInstallationId: record.id,
    }));
    setSaved('Instalación guardada. Preparando la simulación…');
    window.setTimeout(() => navigate(`/simulacion?id=${record.id}`), 500);
  }

  return (
    <div className="stack wizard-page system-wizard">
      <Stepper step={1} labels={['Sistema', 'Simulación', 'Resultados']} />
      <SectionTitle
        eyebrow="Instalación"
        title="Diseña tu sistema solar"
        description={`Se evaluará contra el consumo de «${household.name}». Puedes cambiar de vivienda sin perder esta configuración.`}
      />

      <Panel tone="green" className="system-data-guide">
        <div className="panel__head"><h3>¿Qué datos necesitas?</h3><Badge tone="solar">Sólo lo básico</Badge></div>
        <p><strong>Datos necesarios para simular:</strong></p>
        <ul className="system-data-guide__list">
          <li><strong>Paneles:</strong> potencia nominal en W.</li>
          <li><strong>Batería:</strong> capacidad nominal en kWh y tensión nominal en V.</li>
          <li><strong>Inversor:</strong> potencia continua en W, potencia fotovoltaica máxima admitida en W y tensión del banco de baterías en V.</li>
        </ul>
        <p><strong>Datos técnicos opcionales:</strong> Voc/Vmp, corrientes, límites MPPT, eficiencia, potencia de arranque, DoD y límites de carga/descarga. Puedes dejarlos vacíos si el vendedor no los facilita.</p>
        <p className="field__hint">SolarAPP seguirá con la simulación energética usando hipótesis explícitas donde sea razonable. Las comprobaciones que necesiten datos desconocidos aparecerán como pendientes: no se inventarán límites eléctricos ni se presentará una estimación como ficha verificada.</p>
        <div className="row row--wrap" style={{ marginTop: '.55rem' }}>
          <Button variant="outline" onClick={() => navigate('/catalogo')}>Ver catálogo de equipos</Button>
          <Button variant="quiet" onClick={() => navigate('/contacto')}>Contactar al instalador</Button>
        </div>
      </Panel>

      <Panel tone="paper" className="system-config-panel">
        <Field label="Vivienda" htmlFor="system-household" hint="Los hábitos y equipos vienen de aquí.">
          <select
            id="system-household"
            value={householdId}
            onChange={(event) => {
              setHouseholdId(event.target.value);
              setDraft((current) => ({ ...current, householdProfileId: event.target.value }));
            }}
          >
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.appliances.length} equipos
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nombre de esta instalación" htmlFor="system-name">
          <input
            id="system-name"
            className="text-field"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Ej.: Mi casa / 10 kWh"
          />
        </Field>
        <p className="field__hint">
          {forHousehold.length > 0
            ? `Esta vivienda ya tiene ${forHousehold.length} ${forHousehold.length === 1 ? 'instalación guardada' : 'instalaciones guardadas'}. Puedes compararlas todas.`
            : 'Será la primera instalación de esta vivienda.'}
        </p>
      </Panel>

      <Panel tone="paper">
        <div className="panel__head">
          <h3>Equipos</h3>
          <Badge tone="neutral">Del catálogo</Badge>
        </div>
        <Field label="Panel fotovoltaico" htmlFor="system-panel">
          <select id="system-panel" value={draft.panelId} onChange={(event) => setDraft({ ...draft, panelId: event.target.value })}>
            {state.panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.model || p.brand} · {p.powerW} W
              </option>
            ))}
          </select>
        </Field>
        <NumberField label="Cantidad de paneles" value={draft.panelCount} min={0} max={200} step={1} onChange={(v) => setDraft({ ...draft, panelCount: Math.round(v) })} />
        <div className="row row--wrap" style={{ marginTop: '.45rem' }}>
          <Button variant="outline" icon="plus" onClick={() => setManualKind('panels')}>Añadir panel no listado</Button>
        </div>

        <div className="divider" />

        <Field label="Batería" htmlFor="system-battery">
          <select id="system-battery" value={draft.batteryId} onChange={(event) => setDraft({ ...draft, batteryId: event.target.value })}>
            {state.batteries.map((b) => (
              <option key={b.id} value={b.id}>
                {b.model || b.brand} · {b.nominalKwh} kWh
              </option>
            ))}
          </select>
        </Field>
        <NumberField label="Cantidad de baterías" value={draft.batteryCount} min={0} max={100} step={1} hint="SolarAPP supone baterías iguales conectadas en paralelo y con la misma tensión de banco. No calcula conexiones en serie para elevar la tensión." onChange={(v) => setDraft({ ...draft, batteryCount: Math.round(v) })} />
        <div className="row row--wrap" style={{ marginTop: '.45rem' }}>
          <Button variant="outline" icon="plus" onClick={() => setManualKind('batteries')}>Añadir batería no listada</Button>
        </div>

        <div className="divider" />

        <Field label="Inversor" htmlFor="system-inverter">
          <select id="system-inverter" value={draft.inverterId} onChange={(event) => { const selected = state.inverters.find((item) => item.id === event.target.value); setDraft({ ...draft, inverterId: event.target.value, inverterCount: Math.min(draft.inverterCount ?? 1, selected?.maxParallelUnits ?? 1) }); }}>
            {state.inverters.map((i) => (
              <option key={i.id} value={i.id}>
                {i.model || i.brand} · {i.ratedW} W
              </option>
            ))}
          </select>
        </Field>
        <NumberField label="Unidades de inversor en paralelo" value={draft.inverterCount ?? 1} min={1} max={inverter?.maxParallelUnits ?? 1} step={1} hint={inverter?.maxParallelUnits ? `Este modelo admite hasta ${inverter.maxParallelUnits} unidades en paralelo según su ficha.` : 'El catálogo no declara funcionamiento en paralelo para este modelo; se limita a una unidad.'} onChange={(v) => setDraft({ ...draft, inverterCount: Math.max(1, Math.min(inverter?.maxParallelUnits ?? 1, Math.round(v))) })} />
        <p className="field__hint">
          {gridChargerW > 0
            ? `Este inversor declara cargador AC de ${gridChargerW} W: podrá cargar la batería desde la red.`
            : 'No se ha declarado la potencia del cargador AC; por prudencia, la simulación no contará con recarga de batería desde la red.'}
        </p>
        {inverter && inverter.acVoltages.length === 0 && (
          <Note level="info">No se conoce si este inversor admite la tensión de salida de la vivienda. La simulación energética puede continuar, pero la salida AC queda sin verificar.</Note>
        )}
        <div className="row row--wrap" style={{ marginTop: '.45rem' }}>
          <Button variant="outline" icon="plus" onClick={() => setManualKind('inverters')}>Añadir inversor no listado</Button>
        </div>
      </Panel>

      {manualKind && (
        <ManualEquipmentForm
          kind={manualKind}
          onCancel={() => setManualKind(null)}
          onSave={(equipment) => addManualEquipment(manualKind, equipment)}
        />
      )}

      <Panel tone="dark">
        <div className="panel__head"><h3>Resumen de la instalación</h3></div>
        <div className="stat-grid stat-grid--four">
          <Stat tone="solar" value={fmtW(installedW)} label="Paneles conectados" sub={`${draft.panelCount} × ${panel?.powerW ?? 0} W`} />
          <Stat tone="storage" value={fmtKwh(bankKwh)} label="Batería instalada" sub={`${draft.batteryCount} × ${battery?.nominalKwh ?? 0} kWh`} />
          <Stat value={inverter ? fmtW(inverter.ratedW) : '—'} label="Inversor" sub={inverter?.gridChargerW ? 'Carga desde red' : 'Sólo solar'} />
          <Stat value={pack ? `${Math.round(pack.usableKwh * 10) / 10} kWh` : '—'} label="Energía utilizable" sub="Según DoD y SOC mínimo" />
        </div>
        {technicalCheck && technicalCheck.status !== 'verified' && (
          <Note
            level={technicalCheck.status === 'incompatible' ? 'error' : 'warning'}
            title={technicalCheck.status === 'incompatible' ? 'Se detectó una incompatibilidad técnica' : 'Verificación técnica parcial'}
          >
            <ul className="diagnostic-list">
              {technicalCheck.diagnostics.filter((diagnostic) => !['INV_SURGE_OK', 'MPPT_OK', 'PV_STRINGS_UNVERIFIED', 'MPPT', 'PV_INPUT'].includes(diagnostic.code) && (diagnostic.level !== 'info' || !['INV_SURGE_OK', 'MPPT_OK'].includes(diagnostic.code))).map((diagnostic) => (
                <li key={diagnostic.code}>{diagnostic.message}</li>
              ))}
            </ul>
            La simulación energética puede continuar; este aviso indica qué aspectos deben confirmarse antes de instalar.
          </Note>
        )}
        {arrayCheck && (
          <Note level={arrayCheck.status === 'insufficient' ? 'info' : !arrayCheck.feasible ? 'warning' : arrayCheck.notes.some((note) => note.includes('hipótesis')) ? 'warning' : 'success'} title="Comprobación automática del campo fotovoltaico">
            {arrayCheck.status === 'insufficient'
              ? `${arrayCheck.violations[0] ?? 'Faltan datos eléctricos de panel o MPPT.'} La simulación energética puede continuar; la distribución física de los paneles deberá comprobarla un instalador.`
              : arrayCheck.feasible
                ? 'Existe al menos una distribución eléctricamente compatible con los datos disponibles. SolarAPP mantiene el mismo número de módulos en cada string y reparte los strings de forma equilibrada entre las entradas MPPT utilizables. No tienes que configurar el cableado.'
                : `${arrayCheck.violations.join(' ')} No se ha encontrado una distribución compatible con los datos declarados.`}
            {arrayCheck.notes.some((note) => note.includes('hipótesis')) && <p className="field__hint">{arrayCheck.notes[arrayCheck.notes.length - 1]}</p>}
          </Note>
        )}
        {!basicDataReady && <Note level="warning">Faltan datos básicos de uno o más equipos. Revisa el catálogo o añade aquí el modelo para poder simularlo.</Note>}
      </Panel>

      <Panel tone="paper">
        <button type="button" className="row row--between" style={{ width: '100%', border: 0, background: 'none', padding: 0, color: 'inherit' }} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          <span>
            <strong>Hipótesis de cálculo</strong>
            <span className="field__hint" style={{ display: 'block' }}>Sol, eficiencias, DoD y límite de importación.</span>
          </span>
          <Icon name="settings" size={18} />
        </button>
        {advanced && (
          <div style={{ marginTop: '.8rem' }}>
            <RangeField label="Horas solares pico (HSP)" value={draft.params.hsp} min={2} max={7} step={0.1} display={`${draft.params.hsp.toFixed(1)} h`} hint="Hipótesis de irradiación, no dato medido de tu localidad." onChange={(v) => setParams({ hsp: v })} />
            <RangeField label="Eficiencia global del sistema" value={draft.params.systemEfficiency} min={0.65} max={0.95} step={0.01} display={`${Math.round(draft.params.systemEfficiency * 100)} %`} onChange={(v) => setParams({ systemEfficiency: v })} />
            <RangeField label="Profundidad de descarga (DoD)" value={draft.params.dod} min={0.4} max={1} step={0.05} display={`${Math.round(draft.params.dod * 100)} %`} onChange={(v) => setParams({ dod: v })} />
            <div className="selected-item__grid">
              <NumberField label="Temperatura ambiente" value={draft.params.ambientC} min={-10} max={50} unit="°C" onChange={(v) => setParams({ ambientC: v })} />
              <NumberField label="Sombras y suciedad" value={draft.params.shading} min={0} max={0.4} step={0.01} onChange={(v) => setParams({ shading: v })} />
              <NumberField label="SOC mínimo de la batería" value={draft.params.minSoc} min={0} max={0.5} step={0.05} onChange={(v) => setParams({ minSoc: v })} />
              <RangeField label="Eficiencia del inversor" value={draft.params.inverterEfficiency} min={0.7} max={0.98} step={0.01} display={`${Math.round(draft.params.inverterEfficiency * 100)} %`} onChange={(v) => setParams({ inverterEfficiency: v })} />
            </div>
            <NumberField
              label="Límite de importación de la vivienda (avanzado)"
              value={draft.params.gridMaxPowerW}
              min={500}
              max={20000}
              step={250}
              unit="W"
              hint={`Sólo para instaladores: valor provisional por defecto ${DEFAULT_CUBA_RESIDENTIAL_GRID_LIMIT_W} W. No es una norma oficial.`}
              onChange={(v) => setParams({ gridMaxPowerW: v })}
            />
            <Button variant="quiet" full onClick={() => setParams({ ...systemParams() })}>Restablecer hipótesis</Button>
          </div>
        )}
      </Panel>

      <Panel tone="paper" className="installer-help-panel">
        <h3>¿No estás seguro de qué poner?</h3>
        <p>Si no conoces algún dato, no lo adivines. Puedes dejar vacíos los detalles opcionales. Si tienes dudas sobre la potencia, la tensión del banco o la conexión eléctrica, contacta con un instalador profesional antes de comprar o conectar los equipos.</p>
        <Button variant="dark" onClick={() => navigate('/contacto')}>Ver información de contacto del instalador</Button>
      </Panel>

      <div className="wizard-actions">
        <Button variant="quiet" onClick={() => navigate('/')}>Cancelar</Button>
        <Button icon="check" onClick={save} disabled={draft.panelCount < 1 || draft.batteryCount < 1 || !basicDataReady}>
          Simular esta instalación
        </Button>
      </div>
      {(draft.panelCount < 1 || draft.batteryCount < 1) && (
        <Note level="info">Indica al menos un panel y una batería para poder simular la instalación.</Note>
      )}

      <Toast message={saved} tone="info" />
    </div>
  );
}