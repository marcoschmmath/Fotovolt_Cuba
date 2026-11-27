import { useEffect, useMemo, useState } from 'react';
import { EnergyDiagram } from './EnergyDiagram';
import type { EnergyFlowFrame } from './energyFlow';
import { formatPower, frameTotals } from './energyFlow';
import './SimulationPlayer.css';

/**
 * Reproductor de la simulación: solo cambia el ÍNDICE del frame.
 * No vuelve a ejecutar el motor en cada tick.
 * Pasa `frames` memoizado (useMemo): si cambia su identidad, vuelve al inicio.
 */

export type PlaybackSpeed = 1 | 2 | 4 | 8;
const SPEEDS: readonly PlaybackSpeed[] = [1, 2, 4, 8];

const ICON_PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  restart:
    'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
} as const;

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' ? Boolean(window.matchMedia?.(query).matches) : false,
  );

  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return undefined;
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export interface SimulationPlayerProps {
  frames: EnergyFlowFrame[];
  /** Duración de cada frame a velocidad 1× (ms). 2× = la mitad, etc. */
  baseTickMs?: number;
  initialSpeed?: PlaybackSpeed;
  autoPlay?: boolean;
  className?: string;
}

export function SimulationPlayer({
  frames,
  baseTickMs = 320,
  initialSpeed = 2,
  autoPlay = false,
  className,
}: SimulationPlayerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const last = frames.length - 1;

  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialSpeed);
  const [playing, setPlaying] = useState(autoPlay && !reducedMotion);

  // Nueva simulación → vuelve al principio.
  useEffect(() => {
    setIndex(0);
  }, [frames]);

  // Reloj de reproducción.
  useEffect(() => {
    if (!playing || last < 1) return undefined;
    const id = window.setInterval(
      () => setIndex((i) => Math.min(i + 1, last)),
      baseTickMs / speed,
    );
    return () => window.clearInterval(id);
  }, [playing, speed, baseTickMs, last]);

  // Al llegar al último frame, se detiene.
  useEffect(() => {
    if (playing && index >= last) setPlaying(false);
  }, [playing, index, last]);

  // Misma escala de grosor en todos los frames de la corrida.
  const referencePowerW = useMemo(() => {
    let max = 0;
    for (const f of frames) {
      const t = frameTotals(f);
      max = Math.max(max, t.pvProductionDcW, t.gridImportAcW, t.loadServedAcW, t.batteryChargeStoredW, t.batteryToLoadAcW);
    }
    return Math.max(1000, Math.ceil(max / 500) * 500);
  }, [frames]);

  const frame = frames[Math.min(index, Math.max(last, 0))];
  if (!frame) {
    return <p className="sim-player__empty">No hay datos de simulación para mostrar.</p>;
  }

  const totals = frameTotals(frame);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  const step = (delta: number) => {
    setPlaying(false);
    setIndex((i) => Math.min(Math.max(i + delta, 0), last));
  };

  const rootClass = ['sim-player', className].filter(Boolean).join(' ');

  return (
    <section className={rootClass} aria-label="Reproductor de la simulación">
      <EnergyDiagram
        frame={frame}
        referencePowerW={referencePowerW}
        animated={playing && !reducedMotion}
      />

      <dl className="sim-player__stats">
        <div className="sim-stat">
          <dt>Generación PV · DC</dt>
          <dd>{formatPower(totals.pvProductionDcW)}</dd>
        </div>
        <div className="sim-stat">
          <dt>Demanda servida · AC</dt>
          <dd>{formatPower(totals.loadServedAcW)}</dd>
        </div>
        <div className="sim-stat">
          <dt>Batería</dt>
          <dd>{Math.round(totals.socPct)} %</dd>
        </div>
      </dl>

      <section className="sim-active-loads" aria-live="polite" aria-label="Equipos programados en este intervalo">
        <div className="sim-active-loads__head">
          <strong>Equipos encendidos ahora</strong>
          <span>{frame.activeLoads?.length ?? 0}</span>
        </div>
        {frame.activeLoads?.length ? (
          <ul>
            {frame.activeLoads.map((load) => (
              <li key={`${load.kind}-${load.id}`}>
                <span>{load.name}</span>
                <strong>{formatPower(load.powerW)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay equipos programados en este intervalo.</p>
        )}
        {totals.loadUnservedAcW >= 1 && (
          <p className="sim-active-loads__warning">
            Parte de la demanda de este intervalo no pudo suministrarse. La lista muestra los equipos que la vivienda solicita, no garantiza que todos reciban energía.
          </p>
        )}
        <small>Potencia media estimada durante el intervalo de 15 minutos.</small>
      </section>

      <div className="sim-player__time">
        <output className="sim-player__clock" aria-live="off">
          {frame.time}
        </output>
        <span className="sim-player__progress">
          Intervalo {Math.min(index, Math.max(last, 0)) + 1} de {frames.length}
        </span>
      </div>

      <input
        className="sim-slider"
        type="range"
        min={0}
        max={Math.max(last, 0)}
        step={1}
        value={Math.min(index, Math.max(last, 0))}
        aria-label="Hora simulada"
        aria-valuetext={frame.time}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
      />

      <div className="sim-player__controls">
        <div className="sim-player__transport" role="group" aria-label="Controles de reproducción">
          <button type="button" className="sim-btn" onClick={() => setIndex(0)} aria-label="Volver al inicio">
            <Icon name="restart" />
          </button>
          <button
            type="button"
            className="sim-btn"
            onClick={() => step(-1)}
            disabled={index <= 0}
            aria-label="Intervalo anterior"
          >
            <Icon name="prev" />
          </button>
          <button
            type="button"
            className="sim-btn sim-btn--primary"
            onClick={togglePlay}
            aria-label={playing ? 'Pausar' : 'Reproducir'}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button
            type="button"
            className="sim-btn"
            onClick={() => step(1)}
            disabled={index >= last}
            aria-label="Intervalo siguiente"
          >
            <Icon name="next" />
          </button>
        </div>

        <div className="sim-player__speed" role="group" aria-label="Velocidad de reproducción">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className="sim-btn sim-btn--text"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
