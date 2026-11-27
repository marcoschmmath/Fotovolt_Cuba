import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { useOfferEvaluation } from '../app/useCalculation';
import { buildOfferSpecs, checkOfferCompatibility, offerToSystem, type OfferEquipmentForm } from '../domain/simulator/offerReport';
import { systemParams } from '../domain/system/types';
import { uid } from '../domain/persistence/storage';
import { analyzeEnergy } from '../domain/calculator/energy';
import { Badge, Button, Field, Note, NumberField, Panel, SectionTitle, Stat, Toast, fmtKwh, fmtW } from '../ui/components';
import { Icon } from '../ui/icons';

const emptyForm: OfferEquipmentForm = {
  panelCount: 8,
  panelW: 550,
  panelVocV: 0,
  panelVmppV: 0,
  panelIscA: 0,
  panelImppA: 0,
  panelTempCoeffVoc: -0.0028,
  panelTempCoeffPmpp: -0.0035,
  panelNoct: 45,
  batteryCount: 2,
  batteryKwhEach: 5,
  batteryV: 51.2,
  batteryCapacityAh: 0,
  batteryMaxDischargeW: 0,
  batteryMaxChargeW: 0,
  batteryDod: 0.8,
  batteryChargeEff: 0.95,
  batteryDischargeEff: 0.95,
  inverterRatedW: 5000,
  inverterSurgeW: 10000,
  inverterMaxPvInputW: 8000,
  inverterEfficiency: 0.92,
  inverterMaxChargeA: 0,
  inverterMaxDischargeA: 0,
  inverterBatteryVoltageV: 48,
  inverterGridChargerW: 0,
  mpptMaxV: 0,
  mpptMinV: 0,
  mpptMaxA: 0,
  mpptMaxW: 0,
};

/**
 * Comprobador de ofertas integrado: se elige una vivienda guardada, se
 * introduce lo que el vendedor oferta y UNA sola acción ejecuta las
 * comprobaciones técnicas y la simulación completa.
 */
export function OfferCheck({ navigate }: { navigate: (path: string) => void }) {
  const { state, patch } = useApp();
  const [householdId, setHouseholdId] = useState(state.activeHouseholdId || state.households[0]?.id || '');
  const [form, setForm] = useState<OfferEquipmentForm>(emptyForm);
  const [technical, setTechnical] = useState(false);
  const [run, setRun] = useState(false);
  const [toast, setToast] = useState('');

  const household = state.households.find((h) => h.id === householdId) ?? null;
  const specs = useMemo(() => buildOfferSpecs(form), [form]);
  const system = useMemo(
    () => offerToSystem(form, householdId, `Oferta: ${form.panelCount}×${form.panelW} W`, systemParams()),
    [form, householdId],
  );
  const evaluation = useOfferEvaluation(state, household, system, specs.panel, specs.battery, specs.inverter);
  const report = useMemo(
    () => (household ? checkOfferCompatibility({ household, form, ...specs }) : null),
    [household, form, specs],
  );

  const set = (key: keyof OfferEquipmentForm, value: number) => {
    setForm((current) => ({ ...current, [key]: value }));
    setRun(false);
  };

  const energy = household ? analyzeEnergy(household.appliances, systemParams()) : null;
  const usual = evaluation?.behaviors.usual ?? null;
  const flexible = evaluation?.behaviors.flexible ?? null;

  function saveAsInstallation() {
    if (!household) return;
    const specs2 = buildOfferSpecs(form);
    const record = {
      ...offerToSystem(form, household.id, `Oferta: ${form.panelCount}×${form.panelW} W`, systemParams()),
      id: uid('inst'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    patch((current) => {
      const panels = current.panels.some((p) => p.id === specs2.panel.id)
        ? current.panels
        : [...current.panels, specs2.panel];
      const batteries = current.batteries.some((b) => b.id === specs2.battery.id)
        ? current.batteries
        : [...current.batteries, specs2.battery];
      const inverters = current.inverters.some((i) => i.id === specs2.inverter.id)
        ? current.inverters
        : [...current.inverters, specs2.inverter];
      return {
        panels,
        batteries,
        inverters,
        installations: [...current.installations, record],
        activeHouseholdId: household.id,
        activeInstallationId: record.id,
      };
    });
    setToast('Oferta guardada como instalación de esta vivienda. Ya puedes compararla.');
  }

  if (!household) {
    return (
      <Panel tone="paper">
        <SectionTitle
          eyebrow="Oferta"
          title="Primero necesito tu vivienda"
          description="Para decirte si un sistema ofertado sirve en tu casa necesito saber qué equipos usas y cómo cocinas."
        />
        <div className="wizard-actions">
          <Button variant="quiet" onClick={() => navigate('/')}>Volver al inicio</Button>
          <Button icon="house" onClick={() => navigate('/hogar')}>Configurar mi vivienda</Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="stack">
      <SectionTitle
        eyebrow="Oferta"
        title="Comprueba una oferta en tu vivienda"
        description="Introduce lo que te ofrecen y lo simulamos contra tu consumo real: mismas 24 horas de retorno, mismo apagón total, mismas reglas."
      />

      <Panel tone="paper">
        <Field label="Vivienda" htmlFor="offer-household">
          <select
            id="offer-household"
            value={householdId}
            onChange={(event) => {
              setHouseholdId(event.target.value);
              setRun(false);
            }}
          >
            {state.households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.appliances.length} equipos
              </option>
            ))}
          </select>
        </Field>
        <p className="field__hint">
          {energy
            ? `Consumo declarado: ${fmtKwh(energy.dailyKwh)} al día · ${fmtKwh(energy.nightKwh)} de noche · potencia simultánea ${fmtW(energy.peakSimultaneousW)}.`
            : 'Esta vivienda no tiene equipos: añádelos antes de evaluar una oferta.'}
        </p>
        {!household.cooking.fuelKind && (
          <Note level="info">Esta vivienda no tiene combustible alternativo: si la cocción eléctrica falla, la comida quedará sin prepararse.</Note>
        )}
      </Panel>

      <Panel tone="paper">
        <div className="panel__head"><h3>Equipo que te ofrecen</h3></div>
        <div className="selected-item__grid">
          <NumberField label="Cantidad de paneles" value={form.panelCount} min={0} max={200} step={1} onChange={(v) => set('panelCount', Math.round(v))} />
          <NumberField label="Potencia por panel" value={form.panelW} min={0} max={2000} step={10} unit="W" onChange={(v) => set('panelW', v)} />
          <NumberField label="Cantidad de baterías" value={form.batteryCount} min={0} max={50} step={1} onChange={(v) => set('batteryCount', Math.round(v))} />
          <NumberField label="Capacidad por batería" value={form.batteryKwhEach} min={0.1} max={50} step={0.1} unit="kWh" onChange={(v) => set('batteryKwhEach', v)} />
        </div>
        <div className="selected-item__grid" style={{ marginTop: '.5rem' }}>
          <NumberField label="Potencia continua del inversor" value={form.inverterRatedW} min={1} max={30000} step={100} unit="W" onChange={(v) => set('inverterRatedW', v)} />
          <NumberField label="Potencia de arranque" value={form.inverterSurgeW} min={1} max={30000} step={100} unit="W" onChange={(v) => set('inverterSurgeW', v)} />
          <NumberField label="Tensión del banco" value={form.batteryV} min={1} max={1000} step={0.1} unit="V" onChange={(v) => set('batteryV', v)} />
          <NumberField label="Profundidad de descarga" value={form.batteryDod} min={0.05} max={1} step={0.05} onChange={(v) => set('batteryDod', v)} />
        </div>
        <p className="field__hint">
          Lo que dejes en 0 se considera NO DECLARADO: la simulación avanza con hipótesis, pero esas comprobaciones quedan sin verificar. No las inventamos.
        </p>
      </Panel>

      <Panel tone="paper">
        <button
          type="button"
          className="row row--between"
          style={{ width: '100%', border: 0, background: 'none', padding: 0, color: 'inherit' }}
          onClick={() => setTechnical(!technical)}
          aria-expanded={technical}
        >
          <span>
            <strong>Datos técnicos (opcional)</strong>
            <span className="field__hint" style={{ display: 'block' }}>Voc, Vmp, Isc, MPPT, límites de la batería y cargador AC.</span>
          </span>
          <Icon name="settings" size={18} />
        </button>
        {technical && (
          <div style={{ marginTop: '.8rem' }}>
            <div className="selected-item__grid">
              <NumberField label="Voc del panel" value={form.panelVocV} min={0} max={200} step={0.1} unit="V" onChange={(v) => set('panelVocV', v)} />
              <NumberField label="Vmp del panel" value={form.panelVmppV} min={0} max={200} step={0.1} unit="V" onChange={(v) => set('panelVmppV', v)} />
              <NumberField label="Isc del panel" value={form.panelIscA} min={0} max={50} step={0.1} unit="A" onChange={(v) => set('panelIscA', v)} />
              <NumberField label="NOCT" value={form.panelNoct} min={20} max={80} unit="°C" onChange={(v) => set('panelNoct', v)} />
            </div>
            <div className="selected-item__grid" style={{ marginTop: '.5rem' }}>
              <NumberField label="MPPT tensión máxima" value={form.mpptMaxV} min={0} max={2000} unit="V" onChange={(v) => set('mpptMaxV', v)} />
              <NumberField label="MPPT tensión mínima" value={form.mpptMinV} min={0} max={2000} unit="V" onChange={(v) => set('mpptMinV', v)} />
              <NumberField label="MPPT corriente máxima" value={form.mpptMaxA} min={0} max={100} unit="A" onChange={(v) => set('mpptMaxA', v)} />
              <NumberField label="MPPT potencia máxima" value={form.mpptMaxW} min={0} max={100000} step={100} unit="W" onChange={(v) => set('mpptMaxW', v)} />
            </div>
            <div className="selected-item__grid" style={{ marginTop: '.5rem' }}>
              <NumberField label="Descarga máxima de batería" value={form.batteryMaxDischargeW} min={0} max={100000} step={100} unit="W" onChange={(v) => set('batteryMaxDischargeW', v)} />
              <NumberField label="Carga máxima de batería" value={form.batteryMaxChargeW} min={0} max={100000} step={100} unit="W" onChange={(v) => set('batteryMaxChargeW', v)} />
              <NumberField label="Corriente de descarga del BMS" value={form.inverterMaxDischargeA} min={0} max={500} unit="A" onChange={(v) => set('inverterMaxDischargeA', v)} />
              <NumberField label="Cargador AC (red → batería)" value={form.inverterGridChargerW} min={0} max={20000} step={100} unit="W" hint="0 = el inversor no carga desde la red" onChange={(v) => set('inverterGridChargerW', v)} />
            </div>
          </div>
        )}
      </Panel>

      <div className="wizard-actions">
        <Button icon="bolt" full onClick={() => { setRun(true); setToast(''); }}>
          Simular esta oferta en mi vivienda
        </Button>
      </div>
      <p className="field__hint">
        Una sola acción ejecuta las comprobaciones técnicas y la simulación completa (24 horas de retorno + apagón total + cocina). Si cambias un dato, el resultado se recalcula al instante.
      </p>

      {run && report && (
        <Panel tone="dark">
          <div className="panel__head">
            <h3>Comprobaciones técnicas</h3>
            <Badge tone={report.verified ? 'solar' : 'warning'}>
              {report.verified ? 'Verificado' : 'Sin verificar'}
            </Badge>
          </div>
          {report.verified ? (
            <p style={{ fontSize: '.86rem' }}>
              Todos los datos imprescindibles están declarados: la conexión de los paneles y la compatibilidad eléctrica se han podido comprobar.
            </p>
          ) : (
            <Note level="warning" title="Faltan datos para verificar">
              La oferta no declara: {report.missing.join(', ')}. La simulación energética se completa con hipótesis declaradas, pero esas comprobaciones quedan SIN VERIFICAR.
            </Note>
          )}
          <div className="stack" style={{ gap: '.5rem', marginTop: '.6rem' }}>
            {report.diagnostics.map((d, index) => (
              <Note key={`${d.code}-${index}`} level={d.level === 'error' ? 'error' : d.level === 'warning' ? 'warning' : 'info'}>
                {d.message}
              </Note>
            ))}
          </div>
        </Panel>
      )}

      {run && usual && flexible && (
        <Panel tone="dark">
          <div className="panel__head"><h3>Así se comportaría en tu vivienda</h3></div>
          <div className="stat-grid stat-grid--four">
            <Stat tone="solar" value={`${Math.round(usual.coverageMedian * 100)} %`} label="Cobertura típica" sub="Mediana de 24 casos" />
            <Stat tone="demand" value={`${Math.round(usual.coverageWorst * 100)} %`} label="Peor hora de retorno" sub="Un apagón de 3 h" />
            <Stat tone="storage" value={`${Math.round(usual.blackout.coverage * 100)} %`} label="Apagón total 24 h" sub="Solo paneles y batería" />
            <Stat tone="demand" value={fmtKwh(usual.unservedKwhWorst)} label="Sin suministrar" sub="Peor caso" />
          </div>
          <div className="table-scroll" tabIndex={0}>
            <table className="scenario-table">
              <caption className="visually-hidden">Comparación de comportamientos de cocina</caption>
              <thead>
                <tr>
                  <th scope="col">Comportamiento</th>
                  <th scope="col">Cobertura típica</th>
                  <th scope="col">Peor caso</th>
                  <th scope="col">Apagón 24 h</th>
                  <th scope="col">Comidas sin cocinar</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Cocina habitual</th>
                  <td>{Math.round(usual.coverageMedian * 100)} %</td>
                  <td>{Math.round(usual.coverageWorst * 100)} %</td>
                  <td>{Math.round(usual.blackout.coverage * 100)} %</td>
                  <td>{usual.cookingMealsUnmetWorst}</td>
                </tr>
                <tr>
                  <th scope="row">Cocina flexible</th>
                  <td>{Math.round(flexible.coverageMedian * 100)} %</td>
                  <td>{Math.round(flexible.coverageWorst * 100)} %</td>
                  <td>{Math.round(flexible.blackout.coverage * 100)} %</td>
                  <td>{flexible.cookingMealsUnmetWorst}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {usual.blackout.cookingMealsSubstituted > 0 && (
            <Note level="success" title="Cocina cubierta con combustible alternativo">
              En algunas situaciones se usaría carbón o gas: {fmtKwh(usual.blackout.cookingEnergyAvoidedKwh)} de demanda eléctrica evitada en el apagón total.
            </Note>
          )}
          <div className="wizard-actions">
            <Button variant="quiet" icon="layers" onClick={saveAsInstallation}>Guardar como instalación</Button>
            <Button icon="check" onClick={() => navigate('/resultado')}>Abrir el resultado completo</Button>
          </div>
        </Panel>
      )}

      <Toast message={toast} tone="info" />
    </div>
  );
}