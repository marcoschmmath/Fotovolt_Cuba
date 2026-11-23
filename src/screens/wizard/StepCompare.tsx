import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import type { Calculation } from '../../app/useCalculation';
import { testedAutonomyHours } from '../../domain/simulator/analysis';
import { Badge, Button, Note, Panel, Stat, fmtKwh, fmtMoney, fmtW } from '../../ui/components';
import { CompareBars } from '../../ui/charts';
import { Icon } from '../../ui/icons';

export function StepCompare({ calculation, onFinish, onBack }: { calculation: Calculation; onFinish: () => void; onBack: () => void }) {
  const { state, patch } = useApp();
  const { options, optionResults } = calculation;
  const autonomies = useMemo(
    () => options.map((option) => (option.config ? testedAutonomyHours(option.config) : 0)),
    [options],
  );
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === state.selectedOptionId));
  const selected = options[selectedIndex];
  const selectedResult = optionResults[selectedIndex];

  if (!calculation.hasLoads) {
    return (
      <Panel tone="paper">
        <Note level="warning">Añade equipos en el paso 1 para poder comparar instalaciones.</Note>
        <Button full onClick={onBack}>Volver a los equipos</Button>
      </Panel>
    );
  }

  return (
    <>
      <div className="section-title">
        <span className="eyebrow">Paso 4 de 4</span>
        <h2>Compara instalaciones</h2>
        <p>Los tamaños salen de tu consumo real. La autonomía y la cobertura proceden de la simulación, no de cifras fijas.</p>
      </div>

      {options.map((option, index) => {
        const result = optionResults[index];
        const coverage = result ? result.totals.coverage : 0;
        const active = index === selectedIndex;
        return (
          <button
            type="button"
            key={option.id}
            className={`option-card ${option.id === 'equilibrada' ? 'option-card--featured' : ''}`}
            style={active ? { boxShadow: 'inset 0 0 0 2px var(--storage)' } : undefined}
            aria-pressed={active}
            onClick={() => patch({ selectedOptionId: option.id })}
          >
            {option.id === 'equilibrada' && <span className="option-card__flag">Recomendada</span>}
            <div className="option-card__title">
              <h3>{option.label}</h3>
              {option.price !== undefined && <strong>{fmtMoney(option.price, option.currency)}</strong>}
            </div>
            <p className="option-card__desc">{option.description}</p>
            <p className="option-card__desc" style={{ marginTop: '-.5rem' }}>{option.capacityNote}</p>
            <div className="stat-grid stat-grid--four">
              <Stat tone="solar" value={fmtW(option.pvW)} label="Paneles" sub={`${option.panelCount} × ${calculation.panel.powerW} W`} />
              <Stat tone="storage" value={fmtKwh(option.batteryKwh)} label="Batería" sub={`${option.batteryCount} módulo(s) sugerido(s)`} />
              <Stat value={option.inverter ? fmtW(option.inverter.ratedW) : '—'} label="Inversor" />
              <Stat tone="demand" value={`${autonomies[index].toFixed(1)} h`} label="Autonomía" sub="Sin sol ni red" />
            </div>
            <div style={{ marginTop: '.9rem' }}>
              <div className="row--between" style={{ fontSize: '.75rem', marginBottom: '.35rem' }}>
                <span>Cobertura estimada del consumo</span>
                <strong className="mono">{Math.round(coverage * 100)} %</strong>
              </div>
              <div className="option-card__meter"><span style={{ width: `${Math.min(100, coverage * 100)}%` }} /></div>
            </div>
            {option.warnings.map((w) => <Note key={w} level="warning">{w}</Note>)}
            {active && <div className="row" style={{ marginTop: '.8rem', color: 'var(--storage)', fontSize: '.8rem' }}><Icon name="check" size={16} /> Opción seleccionada</div>}
          </button>
        );
      })}

      <Panel tone="dark">
        <h3>Qué ganas al aumentar la batería</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.82rem', marginBottom: '1rem' }}>Autonomía probada sin sol ni red, con tus equipos imprescindibles.</p>
        <CompareBars
          unit="h"
          rows={options.map((o, i) => ({ key: o.id, label: o.label, value: autonomies[i] }))}
        />
        <div className="divider divider--light" />
        <p style={{ color: 'var(--muted)', fontSize: '.82rem', marginBottom: '.7rem' }}>Capacidad nominal instalada</p>
        <CompareBars
          unit="kWh"
          rows={options.map((o) => ({ key: o.id, label: o.label, value: o.batteryKwh }))}
        />
      </Panel>

      <Note level="warning" title="Estimación preliminar">
        Estas cifras salen de un modelo con hipótesis configurables. No son un diseño eléctrico certificado: hace falta un estudio técnico presencial y fichas reales de los equipos.
      </Note>

      <Panel tone="green">
        <div className="row--between">
          <div>
            <strong>{selected.label}</strong>
            <p style={{ margin: '.2rem 0 0', fontSize: '.82rem', opacity: .85 }}>
              {selectedResult ? `Cobertura ${Math.round(selectedResult.totals.coverage * 100)} % · ${autonomies[selectedIndex].toFixed(1)} h de autonomía · recarga ${calculation.recharge.withGrid !== null ? `${calculation.recharge.withGrid.toFixed(1)} h` : 'no alcanzada'}` : 'Sin configuración válida'}
            </p>
          </div>
          <Badge tone="solar">Tu propuesta</Badge>
        </div>
      </Panel>

      <div className="wizard-actions">
        <Button variant="quiet" onClick={onBack} icon="chevron">Atrás</Button>
        <Button onClick={onFinish} icon="layers" trailing>Ver resultado detallado</Button>
      </div>
    </>
  );
}
