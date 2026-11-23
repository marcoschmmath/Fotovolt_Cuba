import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import type { Calculation } from '../app/useCalculation';
import { testedAutonomyHours } from '../domain/simulator/analysis';
import { buildQuoteMessage, phoneConfigured, telHref, whatsappHref } from '../domain/config/commercial';
import { unservedEvents } from '../domain/simulator/engine';
import { BatteryRing, EnergyFlow, GenerationChart, SocChart } from '../ui/charts';
import { Badge, Button, Note, Panel, Stat, fmtKwh, fmtMoney, fmtW } from '../ui/components';
import { Icon } from '../ui/icons';

type Tab = 'flujo' | 'generacion' | 'bateria' | 'escenarios' | 'detalles';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'flujo', label: 'Flujo' },
  { id: 'generacion', label: 'Generación' },
  { id: 'bateria', label: 'Batería' },
  { id: 'escenarios', label: 'Escenarios' },
  { id: 'detalles', label: 'Detalles' },
];

export function Result({ calculation, navigate }: { calculation: Calculation; navigate: (path: string) => void }) {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>('flujo');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [quote, setQuote] = useState('');

  const selectedIndex = Math.max(0, calculation.options.findIndex((o) => o.id === state.selectedOptionId));
  const option = calculation.options[selectedIndex];
  const result = calculation.optionResults[selectedIndex];
  const config = option?.config;
  const autonomy = useMemo(() => (config ? testedAutonomyHours(config) : 0), [config]);
  const events = useMemo(
    () => (result ? unservedEvents(result, state.params.stepMinutes) : []),
    [result, state.params.stepMinutes],
  );

  const intervals = result?.intervals ?? [];
  const current = intervals[Math.min(index, Math.max(0, intervals.length - 1))] ?? intervals[0];

  useEffect(() => {
    if (!playing || intervals.length === 0) return;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % intervals.length);
    }, 400);
    return () => window.clearInterval(timer);
  }, [playing, intervals.length]);

  const commercial = state.commercial;
  const dailyKwh = calculation.sizing.energy.dailyKwh;
  const message = buildQuoteMessage({
    dailyKwh,
    peakW: calculation.sizing.energy.peakSimultaneousW,
    autonomyH: autonomy,
    panels: option?.panelCount ?? 0,
    panelW: calculation.panel.powerW,
    batteryKwh: option?.batteryKwh ?? 0,
    inverterW: option?.inverter?.ratedW ?? 0,
    option: option?.label ?? '',
    coverage: result?.totals.coverage ?? 0,
  });

  function requestQuote() {
    setQuote(message);
    if (phoneConfigured(commercial.whatsapp)) {
      window.open(whatsappHref(commercial.whatsapp, message), '_blank', 'noopener');
    }
  }

  if (!config || !result || !current) {
    return (
      <Panel tone="dark">
        <Note level="warning">Todavía no hay una configuración válida. Revisa los equipos y las fichas del catálogo.</Note>
        <Button icon="chevron" onClick={() => navigate('/calcular')}>Volver a la calculadora</Button>
      </Panel>
    );
  }

  return (
    <>
      <div className="result-hero">
        <div className="result-hero__badge"><Icon name="spark" size={26} /></div>
        <div>
          <span className="eyebrow eyebrow--light">{option.label} · resultado detallado</span>
          <h1>Tu instalación, en números</h1>
          <p>Simulación de 24 horas con intervalos de {state.params.stepMinutes} minutos y tus equipos reales.</p>
        </div>
      </div>

      <div className="result-grid">
        <Panel tone="dark">
          <div className="tabs" role="tablist" aria-label="Secciones del resultado">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>

          {tab === 'flujo' && (
            <>
              <EnergyFlow
                interval={current}
                playing={playing}
                onToggle={() => setPlaying(!playing)}
                pvW={option.pvW}
                batteryKwh={option.batteryKwh}
                gridOn={config.grid.available[Math.floor(index) % config.grid.available.length] ?? false}
              />
              <div className="timeline">
                <input type="range" min={0} max={Math.max(0, intervals.length - 1)} value={Math.min(index, intervals.length - 1)} aria-label="Hora de la simulación" onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} />
                <output>{String(Math.floor(current.hour)).padStart(2, '0')}:{String(Math.round((current.hour % 1) * 60)).padStart(2, '0')}</output>
              </div>
              <div className="divider divider--light" />
              <div className="stat-grid stat-grid--four">
                <Stat tone="solar" value={`${Math.round(result.totals.coverage * 100)} %`} label="Cobertura del consumo" />
                <Stat tone="storage" value={`${autonomy.toFixed(1)} h`} label="Autonomía sin sol ni red" />
                <Stat tone="demand" value={fmtKwh(result.totals.unservedKwh)} label="Energía no suministrada" />
                <Stat value={fmtKwh(result.totals.gridKwh)} label="Aportada por la red" />
              </div>
              {events.length > 0 && (
                <Note level="warning" title="Cuando faltó energía">
                  {events.slice(0, 3).map((e) => `${String(Math.floor(e.hour)).padStart(2, '0')}:00 · ${e.cause}`).join(' · ')}
                </Note>
              )}
            </>
          )}

          {tab === 'generacion' && (
            <>
              <GenerationChart intervals={intervals} />
              <div className="divider divider--light" />
              <div className="stat-grid stat-grid--four">
                <Stat tone="solar" value={fmtKwh(result.totals.pvProducedKwh)} label="Producida por los paneles" />
                <Stat value={fmtKwh(result.totals.pvUsedKwh)} label="Aprovechada" />
                <Stat value={fmtKwh(result.totals.pvClippedKwh)} label="Limitada por el inversor" />
                <Stat value={fmtKwh(result.totals.curtailedKwh)} label="Vertida o no aprovechada" />
              </div>
              <Note level="info">La curva usa una forma senoidal cuya área equivale a las horas solares pico configuradas. No es un dato meteorológico medido.</Note>
            </>
          )}

          {tab === 'bateria' && (
            <>
              <div className="row" style={{ marginBottom: '1rem' }}>
                <BatteryRing soc={current.soc} size={110} />
                <div>
                  <strong style={{ fontSize: '1.2rem' }}>{option.batteryKwh.toFixed(1)} kWh instalados</strong>
                  <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: '.25rem 0 0' }}>Mínimo permitido por DoD: {Math.round((1 - calculation.battery.dod) * 100)} %</p>
                </div>
              </div>
              <SocChart intervals={intervals} minSoc={Math.max(state.params.minSoc, 1 - calculation.battery.dod)} />
              <Note level="info" title="Tiempo estimado de recarga completa">
                Desde el mínimo permitido hasta el 100 %: {calculation.recharge.withGrid !== null ? `${calculation.recharge.withGrid.toFixed(1)} h con sol y red` : 'no se alcanza con sol y red'} · {calculation.recharge.solarOnly !== null ? `${calculation.recharge.solarOnly.toFixed(1)} h sólo con paneles` : 'no se alcanza sólo con paneles'}. Es un promedio del modelo, no una garantía.
              </Note>
              <div className="divider divider--light" />
              <div className="stat-grid stat-grid--four">
                <Stat tone="storage" value={fmtKwh(result.totals.batteryChargeKwh)} label="Energía cargada" />
                <Stat value={fmtKwh(result.totals.batteryDischargeKwh)} label="Energía extraída" />
                <Stat value={`${(result.totals.minSoc * 100).toFixed(0)} %`} label="SOC mínimo alcanzado" />
                <Stat value={`${autonomy.toFixed(1)} h`} label="Autonomía crítica" />
              </div>
            </>
          )}

          {tab === 'escenarios' && (
            <>
              {calculation.scenarios.map(({ scenario, result: scenarioResult }) => (
                <div key={scenario.id} style={{ borderBottom: '1px solid var(--line-light)', padding: '.8rem 0' }}>
                  <div className="row--between">
                    <strong>{scenario.label}</strong>
                    <Badge tone={scenario.id === 'habitual' ? 'solar' : 'neutral'}>{Math.round(scenarioResult.totals.coverage * 100)} % cobertura</Badge>
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '.35rem 0' }}>{scenario.description}</p>
                  <div className="row row--wrap" style={{ gap: '1rem', fontSize: '.75rem', color: 'var(--ink)' }}>
                    <span>{fmtKwh(scenarioResult.totals.pvProducedKwh)} producidos</span>
                    <span>{fmtKwh(scenarioResult.totals.unservedKwh)} sin suministrar</span>
                  </div>
                  <ul style={{ color: 'var(--muted)', fontSize: '.7rem', paddingLeft: '1.1rem', margin: '.5rem 0 0' }}>
                    {scenario.assumptions.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                </div>
              ))}
              <Note level="warning">Son escenarios ilustrativos para explorar incertidumbre, no probabilidades ni pronósticos estadísticos.</Note>
            </>
          )}

          {tab === 'detalles' && (
            <div style={{ fontSize: '.82rem', color: 'var(--ink)' }}>
              <h3 style={{ color: 'var(--ink)' }}>Datos que introdujiste</h3>
              <p>{state.appliances.length} equipos · {dailyKwh.toFixed(2)} kWh/día · {state.gridInput.hoursPerDay} h de red · {state.installationType === 'hybrid' ? 'instalación híbrida' : 'instalación aislada'} · {state.gridInput.voltage === 'both' ? '110 V y 220 V' : `${state.gridInput.voltage} V`}.</p>
              <h3 style={{ color: 'var(--ink)', marginTop: '1.2rem' }}>Hipótesis utilizadas</h3>
              <p>HSP {state.params.hsp.toFixed(2)} h · eficiencia global {Math.round(state.params.systemEfficiency * 100)} % · inversor {Math.round(state.params.inverterEfficiency * 100)} % · DoD {Math.round(state.params.dod * 100)} % · factor de seguridad ×{state.params.safetyFactor.toFixed(2)} · sombras {Math.round(state.params.shading * 100)} %.</p>
              <h3 style={{ color: 'var(--ink)', marginTop: '1.2rem' }}>Fórmulas principales</h3>
              <p className="mono" style={{ fontSize: '.74rem' }}>
                E_d = Σ(Pᵢ·nᵢ·hᵢ)/1000 · E_n = Σ(Pᵢ·nᵢ·hᵢ,noche)/1000<br />
                C_b = E_n·A / (DoD·η) · P_FV = E_d·F / (HSP·η_sistema)
              </p>
              <h3 style={{ color: 'var(--ink)', marginTop: '1.2rem' }}>Procedencia de los datos solares</h3>
              <p>Los perfiles de irradiación se generan con el HSP configurable del usuario. No se usan datos meteorológicos de localidades cubanas no verificados. Para un diseño real se necesita una serie meteorológica contrastada.</p>
              <h3 style={{ color: 'var(--ink)', marginTop: '1.2rem' }}>Limitaciones</h3>
              <p>Modelo de intervalos discretos con pérdidas agregadas. No modela envejecimiento, fallos, cableado detallado ni protecciones. No constituye un diseño eléctrico certificado.</p>
              <div className="divider divider--light" />
              <h3 style={{ color: 'var(--ink)' }}>Alertas y cuellos de botella</h3>
              <ul className="diagnostic-list">
                {calculation.bottlenecks.map((d, i) => (
                  <li key={`${d.code}-${i}`} className={`is-${d.level}`}><Icon name={d.level === 'info' ? 'info' : 'warning'} size={15} /><span>{d.message}</span></li>
                ))}
              </ul>
              {option.price !== undefined && <p style={{ marginTop: '1rem' }}>Precio orientativo de la configuración: <strong>{fmtMoney(option.price, option.currency)}</strong> (sólo equipos, sin mano de obra).</p>}
            </div>
          )}
        </Panel>

        <div>
          <Panel tone="dark">
            <h3 style={{ color: 'var(--ink)' }}>Tu configuración</h3>
            <div className="stack" style={{ gap: '.8rem', marginTop: '1rem' }}>
              <div className="row"><span className="list-row__icon"><Icon name="sun" size={19} /></span><div className="list-row__main"><strong>{option.panelCount} paneles</strong><span>{calculation.panel.model} · {fmtW(option.pvW)}</span></div></div>
              <div className="row"><span className="list-row__icon"><Icon name="battery" size={19} /></span><div className="list-row__main"><strong>{option.batteryKwh.toFixed(1)} kWh</strong><span>{calculation.battery.model}</span></div></div>
              <div className="row"><span className="list-row__icon"><Icon name="inverter" size={19} /></span><div className="list-row__main"><strong>{option.inverter ? fmtW(option.inverter.ratedW) : '—'}</strong><span>{option.inverter?.model ?? 'Sin inversor compatible'}</span></div></div>
            </div>
            <Button variant="quiet" full icon="chevron" onClick={() => navigate('/calcular')} style={{ marginTop: '1.1rem' }}>Modificar mi diseño</Button>
          </Panel>

          {calculation.sizing.diagnostics.length > 0 && (
            <Panel tone="dark">
              <h3 style={{ color: 'var(--ink)' }}>Antes de decidir</h3>
              <ul className="diagnostic-list">
                {calculation.sizing.diagnostics.slice(0, 4).map((d, i) => (
                  <li key={`${d.code}-${i}`} className={`is-${d.level}`}><Icon name={d.level === 'info' ? 'info' : 'warning'} size={15} /><span>{d.message}</span></li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <section className="commercial">
        <span className="eyebrow" style={{ color: 'var(--forest-700)' }}>Contratar instalación</span>
        <h2>¿Quieres instalar este sistema en tu vivienda?</h2>
        <p>Puedo ayudarte a seleccionar los equipos adecuados, diseñar tu instalación y realizar el montaje completo. Contáctame para recibir una propuesta personalizada.</p>
        <div className="commercial__actions">
          <Button variant="dark" icon="phone" disabled={!phoneConfigured(commercial.phone)} onClick={() => window.open(telHref(commercial.phone), '_self')}>Llamar ahora</Button>
          <Button variant="dark" icon="whatsapp" disabled={!phoneConfigured(commercial.whatsapp)} onClick={() => window.open(whatsappHref(commercial.whatsapp, message), '_blank', 'noopener')}>WhatsApp</Button>
          <Button variant="dark" icon="doc" className="btn--quote" onClick={requestQuote}>Solicitar presupuesto</Button>
        </div>
        {!phoneConfigured(commercial.phone) && (
          <Note level="warning" title="Falta configurar el contacto">Añade tu número real en la sección Contacto para activar los botones de llamada y WhatsApp.</Note>
        )}
        {quote && (
          <>
            <div className="quote-box" aria-live="polite">{quote}</div>
            <div className="row" style={{ marginTop: '.6rem' }}>
              <Button variant="dark" icon="share" onClick={() => { void navigator.clipboard?.writeText(quote); }}>Copiar resumen</Button>
              {phoneConfigured(commercial.whatsapp) && <Button variant="dark" icon="whatsapp" onClick={() => window.open(whatsappHref(commercial.whatsapp, quote), '_blank', 'noopener')}>Enviar por WhatsApp</Button>}
            </div>
          </>
        )}
      </section>
    </>
  );
}
