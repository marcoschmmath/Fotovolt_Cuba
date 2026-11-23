import { useState } from 'react';
import type { Calculation } from '../../app/useCalculation';
import { useApp } from '../../app/AppContext';
import { APPLIANCE_TEMPLATES, CATEGORIES, templateToAppliance, type ApplianceTemplate } from '../../domain/catalog/appliances';
import type { Appliance, Priority, Schedule } from '../../domain/core/types';
import { uid } from '../../domain/persistence/storage';
import { effectivePowerW, peakDesignW } from '../../domain/calculator/energy';
import { Badge, Button, Chip, Field, NumberField, Note, Panel, Segmented, TextField, fmtW } from '../../ui/components';
import { Icon, type IconName } from '../../ui/icons';

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 'critical', label: 'Imprescindible' },
  { value: 'important', label: 'Importante' },
  { value: 'discretionary', label: 'Opcional' },
];

const SCHEDULE_OPTIONS: Array<{ value: Schedule; label: string }> = [
  { value: 'day', label: 'Día' },
  { value: 'night', label: 'Noche' },
  { value: 'both', label: 'Ambos' },
  { value: 'custom', label: 'Otro' },
];

function ApplianceEditor({ appliance, onChange, onRemove }: { appliance: Appliance; onChange: (patch: Partial<Appliance>) => void; onRemove: () => void }) {
  const { state } = useApp();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const input = effectivePowerW(appliance, state.params);
  return (
    <div className="selected-item">
      <div className="selected-item__head">
        <div className="list-row__icon"><Icon name={appliance.icon as IconName} size={19} /></div>
        <strong>{appliance.name}</strong>
        {appliance.custom && <Badge>Manual</Badge>}
        <button type="button" className="icon-btn" aria-label={`Quitar ${appliance.name}`} onClick={onRemove}><Icon name="trash" size={17} /></button>
      </div>
      <div className="selected-item__body">
        <div className="selected-item__grid">
          <NumberField label="Cantidad" value={appliance.quantity} min={1} max={30} step={1} onChange={(v) => onChange({ quantity: Math.round(v) })} />
          <NumberField label={appliance.btuPerHour ? 'Potencia de placa' : 'Potencia'} value={appliance.powerW} min={0} step={10} unit="W" onChange={(v) => onChange({ powerW: v, powerIsEstimate: false })} />
          <NumberField label="Horas al día" value={appliance.hoursPerDay} min={0} max={24} step={0.25} unit="h" onChange={(v) => onChange({ hoursPerDay: v })} />
          {appliance.schedule === 'custom' && (
            <NumberField label="Hora de inicio" value={appliance.startHour} min={0} max={23} step={0.5} unit="h" onChange={(v) => onChange({ startHour: v })} />
          )}
        </div>
        <div style={{ marginTop: '.8rem' }}>
          <span className="field__label">Cuándo lo usas</span>
          <Segmented value={appliance.schedule} options={SCHEDULE_OPTIONS} label="Franja de uso" onChange={(v) => onChange({ schedule: v })} />
        </div>
        <div style={{ marginTop: '.8rem' }}>
          <span className="field__label">Prioridad</span>
          <div className="chip-grid" style={{ marginTop: '.35rem' }}>
            {PRIORITY_OPTIONS.map((option) => (
              <Chip key={option.value} active={appliance.priority === option.value} onClick={() => onChange({ priority: option.value })}>{option.label}</Chip>
            ))}
          </div>
        </div>
        {appliance.btuPerHour && (
          <Note level="warning" title="Potencia estimada desde BTU/h">
            {appliance.btuPerHour.toLocaleString('es-CU')} BTU/h ÷ EER {appliance.eer ?? state.params.acEer} ≈ {Math.round(input)} W. Es una aproximación: corrígela con la potencia de la placa técnica.
            <div className="row" style={{ marginTop: '.5rem' }}>
              <NumberField label="BTU/h" value={appliance.btuPerHour} min={0} step={1000} onChange={(v) => onChange({ btuPerHour: v, powerIsEstimate: true })} />
            </div>
          </Note>
        )}
        <button type="button" className="topbar__back" style={{ marginTop: '.6rem', fontSize: '.78rem', color: 'var(--storage)' }} onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? 'Ocultar detalles técnicos' : 'Ver detalles técnicos'}
          <Icon name="chevron" size={14} style={{ transform: showAdvanced ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </button>
        {showAdvanced && (
          <div style={{ marginTop: '.6rem' }}>
            <div className="selected-item__grid">
              <NumberField label="Factor de arranque" value={appliance.surgeFactor} min={1} max={10} step={0.1} onChange={(v) => onChange({ surgeFactor: v })} hint="1 si no tiene motor" />
              <NumberField label="Ciclo de trabajo" value={appliance.dutyCycle} min={0} max={1} step={0.05} onChange={(v) => onChange({ dutyCycle: v })} hint="1 = siempre encendido" />
            </div>
            <div style={{ marginTop: '.6rem' }}>
              <span className="field__label">Perfil de consumo</span>
              <Segmented
                value={appliance.profile}
                options={[{ value: 'constant', label: 'Constante' }, { value: 'cyclic', label: 'Cíclico' }, { value: 'modulated', label: 'Variable' }]}
                label="Perfil de consumo"
                onChange={(v) => onChange({ profile: v })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileBar({ onSwitch }: { onSwitch: () => void }) {
  const { state, patch } = useApp();
  const [mode, setMode] = useState<'new' | 'rename' | 'duplicate' | null>(null);
  const [name, setName] = useState('');
  const active = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];

  function switchTo(id: string) {
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) return;
    patch({ activeProfileId: id, appliances: profile.appliances.map((a) => ({ ...a })) });
    onSwitch();
  }

  function apply() {
    const label = name.trim();
    if (!label) return;
    if (mode === 'rename') {
      patch({ profiles: state.profiles.map((p) => (p.id === active.id ? { ...p, name: label } : p)) });
    } else {
      const created = {
        id: uid('profile'),
        name: label,
        appliances: mode === 'duplicate' ? active.appliances.map((a) => ({ ...a, id: uid('app') })) : [],
        createdAt: new Date().toISOString(),
      };
      patch({ profiles: [...state.profiles, created], activeProfileId: created.id, appliances: created.appliances });
      onSwitch();
    }
    setMode(null);
    setName('');
  }

  function remove() {
    if (state.profiles.length <= 1) return;
    const remaining = state.profiles.filter((p) => p.id !== active.id);
    patch({ profiles: remaining, activeProfileId: remaining[0].id, appliances: remaining[0].appliances });
    onSwitch();
  }

  return (
    <Panel tone="paper">
      <div className="row row--between">
        <div>
          <strong>Perfil de equipos</strong>
          <span className="field__hint">Guarda una casa o escenario distinto sin borrar los demás.</span>
        </div>
        <Badge tone="storage">{state.profiles.length} perfil(es)</Badge>
      </div>
      <Field label="Perfil activo" htmlFor="profile-select">
        <select id="profile-select" value={active.id} onChange={(e) => switchTo(e.target.value)}>
          {state.profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.appliances.length} equipos</option>)}
        </select>
      </Field>
      <div className="chip-grid">
        <Chip onClick={() => { setMode('new'); setName(''); }} icon="plus">Nuevo</Chip>
        <Chip onClick={() => { setMode('duplicate'); setName(`${active.name} (copia)`); }} icon="layers">Duplicar</Chip>
        <Chip onClick={() => { setMode('rename'); setName(active.name); }} icon="settings">Renombrar</Chip>
        <Chip onClick={remove} icon="trash">Eliminar</Chip>
      </div>
      {mode && (
        <div style={{ marginTop: '.8rem' }}>
          <TextField label={mode === 'rename' ? 'Nuevo nombre' : 'Nombre del perfil'} value={name} onChange={setName} placeholder="Ej.: Casa de la Habana" />
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => setMode(null)}>Cancelar</Button>
            <Button icon="check" onClick={apply} disabled={!name.trim()}>Guardar perfil</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function StepAppliances({ calculation, onNext }: { calculation: Calculation; onNext: () => void }) {
  const { state, patch } = useApp();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({ name: '', powerW: 600, hoursPerDay: 4, schedule: 'day' as Schedule, priority: 'important' as Priority });
  const templates = APPLIANCE_TEMPLATES.filter((t) => t.category === category);
  const energy = calculation.sizing.energy;
  const peak = peakDesignW(energy);

  function toggleTemplate(template: ApplianceTemplate) {
    const created = templateToAppliance(template, uid('app'));
    patch((current) => {
      const existing = current.appliances.find((a) => a.name === template.name && !a.custom);
      if (existing) return { appliances: current.appliances.filter((a) => a.id !== existing.id) };
      return { appliances: [...current.appliances, created] };
    });
    setExpanded(created.id);
  }

  function update(id: string, value: Partial<Appliance>) {
    patch({ appliances: state.appliances.map((a) => (a.id === id ? { ...a, ...value } : a)) });
  }

  function addManual() {
    if (!manual.name.trim() || manual.powerW <= 0) return;
    const created: Appliance = {
      id: uid('custom'),
      name: manual.name.trim(),
      category: 'Otros',
      icon: 'plug',
      quantity: 1,
      powerW: manual.powerW,
      hoursPerDay: manual.hoursPerDay,
      schedule: manual.schedule,
      startHour: 8,
      priority: manual.priority,
      surgeFactor: 1,
      dutyCycle: 1,
      profile: 'constant',
      custom: true,
    };
    patch({ appliances: [...state.appliances, created] });
    setExpanded(created.id);
    setAdding(false);
    setManual({ name: '', powerW: 600, hoursPerDay: 4, schedule: 'day', priority: 'important' });
  }

  return (
    <>
      <div className="section-title">
        <span className="eyebrow">Paso 1 de 4</span>
        <h2>¿Qué equipos tienes en casa?</h2>
        <p>Elige los que más usas. Después puedes cambiar la potencia, las horas y la prioridad de cada uno.</p>
      </div>

      <ProfileBar onSwitch={() => setExpanded(null)} />

      <Panel tone="paper">
        <div className="cat-tabs" role="group" aria-label="Categorías de electrodomésticos">
          {CATEGORIES.map((item) => (
            <Chip key={item} active={category === item} onClick={() => setCategory(item)}>{item}</Chip>
          ))}
        </div>
        <div className="appliance-grid">
          {templates.map((template) => {
            const selected = state.appliances.some((a) => a.name === template.name && !a.custom);
            return (
              <button
                type="button"
                key={template.name}
                className={`app-tile ${selected ? 'is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => toggleTemplate(template)}
              >
                <span className="app-tile__icon"><Icon name={template.icon as IconName} size={21} /></span>
                <span className="app-tile__name">{template.name}</span>
                <span className="app-tile__power">{template.powerW} W · {template.hoursPerDay} h</span>
                {selected && <span className="app-tile__check"><Icon name="check" size={15} /></span>}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: '1rem' }}>
          <Button variant="quiet" full icon={adding ? 'close' : 'plus'} onClick={() => setAdding(!adding)}>
            {adding ? 'Cerrar formulario' : 'Añadir un equipo que no aparece'}
          </Button>
        </div>
        {adding && (
          <div style={{ marginTop: '1rem' }}>
            <Field label="Nombre del equipo" htmlFor="manual-name">
              <input id="manual-name" value={manual.name} placeholder="Ej.: plancha, taladro, bomba…" onChange={(e) => setManual({ ...manual, name: e.target.value })} />
            </Field>
            <div className="selected-item__grid">
              <NumberField label="Potencia" value={manual.powerW} min={1} step={10} unit="W" onChange={(v) => setManual({ ...manual, powerW: v })} />
              <NumberField label="Horas al día" value={manual.hoursPerDay} min={0} max={24} step={0.25} unit="h" onChange={(v) => setManual({ ...manual, hoursPerDay: v })} />
            </div>
            <div style={{ marginTop: '.7rem' }}>
              <Segmented value={manual.schedule} options={SCHEDULE_OPTIONS.slice(0, 3)} label="Franja de uso" onChange={(v) => setManual({ ...manual, schedule: v })} />
            </div>
            <div className="chip-grid" style={{ marginTop: '.7rem' }}>
              {PRIORITY_OPTIONS.map((o) => <Chip key={o.value} active={manual.priority === o.value} onClick={() => setManual({ ...manual, priority: o.value })}>{o.label}</Chip>)}
            </div>
            <div style={{ marginTop: '.9rem' }}><Button full icon="plus" onClick={addManual} disabled={!manual.name.trim()}>Añadir equipo</Button></div>
          </div>
        )}
      </Panel>

      {state.appliances.length > 0 && (
        <Panel tone="transparent">
          <div className="panel__head">
            <h3>Tus equipos ({state.appliances.length})</h3>
            <span className="field__hint">Toca uno para editarlo</span>
          </div>
          {state.appliances.map((appliance) => (
            <div key={appliance.id}>
              <button
                type="button"
                className="row row--between"
                style={{ width: '100%', border: 0, background: 'none', padding: '.7rem 0', color: 'inherit', textAlign: 'left', display: 'flex' }}
                onClick={() => setExpanded(expanded === appliance.id ? null : appliance.id)}
                aria-expanded={expanded === appliance.id}
              >
                <span className="row">
                  <span className="list-row__icon"><Icon name={appliance.icon as IconName} size={18} /></span>
                  <span>{appliance.name} <small style={{ color: 'var(--muted)' }}>×{appliance.quantity}</small></span>
                </span>
                <span className="row">
                  <span className="mono" style={{ fontSize: '.8rem' }}>{fmtW(effectivePowerW(appliance, state.params) * appliance.quantity)}</span>
                  <Icon name="chevron" size={14} style={{ transform: expanded === appliance.id ? 'rotate(90deg)' : 'none' }} />
                </span>
              </button>
              {expanded === appliance.id && (
                <ApplianceEditor
                  appliance={appliance}
                  onChange={(value) => update(appliance.id, value)}
                  onRemove={() => patch({ appliances: state.appliances.filter((a) => a.id !== appliance.id) })}
                />
              )}
            </div>
          ))}
        </Panel>
      )}

      {state.appliances.some((a) => a.powerIsEstimate) && (
        <Note level="warning" title="Hay potencias aproximadas">
          Algunos aires acondicionados se estimaron a partir de BTU/h con un EER configurable. Sustituye ese valor por la potencia de la placa para afinar el resultado.
        </Note>
      )}

      <div className="summary-bar">
        <div className="summary-bar__grid">
          <div><strong>{fmtW(energy.peakSimultaneousW)}</strong><span>Potencia simultánea</span></div>
          <div><strong>{energy.dailyKwh.toFixed(2)} kWh</strong><span>Energía al día</span></div>
          <div><strong>{energy.nightKwh.toFixed(2)} kWh</strong><span>De noche</span></div>
        </div>
        <div className="row--between" style={{ marginTop: '.6rem', fontSize: '.73rem', color: 'var(--muted)' }}>
          <span>Imprescindibles: {energy.criticalKwh.toFixed(2)} kWh/día</span>
          <span>Pico con arranque: {fmtW(peak)}</span>
        </div>
      </div>

      <div className="wizard-actions">
        <Button onClick={onNext} disabled={state.appliances.length === 0} icon="chevron" trailing>
          Continuar
        </Button>
      </div>
      {state.appliances.length === 0 && <Note level="info">Añade al menos un equipo para continuar.</Note>}
    </>
  );
}
