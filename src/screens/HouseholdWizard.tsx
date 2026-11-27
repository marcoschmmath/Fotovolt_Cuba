import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { DEFAULT_PARAMS } from '../domain/core/defaults';
import { APPLIANCE_TEMPLATES, templateToAppliance } from '../domain/catalog/appliances';
import { analyzeEnergy } from '../domain/calculator/energy';
import type { HouseholdProfile } from '../domain/household/types';
import { DEFAULT_COOKING, defaultCookingActivities, COOKING_FUEL_LABELS } from '../domain/household/types';
import { nightEssentialKwh } from '../domain/simulator/bridge';
import { uid } from '../domain/persistence/storage';
import { Badge, Button, Field, Panel, SectionTitle, Stat, Stepper, Toast, fmtKwh, fmtW } from '../ui/components';
import { StepAppliances } from './wizard/StepAppliances';
import { StepHabits } from './wizard/StepHabits';

const LABELS = ['Equipos', 'Hábitos', 'Resumen'];

/** Carga doméstica habitual que se añade como estimación editable en hogares nuevos. */
function defaultHouseholdAppliances(): HouseholdProfile['appliances'] {
  const mobileCharging = APPLIANCE_TEMPLATES.find((item) => item.name === 'Carga de teléfonos móviles');
  return mobileCharging ? [templateToAppliance(mobileCharging, uid('app'))] : [];
}

/** Workflow A — vivienda independiente de cualquier instalación fotovoltaica. */
export function HouseholdWizard({
  navigate,
  householdId,
  initialStep,
}: {
  navigate: (path: string) => void;
  householdId?: string;
  initialStep?: number;
}) {
  const { state, patch } = useApp();
  const existing = householdId ? state.households.find((h) => h.id === householdId) : null;
  const [draft, setDraft] = useState<HouseholdProfile>(
    () =>
      existing ?? {
        id: uid('hogar'),
        name: 'Mi vivienda',
        appliances: defaultHouseholdAppliances(),
        cooking: { ...DEFAULT_COOKING },
        activities: defaultCookingActivities(),
        night: { essentialIds: [] },
        voltage: 'both',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
  );
  const [step, setStep] = useState(() => Math.min(Math.max(initialStep ?? 1, 1), LABELS.length));
  const [saved, setSaved] = useState('');
  const params = useMemo(() => state.installations[0]?.params ?? { ...DEFAULT_PARAMS }, [state.installations]);
  const energy = useMemo(() => analyzeEnergy(draft.appliances, params), [draft.appliances, params]);
  const nightKwh = useMemo(() => nightEssentialKwh(draft, params), [draft, params]);
  const isEditing = Boolean(existing);

  function save(openRecommendations = false) {
    const now = new Date().toISOString();
    const record: HouseholdProfile = {
      ...draft,
      name: draft.name.trim() || 'Mi vivienda',
      id: draft.id || uid('hogar'),
      updatedAt: now,
      createdAt: draft.createdAt ?? now,
    };
    patch((current) => {
      const exists = current.households.some((h) => h.id === record.id);
      return {
        households: exists ? current.households.map((h) => (h.id === record.id ? record : h)) : [...current.households, record],
        activeHouseholdId: record.id,
      };
    });
    setSaved(isEditing ? 'Vivienda actualizada.' : 'Vivienda guardada. Ya puedes añadir un sistema solar.');
    window.setTimeout(
      () => navigate(openRecommendations ? `/recomendaciones?hogar=${record.id}` : '/'),
      850,
    );
  }

  return (
    <div className="stack wizard-page household-wizard">
      <Stepper step={step} labels={LABELS} onStep={setStep} canGoTo={(target) => target <= step} />

      {step === 1 && (
        <StepAppliances
          appliances={draft.appliances}
          params={params}
          onChange={(appliances) =>
            setDraft((current) => {
              // Resolver una actualización funcional una sola vez evita aplicar
              // dos veces el mismo cambio al depurar los esenciales nocturnos.
              const nextAppliances =
                typeof appliances === 'function'
                  ? (appliances as (items: HouseholdProfile['appliances']) => HouseholdProfile['appliances'])(current.appliances)
                  : appliances;
              return {
                ...current,
                appliances: nextAppliances,
                night: {
                  essentialIds: current.night.essentialIds.filter((id) => nextAppliances.some((item) => item.id === id)),
                },
              };
            })
          }
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <StepHabits
          household={draft}
          params={params}
          onHousehold={(change) => setDraft((current) => ({ ...current, ...change }))}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <div className="stack">
          <SectionTitle
            eyebrow="Último paso"
            title="Revisa tu vivienda"
            description="Comprueba los equipos y hábitos antes de guardar. Esta información se podrá reutilizar en todas tus instalaciones."
          />

          <Panel tone="paper" className="household-summary-card">
            <Field label="Nombre de la vivienda" htmlFor="household-name">
              <input
                id="household-name"
                className="text-field"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Ej.: Casa de Centro Habana"
              />
            </Field>
            <Field label="Tensión de la vivienda" htmlFor="household-voltage">
              <select
                id="household-voltage"
                value={draft.voltage}
                onChange={(event) => setDraft({ ...draft, voltage: event.target.value as HouseholdProfile['voltage'] })}
              >
                <option value="110">110 V</option>
                <option value="220">220 V</option>
                <option value="both">110 V y 220 V</option>
              </select>
            </Field>
          </Panel>

          <Panel tone="green">
            <div className="panel__head"><h3>Resumen del consumo</h3><Badge tone="storage">{draft.appliances.length} equipos</Badge></div>
            <div className="stat-grid stat-grid--four">
              <Stat value={fmtKwh(energy.dailyKwh)} label="Consumo diario" />
              <Stat value={fmtW(energy.peakSimultaneousW)} label="Potencia simultánea" />
              <Stat value={fmtKwh(nightKwh)} label="Reserva nocturna" />
              <Stat value={String(draft.night.essentialIds.length)} label="Equipos esenciales" />
            </div>
          </Panel>

          <Panel tone="paper">
            <div className="panel__head"><h3>Equipos seleccionados</h3><Button variant="quiet" onClick={() => setStep(1)}>Editar</Button></div>
            <div className="review-list">
              {draft.appliances.map((appliance) => (
                <div className="review-list__row" key={appliance.id}>
                  <span><strong>{appliance.name}</strong><small>×{appliance.quantity} · {fmtW(appliance.powerW * appliance.quantity)}</small></span>
                  {draft.night.essentialIds.includes(appliance.id) && <Badge tone="storage">Noche</Badge>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel tone="paper">
            <div className="panel__head"><h3>Hábitos de cocina</h3><Button variant="quiet" onClick={() => setStep(2)}>Editar</Button></div>
            {draft.activities.filter((activity) => activity.enabled).map((activity) => (
              <div className="review-list__row" key={activity.id}>
                <span><strong>{activity.label}</strong><small>Servir a las {String(Math.floor(activity.mealHour)).padStart(2, '0')}:{String(Math.round((activity.mealHour % 1) * 60)).padStart(2, '0')} · {activity.durationMinutes} min</small></span>
                <Badge tone="neutral">{fmtW(activity.powerW)}</Badge>
              </div>
            ))}
            <p className="field__hint" style={{ margin: '.75rem 0 0' }}>
              Combustible alternativo: {draft.cooking.fuelKind ? COOKING_FUEL_LABELS[draft.cooking.fuelKind] : 'ninguno declarado'} · Preparación flexible: {draft.cooking.allowFlexibleTiming ? 'sí' : 'no'}.
            </p>
          </Panel>

          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => setStep(2)}>Atrás</Button>
            <Button variant="outline" icon="sun" onClick={() => save(true)} disabled={draft.appliances.length === 0}>
              Guardar y generar recomendaciones
            </Button>
            <Button icon="check" onClick={() => save(false)} disabled={draft.appliances.length === 0}>Guardar vivienda</Button>
          </div>
        </div>
      )}

      <Toast message={saved} tone="info" />
    </div>
  );
}
