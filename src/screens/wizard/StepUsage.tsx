import { useApp } from '../../app/AppContext';
import type { Calculation } from '../../app/useCalculation';
import type { GridPattern } from '../../domain/simulator/grid';
import { hoursBetween } from '../../domain/calculator/energy';
import { Button, Chip, Note, NumberField, Panel, RangeField, Segmented, fmtW } from '../../ui/components';
import { Icon } from '../../ui/icons';

const HOUR_OPTIONS = [2, 3, 4];

const PATTERNS: Array<{ value: GridPattern; label: string }> = [
  { value: 'morning', label: 'Mañana' },
  { value: 'evening', label: 'Atardecer' },
  { value: 'split', label: 'Repartido' },
  { value: 'custom', label: 'Otro' },
];

function isNightCritical(schedule: string): boolean {
  return schedule !== 'day';
}

export function StepUsage({ calculation, onNext, onBack }: { calculation: Calculation; onNext: () => void; onBack: () => void }) {
  const { state, patch } = useApp();
  const { gridInput, params } = state;
  const nightHours = hoursBetween(params.nightStart, params.nightEnd);
  const autonomyHours = Math.round(params.autonomyDays * nightHours);
  const otherHours = !HOUR_OPTIONS.includes(gridInput.hoursPerDay);

  function setGrid(value: Partial<typeof gridInput>) {
    patch({ gridInput: { ...gridInput, ...value } });
  }

  function setParams(value: Partial<typeof params>) {
    patch({ params: { ...params, ...value } });
  }

  function toggleCritical(id: string, enabled: boolean) {
    patch({
      appliances: state.appliances.map((a) =>
        a.id === id
          ? { ...a, priority: enabled ? 'critical' : 'important', schedule: enabled && a.schedule === 'day' ? 'both' : a.schedule }
          : a,
      ),
    });
  }

  return (
    <>
      <div className="section-title">
        <span className="eyebrow">Paso 2 de 4</span>
        <h2>¿Cómo quieres usar tu instalación?</h2>
        <p>En Cuba la red puede estar muy limitada. Estos datos determinan cuánto debe aguantar tu batería.</p>
      </div>

      <Panel tone="paper">
        <h3>Disponibilidad de la red</h3>
        <span className="field__label">¿Cuántas horas de luz tienes al día?</span>
        <div className="chip-grid" style={{ marginTop: '.4rem', marginBottom: '.9rem' }}>
          {HOUR_OPTIONS.map((hours) => (
            <Chip key={hours} active={gridInput.hoursPerDay === hours} onClick={() => setGrid({ hoursPerDay: hours })}>{hours} horas</Chip>
          ))}
          <Chip active={otherHours} onClick={() => setGrid({ hoursPerDay: 5 })}>Otra cantidad</Chip>
        </div>
        {otherHours && (
          <RangeField label="Horas de red al día" value={gridInput.hoursPerDay} min={1} max={24} step={0.5} display={`${gridInput.hoursPerDay} h`} onChange={(v) => setGrid({ hoursPerDay: v })} />
        )}

        <span className="field__label">¿A qué hora suele llegar?</span>
        <div style={{ marginTop: '.4rem' }}>
          <Segmented value={gridInput.pattern} options={PATTERNS} label="Horario de la red" onChange={(v) => setGrid({ pattern: v })} />
        </div>
        {gridInput.pattern === 'custom' && (
          <RangeField label="Hora de inicio" value={gridInput.startHour} min={0} max={23} display={`${String(gridInput.startHour).padStart(2, '0')}:00`} onChange={(v) => setGrid({ startHour: v })} />
        )}

        <div className="selected-item__grid" style={{ marginTop: '.8rem' }}>
          <NumberField label="Potencia máxima de red" value={gridInput.maxPowerW} min={100} step={100} unit="W" hint="Si no la conoces, deja el valor orientativo." onChange={(v) => setGrid({ maxPowerW: v })} />
          <NumberField label="Carga desde red" value={gridInput.chargerPowerW} min={0} step={100} unit="W" hint="Lo que el inversor puede cargar en ese tiempo." onChange={(v) => setGrid({ chargerPowerW: v })} />
        </div>
        <label className="row" style={{ marginTop: '.9rem', fontSize: '.85rem', alignItems: 'flex-start' }}>
          <input type="checkbox" checked={gridInput.allowExport} onChange={(e) => setGrid({ allowExport: e.target.checked })} />
          <span>Permitir verter excedentes a la red <small style={{ display: 'block', color: 'var(--muted)' }}>Sólo si está permitido y el inversor lo admite.</small></span>
        </label>
        <Note level="info" title="Puedes tomar estos datos de otra fuente">
          Si más adelante consultas los apagones del circuito desde otra aplicación o un canal de Telegram de la empresa eléctrica, vuelve aquí y actualiza las horas a mano. La calculadora no necesita internet para usar ese dato.
        </Note>
        <Note level="info" title="Dos horas no garantizan recarga completa">
          Tener electricidad unas horas no significa que la batería pueda llenarse: depende de la potencia real de red y de la capacidad de carga del inversor. El simulador lo comprueba.
        </Note>
      </Panel>

      <Panel tone="paper">
        <h3>Durante un apagón</h3>
        <RangeField
          label="¿Cuántas horas quieres mantener los equipos funcionando?"
          value={autonomyHours}
          min={1}
          max={24}
          display={`${autonomyHours} h`}
          hint={`Se convierte a ${params.autonomyDays.toFixed(2)} día(s) de energía nocturna (la noche configurada dura ${nightHours} h).`}
          onChange={(v) => setParams({ autonomyDays: v / nightHours })}
        />
        <span className="field__label">¿Qué equipos deben funcionar obligatoriamente de noche?</span>
        <div style={{ marginTop: '.5rem' }}>
          {state.appliances.map((a) => {
            const checked = a.priority === 'critical' && isNightCritical(a.schedule);
            return (
              <label key={a.id} className="row" style={{ padding: '.45rem 0', fontSize: '.86rem', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={checked} onChange={(e) => toggleCritical(a.id, e.target.checked)} />
                <span>{a.name} <small style={{ color: 'var(--muted)' }}>· {a.hoursPerDay} h/día</small></span>
              </label>
            );
          })}
        </div>
        <Note level="info">Los equipos marcados aquí pasan a considerarse imprescindibles. Si antes eran de uso diurno, se usarán también de noche en la simulación.</Note>
      </Panel>

      <Panel tone="paper">
        <h3>Tipo de instalación</h3>
        <div className="stack" style={{ gridTemplateColumns: '1fr 1fr', display: 'grid', gap: '.6rem' }}>
          {[
            { id: 'hybrid' as const, title: 'Híbrida', text: 'Paneles, baterías y red. Cargas con la red cuando esté disponible.' },
            { id: 'offgrid' as const, title: 'Aislada', text: 'Sólo paneles y baterías. Sin depender de la red en ningún momento.' },
          ].map((option) => (
            <button
              type="button"
              key={option.id}
              className={`app-tile ${state.installationType === option.id ? 'is-selected' : ''}`}
              aria-pressed={state.installationType === option.id}
              onClick={() => patch({ installationType: option.id })}
            >
              <span className="app-tile__name">{option.title}</span>
              <span className="app-tile__power">{option.text}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: '1rem' }}>
          <span className="field__label">Tensión de tu vivienda</span>
          <div style={{ marginTop: '.4rem' }}>
            <Segmented
              value={gridInput.voltage}
              options={[{ value: 110, label: '110 V' }, { value: 220, label: '220 V' }, { value: 'both', label: 'Ambas' }]}
              label="Tensión de la vivienda"
              onChange={(v) => setGrid({ voltage: v })}
            />
          </div>
        </div>
        {gridInput.voltage === 'both' && <Note level="warning">Con 110 V y 220 V hace falta revisar la distribución de circuitos en el estudio técnico.</Note>}
        <div className="row" style={{ marginTop: '.8rem', fontSize: '.78rem', color: 'var(--muted)' }}>
          <Icon name="bolt" size={15} /> Demanda punta detectada: {fmtW(calculation.sizing.energy.peakSimultaneousW)}
        </div>
      </Panel>

      <div className="wizard-actions">
        <Button variant="quiet" onClick={onBack} icon="chevron">Atrás</Button>
        <Button onClick={onNext} icon="chevron" trailing>Continuar</Button>
      </div>
    </>
  );
}
