import { useMemo, useState } from 'react';
import type { CookingActivity, CookingFuelKind, CookingSubstitution, HouseholdProfile } from '../../domain/household/types';
import { COOKING_FUEL_LABELS, SUBSTITUTION_LABELS } from '../../domain/household/types';
import type { Appliance, DesignParams } from '../../domain/core/types';
import { analyzeEnergy } from '../../domain/calculator/energy';
import { nightEssentialKwh } from '../../domain/simulator/bridge';
import { formatHour } from '../../ui/charts';
import { Badge, Button, Chip, Note, NumberField, Panel, SectionTitle, Stat, fmtKwh, fmtW } from '../../ui/components';
import { Icon } from '../../ui/icons';

/**
 * Paso 2 del hogar: cocina, comodidad nocturna y combustible alternativo.
 * Nada de esto depende de la instalación: son hábitos de la vivienda.
 */

const FUEL_OPTIONS: Array<{ value: CookingFuelKind | 'none'; label: string }> = [
  { value: 'gas', label: 'Gas' },
  { value: 'charcoal', label: 'Carbón' },
  { value: 'none', label: 'No tengo' },
];

const SUBSTITUTION_OPTIONS: Array<{ value: CookingSubstitution; label: string }> = [
  { value: 'electric-first', label: 'Eléctrico si se puede' },
  { value: 'fuel-first', label: 'Combustible si toca batería' },
  { value: 'never', label: 'Siempre eléctrico' },
];

/** Equipos que suelen ser esenciales de noche, para sugerirlos. */
const NIGHT_HINTS = ['fan', 'ac', 'fridge', 'light', 'router', 'freezer'];

export function StepHabits({
  household,
  params,
  onHousehold,
  onNext,
  onBack,
}: {
  household: HouseholdProfile;
  params: DesignParams;
  onHousehold: (change: Partial<HouseholdProfile>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const energy = useMemo(() => analyzeEnergy(household.appliances, params), [household.appliances, params]);
  const nightKwh = useMemo(() => nightEssentialKwh(household, params), [household, params]);

  const appliances = household.appliances;
  // En perfiles guardados antes de esta versión, 'gas' era un valor por
  // defecto y no prueba que la familia realmente disponga de él.
  const confirmedFuel = household.cooking.fuelKind !== null && household.cooking.fuelConfirmed;
  const toggleNight = (appliance: Appliance) => {
    const next = household.night.essentialIds.includes(appliance.id)
      ? household.night.essentialIds.filter((id) => id !== appliance.id)
      : [...household.night.essentialIds, appliance.id];
    onHousehold({ night: { essentialIds: next } });
  };

  const patchActivity = (id: CookingActivity['id'], change: Partial<CookingActivity>) => {
    onHousehold({
      activities: household.activities.map((a) => (a.id === id ? { ...a, ...change } : a)),
    });
  };

  return (
    <div className="stack">
      <SectionTitle
        title="Cómo cocinas y qué necesitas de noche"
        description="Estos hábitos son de tu vivienda, no de la instalación. Se reutilizan en todos los sistemas que compares."
      />

      <Panel tone="paper">
        <div className="panel__head">
          <h3>Comidas del día</h3>
          <Badge tone={household.cooking.enabled ? 'storage' : 'neutral'}>
            {household.cooking.enabled ? 'Cocina modelada' : 'Sin cocina'}
          </Badge>
        </div>
        <p className="field__hint" style={{ marginTop: 0 }}>
          La hora de servir la comida y la de cocinar son distintas: si hace falta, la preparación se puede adelantar dentro de la ventana para usar el sol o la red, sin cambiar la hora de comer.
        </p>
        <div className="stack" style={{ gap: '.9rem', marginTop: '.8rem' }}>
          {household.activities.map((activity) => (
            <details key={activity.id} className="meal">
              <summary className="meal__summary">
                <span className="list-row__icon"><Icon name={activity.id === 'breakfast' ? 'sun' : activity.id === 'lunch' ? 'rice' : 'stove'} size={17} /></span>
                <strong>{activity.label}</strong>
                <span className="meal__time">{formatHour(activity.mealHour)}</span>
                <span className="field__hint">
                  {activity.id === 'breakfast' ? 'Calentar agua, café, leche' : `Cocción (≈ ${activity.durationMinutes} min)`}
                </span>
              </summary>
              <div className="meal__body">
                <label className="meal__toggle">
                  <input
                    type="checkbox"
                    checked={activity.enabled || !confirmedFuel}
                    disabled={!confirmedFuel}
                    onChange={(event) => patchActivity(activity.id, { enabled: event.target.checked })}
                    aria-label={`Simular ${activity.label}`}
                  />
                  <span>{!confirmedFuel ? 'Comida obligatoria: se modela con electricidad' : 'Incluir esta comida en la simulación'}</span>
                </label>
                <div className="selected-item__grid">
                  <NumberField
                    label="Hora de servir"
                    value={activity.mealHour}
                    min={6}
                    max={22}
                    step={0.25}
                    unit="h"
                    onChange={(v) => patchActivity(activity.id, { mealHour: v })}
                  />
                  <NumberField
                    label="Potencia de cocción"
                    value={activity.powerW}
                    min={100}
                    max={5000}
                    step={50}
                    unit="W"
                    hint="Estimación declarada: corrígela con la placa"
                    onChange={(v) => patchActivity(activity.id, { powerW: v })}
                  />
                  <NumberField
                    label="Duración"
                    value={activity.durationMinutes}
                    min={10}
                    max={240}
                    step={5}
                    unit="min"
                    onChange={(v) => patchActivity(activity.id, { durationMinutes: v })}
                  />
                </div>
                <div className="selected-item__grid" style={{ marginTop: '.5rem' }}>
                  <NumberField
                    label="Ventana: desde"
                    value={activity.windowStartHour}
                    min={0}
                    max={23.75}
                    step={0.25}
                    unit="h"
                    onChange={(v) => patchActivity(activity.id, { windowStartHour: v })}
                  />
                  <NumberField
                    label="Ventana: hasta"
                    value={activity.windowEndHour}
                    min={0.25}
                    max={24}
                    step={0.25}
                    unit="h"
                    onChange={(v) => patchActivity(activity.id, { windowEndHour: v })}
                  />
                </div>
                <div className="row row--wrap" style={{ marginTop: '.5rem', gap: '.5rem' }}>
                  <Chip
                    active={activity.essential}
                    onClick={() => patchActivity(activity.id, { essential: !activity.essential })}
                    icon="warning"
                  >
                    {activity.essential ? 'Imprescindible' : 'Marcar como imprescindible'}
                  </Chip>
                </div>
                {activity.applianceIds.length === 0 && (
                  <Note level="info">
                    Los {activity.powerW} W y {activity.durationMinutes} min son una estimación declarada. Añade el equipo de cocina en «Equipos» con su potencia real y aquí podrás vinculado.
                  </Note>
                )}
              </div>
            </details>
          ))}
        </div>
      </Panel>

      <Panel tone="paper">
        <div className="panel__head">
          <h3>Combustible alternativo</h3>
          <Badge tone={confirmedFuel ? 'solar' : 'warning'}>
            {confirmedFuel ? COOKING_FUEL_LABELS[household.cooking.fuelKind!] : household.cooking.fuelKind ? 'Por confirmar' : household.cooking.fuelConfirmed ? 'No tengo' : 'Sin declarar'}
          </Badge>
        </div>
        <p className="field__hint" style={{ marginTop: 0 }}>
          Declara aquí sólo los combustibles que realmente tienes. Si no confirmas uno, el simulador exige que el desayuno, el almuerzo y la comida se preparen eléctricamente, aunque eso reduzca la reserva disponible para la noche.
        </p>
        {household.cooking.fuelKind !== null && !household.cooking.fuelConfirmed && (
          <Note level="warning" title="Confirma el combustible de esta vivienda">
            Una versión anterior de SolarAPP guardaba «Gas» por defecto. No lo contamos como disponible hasta que vuelvas a tocar la opción correspondiente y confirmes que realmente tienes ese combustible. Si no tienes gas ni carbón, selecciona «No tengo».
          </Note>
        )}
        <div className="chip-grid fuel-options" style={{ marginTop: '.6rem' }}>
          {FUEL_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              active={option.value === 'none' ? household.cooking.fuelKind === null : household.cooking.fuelKind === option.value}
              onClick={() => onHousehold({
                cooking: {
                  ...household.cooking,
                  fuelKind: option.value === 'none' ? null : option.value,
                  fuelConfirmed: true,
                },
                ...(option.value === 'none' ? { activities: household.activities.map((activity) => ({ ...activity, enabled: true })) } : {}),
              })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <button
          type="button"
          className={`linkish fuel-other ${household.cooking.fuelKind === 'other' ? 'is-active' : ''}`}
          aria-pressed={household.cooking.fuelKind === 'other'}
          onClick={() => onHousehold({
            cooking: {
              ...household.cooking,
              fuelKind: household.cooking.fuelKind === 'other' ? null : 'other',
              fuelConfirmed: true,
            },
            ...(household.cooking.fuelKind === 'other' ? { activities: household.activities.map((activity) => ({ ...activity, enabled: true })) } : {}),
          })}
        >
          {household.cooking.fuelKind === 'other' ? 'Otro combustible seleccionado' : 'Tengo otro combustible'}
        </button>
        {confirmedFuel && (
          <>
            <fieldset className="field field--group">
              <legend className="field__label">Cuando la cocción eléctrica no se pueda cubrir con el sol o la red</legend>
              <div
                className="choice-list"
                role="radiogroup"
                aria-label="Política de cocción cuando falta el sol o la red"
              >
                {SUBSTITUTION_OPTIONS.map((option) => {
                  const selected = household.cooking.substitution === option.value;
                  return (
                    <label key={option.value} className={`choice ${selected ? 'is-on' : ''}`}>
                      <input
                        type="radio"
                        name="cooking-policy"
                        value={option.value}
                        checked={selected}
                        onChange={() => onHousehold({ cooking: { ...household.cooking, substitution: option.value } })}
                      />
                      <span className="choice__body">
                        <strong className="choice__title">{option.label}</strong>
                        <span className="choice__desc">{SUBSTITUTION_LABELS[option.value]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </>
        )}
        <label className="flex-toggle">
          <span>
            <strong>Puedo adelantar la preparación</strong>
            <span className="field__hint">
              Aprovecha el sol o la red dentro de la ventana permitida. La hora de servir la comida no cambia.
            </span>
          </span>
          <input
            type="checkbox"
            checked={household.cooking.allowFlexibleTiming}
            onChange={(event) => onHousehold({ cooking: { ...household.cooking, allowFlexibleTiming: event.target.checked } })}
          />
        </label>
        {!confirmedFuel && (
          <Note level="warning" title="Sin combustible alternativo">
            Las comidas se mantienen como demanda eléctrica obligatoria. El simulador puede usar la batería hasta su límite físico, incluso por debajo de la reserva nocturna; si aun así faltan potencia o energía, registrará el déficit en lugar de eliminar la comida del cálculo.
          </Note>
        )}
      </Panel>

      <Panel tone="paper">
        <div className="panel__head">
          <h3>Equipos esenciales de noche</h3>
          <Badge tone="storage">{household.night.essentialIds.length} marcados</Badge>
        </div>
        <p className="field__hint" style={{ marginTop: 0 }}>
          Márcalos: la simulación reserva energía de la batería para que no se queden sin electricidad de madrugada.
        </p>
        {appliances.length === 0 && <Note level="info">Añade equipos en el paso anterior para poder marcarlos.</Note>}
        <div className="stack" style={{ gap: '.5rem' }}>
          {appliances.map((appliance) => {
            const selected = household.night.essentialIds.includes(appliance.id);
            const suggested = NIGHT_HINTS.some((hint) => appliance.icon.includes(hint));
            return (
              <label key={appliance.id} className={`list-row list-row--selectable ${selected ? 'is-on' : ''}`}>
                <input type="checkbox" checked={selected} onChange={() => toggleNight(appliance)} />
                <span className="list-row__icon"><Icon name={appliance.icon as 'plug'} size={17} /></span>
                <span className="list-row__body">
                  <strong>{appliance.name}</strong>
                  <span className="field__hint">
                    {fmtW(appliance.powerW * appliance.quantity)} · {appliance.hoursPerDay} h/día
                    {suggested ? ' · suele usarse de noche' : ''}
                  </span>
                </span>
                {appliance.priority === 'critical' && !selected && <Badge tone="warning">Imprescindible</Badge>}
              </label>
            );
          })}
        </div>
        {nightKwh > 0 ? (
          <Note level="success" title={`Reserva nocturna estimada: ${fmtKwh(nightKwh)} por noche`}>
            Es la energía real que necesitan esos equipos según las horas que declaraste, no un porcentaje fijo.
          </Note>
        ) : (
          <Note level="warning" title="Sin reserva nocturna">
            Si no marcas equipos esenciales, la batería no guarda energía para la noche y los equipos imprescindibles pueden quedarse sin electricidad.
          </Note>
        )}
      </Panel>

      <Panel tone="green">
        <div className="panel__head">
          <h3>Resumen de tu vivienda</h3>
        </div>
        <div className="stat-grid stat-grid--four">
          <Stat label="Consumo diario" value={fmtKwh(energy.dailyKwh)} />
          <Stat label="De noche" value={fmtKwh(energy.nightKwh)} />
          <Stat label="Potencia simultánea" value={fmtW(energy.peakSimultaneousW)} />
          <Stat label="Reserva de noche" value={nightKwh > 0 ? fmtKwh(nightKwh) : '—'} />
        </div>
        <button type="button" className="topbar__back" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {advanced ? 'Ocultar' : 'Ver'} supuestos de cálculo
          <Icon name="chevron" size={14} />
        </button>
        {advanced && (
          <Note level="info">
            Franja nocturna {params.nightStart}:00 a {params.nightEnd}:00 · paso de simulación {params.stepMinutes} min · EER de referencia {params.acEer}.
          </Note>
        )}
      </Panel>

      <div className="wizard-actions">
        <Button variant="quiet" onClick={onBack} icon="chevron">Atrás</Button>
        <Button onClick={onNext} icon="check" disabled={household.appliances.length === 0}>
          Revisar resumen
        </Button>
      </div>
    </div>
  );
}