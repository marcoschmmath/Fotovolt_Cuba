import type { CSSProperties } from 'react';
import { useApp } from '../app/AppContext';
import { useInstallPrompt } from '../app/useInstallPrompt';
import { Button, Panel, SectionTitle, SwipePages } from '../ui/components';
import { Icon, type IconName } from '../ui/icons';

function SunField() {
  return (
    <svg className="hero__rays" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="92" r="42" fill="none" stroke="var(--lime-ink)" strokeWidth="1.4" opacity=".65" />
      <circle cx="100" cy="92" r="56" fill="none" stroke="var(--lime-ink)" strokeWidth="1.2" opacity=".3" />
      <circle cx="100" cy="92" r="70" fill="none" stroke="var(--lime-ink)" strokeWidth="1.2" opacity=".18" />
      {Array.from({ length: 16 }, (_, i) => {
        const angle = (i * Math.PI * 2) / 16;
        const x1 = 100 + Math.cos(angle) * 46;
        const y1 = 92 + Math.sin(angle) * 46;
        const x2 = 100 + Math.cos(angle) * (i % 2 ? 62 : 75);
        const y2 = 92 + Math.sin(angle) * (i % 2 ? 62 : 75);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--lime-ink)" strokeWidth="1.6" opacity=".5" />;
      })}
      <g transform="translate(28 128) skewX(-14)">
        <rect width="144" height="52" rx="3" fill="rgba(18,69,54,.12)" stroke="var(--forest-800)" strokeOpacity=".45" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line key={`v${i}`} x1={(i + 1) * 24} y1="0" x2={(i + 1) * 24} y2="52" stroke="var(--forest-800)" strokeOpacity=".28" />
        ))}
        <line x1="0" y1="26" x2="144" y2="26" stroke="var(--forest-800)" strokeOpacity=".28" />
      </g>
    </svg>
  );
}

interface GuideStep {
  icon: IconName;
  title: string;
  text: string;
  step: number;
}

export function Home({ navigate }: { navigate: (path: string) => void }) {
  const { state, patch } = useApp();
  const install = useInstallPrompt();

  function goToStep(step: number) {
    patch({ wizardStep: step });
    navigate('/calcular');
  }

  const guide: GuideStep[] = [
    { icon: 'plug', title: 'Cuenta tus equipos', text: 'Elige los electrodomésticos y dinos cuánto tiempo los usas, de día o de noche.', step: 1 },
    { icon: 'bolt', title: 'Simula tu apagón', text: 'Introduce las horas de luz que tienes y cuánto tiempo quieres aguantar sin red.', step: 2 },
    { icon: 'layers', title: 'Compara y decide', text: 'Mira tres tamaños distintos, su autonomía real y elige el que mejor te conviene.', step: 4 },
  ];

  return (
    <>
      <section className="hero">
        <SunField />
        <div className="hero__content">
          <span className="hero__tag"><Icon name="sun" size={14} /> Hecho para la realidad de Cuba</span>
          <h1>Calcula tu instalación solar ideal</h1>
          <p className="hero__sub">Descubre cuántos paneles y baterías necesitas para tener electricidad incluso durante los apagones.</p>
          <div className="hero__actions">
            <Button icon="chevron" trailing onClick={() => goToStep(1)}>Diseñar mi instalación</Button>
            <Button variant="outline" icon="shield" onClick={() => navigate('/oferta')}>Comprobar una oferta</Button>
          </div>
          <div className="hero__meta">
            <span><Icon name="check" size={14} /> Sin cuentas</span>
            <span><Icon name="check" size={14} /> Funciona offline</span>
            <span><Icon name="check" size={14} /> Tú eliges los equipos</span>
          </div>
        </div>
      </section>

      {install.available && (
        <Panel tone="green">
          <div className="row--between row">
            <div>
              <strong>Instálala en tu teléfono</strong>
              <p style={{ margin: '0.25rem 0 0', fontSize: '.82rem', opacity: .8 }}>La tendrás en la pantalla de inicio y funcionará sin internet.</p>
            </div>
            <Button variant="outline" icon="plus" onClick={() => void install.install()}>Instalar</Button>
          </div>
        </Panel>
      )}

      <SectionTitle eyebrow="Guía rápida" title="De tu consumo a tu instalación" description="Desliza para ver los tres pasos. Toca cualquier tarjeta para ir directamente ahí." />

      <SwipePages
        items={guide}
        label="Pasos de la calculadora"
        render={(item) => (
          <button type="button" className="guide-card" onClick={() => goToStep(item.step)}>
            <span className="guide-card__icon"><Icon name={item.icon} size={24} /></span>
            <strong>{item.title}</strong>
            <span className="guide-card__text">{item.text}</span>
            <span className="guide-card__cta">Ir a este paso <Icon name="chevron" size={14} /></span>
          </button>
        )}
      />

      <SectionTitle eyebrow="Transparencia" title="No es una promesa, es una simulación" />
      <Panel tone="paper">
        <p style={{ color: 'var(--muted)', fontSize: '.88rem', marginBottom: '1.1rem' }}>
          La calculadora reproduce tu vivienda en intervalos de 15 minutos: cuánto produce el sol, cuánto consume cada equipo, cuándo se carga la batería y cuándo falta energía. Así ves el rendimiento esperable antes de invertir.
        </p>
        <div className="stat-grid stat-grid--four">
          <div className="stat"><strong>96</strong><span>intervalos por día</span></div>
          <div className="stat"><strong>3</strong><span>escenarios climáticos</span></div>
          <div className="stat"><strong>3</strong><span>opciones comparadas</span></div>
        </div>
      </Panel>

      {state.recent.length > 0 && (
        <>
          <SectionTitle eyebrow="En este dispositivo" title="Cálculos recientes" />
          <Panel tone="paper">
            {state.recent.map((item) => (
              <div className="list-row" key={item.id}>
                <div className="list-row__icon"><Icon name="layers" size={19} /></div>
                <div className="list-row__main">
                  <strong>{item.label} · {item.panelCount} paneles · {item.batteryKwh.toFixed(1)} kWh</strong>
                  <span>{new Date(item.date).toLocaleString('es-CU', { dateStyle: 'medium', timeStyle: 'short' })} · cobertura {Math.round(item.coverage * 100)} %</span>
                </div>
                <Button variant="quiet" onClick={() => { patch({ selectedOptionId: item.optionId }); navigate('/resultado'); }}>Ver</Button>
              </div>
            ))}
          </Panel>
        </>
      )}

      <Panel tone="paper" style={{ marginTop: '1rem' } as CSSProperties}>
        <div className="installer-card">
          <div className="installer-card__logo">
            {state.commercial.logoDataUrl ? <img src={state.commercial.logoDataUrl} alt="Logotipo del instalador" /> : <Icon name="sun" size={24} />}
          </div>
          <div style={{ flex: 1 }}>
            <h3>{state.commercial.businessName}</h3>
            <p>{state.commercial.services}</p>
          </div>
        </div>
        <div style={{ marginTop: '0.9rem' }}>
          <Button variant="quiet" full icon="contact" onClick={() => navigate('/contacto')}>Ver contacto y servicios</Button>
        </div>
      </Panel>

      <p style={{ fontSize: '.72rem', color: 'var(--muted)', textAlign: 'center', marginTop: '1.4rem' }}>
        Estimación preliminar. Requiere estudio técnico presencial antes de la instalación.
      </p>
    </>
  );
}
