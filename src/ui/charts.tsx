import type { IntervalResult } from '../domain/core/types';
import { Icon } from './icons';

const CHART_W = 340;
const CHART_H = 150;

/**
 * Hora legible. Antes se hacía `floor(h)` + `round((h%1)*60)` por separado y
 * un intervalo como 23,999 h imprimía «23:60». Aquí se redondean los minutos
 * totales y se normaliza el acarreo a la hora siguiente.
 */
export function formatHour(hour: number): string {
  const totalMinutes = Math.round(hour * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function points(values: number[], max: number, width = CHART_W, height = CHART_H) {
  const count = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = (index / count) * width;
    const y = height - (Math.max(0, Math.min(max, value)) / max) * height;
    return [x, y] as const;
  });
}

function toPath(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function areaPath(pts: ReadonlyArray<readonly [number, number]>, height = CHART_H): string {
  if (!pts.length) return '';
  return `${toPath(pts)} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
}

export function GenerationChart({ intervals, startHour = 0 }: { intervals: IntervalResult[]; startHour?: number }) {
  const pv = points(intervals.map((i) => i.pvAcW), Math.max(1, ...intervals.map((i) => Math.max(i.pvAcW, i.demandW))) * 1.1);
  const demand = points(intervals.map((i) => i.demandW), Math.max(1, ...intervals.map((i) => Math.max(i.pvAcW, i.demandW))) * 1.1);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 22}`} role="img" aria-label={`Generación fotovoltaica y demanda eléctrica desde ${formatHour(startHour)} hasta ${formatHour(startHour + 24)} del día siguiente`}>
        <defs>
          <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--lime)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={CHART_W} y1={CHART_H * f} y2={CHART_H * f} className="chart__grid" />
        ))}
        <path d={areaPath(pv)} fill="url(#pvFill)" />
        <path d={toPath(pv)} className="chart__line chart__line--pv" />
        <path d={toPath(demand)} className="chart__line chart__line--demand" />
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={(h / 24) * CHART_W} y={CHART_H + 16} className="chart__axis" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {formatHour(startHour + h)}
          </text>
        ))}
      </svg>
      <div className="chart__legend">
        <span><i className="dot dot--solar" /> Generación solar</span>
        <span><i className="dot dot--demand" /> Demanda</span>
      </div>
    </div>
  );
}

export function SocChart({ intervals, minSoc, startHour = 0 }: { intervals: IntervalResult[]; minSoc: number; startHour?: number }) {
  const max = 1;
  const pts = points(intervals.map((i) => i.soc), max);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 22}`} role="img" aria-label={`Estado de carga de la batería desde ${formatHour(startHour)} hasta ${formatHour(startHour + 24)} del día siguiente`}>
        <defs>
          <linearGradient id="socFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--storage)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--storage)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={CHART_W} y1={CHART_H * f} y2={CHART_H * f} className="chart__grid" />
        ))}
        <line x1="0" x2={CHART_W} y1={CHART_H - minSoc * CHART_H} y2={CHART_H - minSoc * CHART_H} className="chart__limit" />
        <path d={areaPath(pts)} fill="url(#socFill)" />
        <path d={toPath(pts)} className="chart__line chart__line--soc" />
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={(h / 24) * CHART_W} y={CHART_H + 16} className="chart__axis" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {formatHour(startHour + h)}
          </text>
        ))}
      </svg>
      <div className="chart__legend">
        <span><i className="dot dot--storage" /> Estado de carga</span>
        <span><i className="dot dot--limit" /> Mínimo permitido</span>
      </div>
    </div>
  );
}

export function BatteryRing({ soc, size = 96 }: { soc: number; size?: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, soc));
  return (
    <div className="battery-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="battery-ring__track" />
        <circle
          cx="50" cy="50" r={radius}
          className="battery-ring__value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="battery-ring__label">
        <strong>{Math.round(clamped * 100)}%</strong>
        <span>carga</span>
      </div>
    </div>
  );
}

interface FlowProps {
  interval: IntervalResult;
  playing: boolean;
  onToggle: () => void;
  pvW: number;
  batteryKwh: number;
  gridOn: boolean;
}

/** Pieza central de la pantalla de resultados: flujo de energía en un instante. */
export function EnergyFlow({ interval, playing, onToggle, pvW, batteryKwh, gridOn }: FlowProps) {
  const pv = interval.pvAcW;
  // Unidades: todo aquí son VATIOS (W), medidos en el mismo instante.
  //   · `servedW` cubre la demanda; sus fuentes son PV directo, batería y red.
  //   · `gridW` es importación TOTAL (carga + recarga de batería), así que para
  //    aislar la parte que alimenta la casa hay que usar `gridToLoadW`. Con
  //    `gridW` el resultado salía negativo siempre que la red recargaba la
  //    batería y el SVG acababa con `stroke-width` negativo (M4).
  const toHome = Math.max(
    0,
    interval.servedW - interval.gridToLoadW - interval.batteryDischargeAcW,
  );
  const toBattery = interval.batteryChargeW;
  const fromBattery = interval.batteryDischargeAcW;
  const fromGrid = interval.gridW;
  // Grosor acotado: nunca negativo ni desproporcionado.
  const thickness = (w: number) => 1.5 + Math.min(5, Math.max(0, w) / 600);
  const flow = (w: number) => (w > 1 ? 1 : 0.12);

  return (
    <div className={`energy-flow ${playing ? '' : 'energy-flow--paused'}`}>
      <div className="energy-flow__head">
        <div>
          <span className="eyebrow eyebrow--light">Flujo de energía</span>
          <h3>{formatHour(interval.hour)} h</h3>
        </div>
        <button type="button" className="flow-toggle" onClick={onToggle} aria-label={playing ? 'Pausar animación del flujo' : 'Reproducir animación del flujo'}>
          <Icon name={playing ? 'pause' : 'play'} size={17} />
          {playing ? 'Pausar' : 'Reproducir'}
        </button>
      </div>
      <svg viewBox="0 0 360 270" role="img" aria-label={`Energía solar ${Math.round(pv)} vatios, consumo ${Math.round(interval.demandW)} vatios, batería ${Math.round(interval.soc * 100)} por ciento`}>
        <defs>
          <linearGradient id="flowPv" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--lime)" />
            <stop offset="100%" stopColor="var(--sun)" />
          </linearGradient>
        </defs>
        <g className="flow-lines">
          <path d="M92 63 C120 63 130 88 152 100" className="flow-line flow-line--pv" style={{ strokeWidth: thickness(pv), opacity: flow(pv) }} />
          <path d="M208 100 C240 88 250 62 282 62" className="flow-line flow-line--home" style={{ strokeWidth: thickness(toHome), opacity: flow(toHome) }} />
          <path d="M176 124 C160 155 130 172 106 192" className="flow-line flow-line--store" style={{ strokeWidth: thickness(toBattery), opacity: flow(toBattery) }} />
          <path d="M106 192 C130 172 160 155 176 124" className="flow-line flow-line--battery" style={{ strokeWidth: thickness(fromBattery), opacity: flow(fromBattery) }} />
          <path d="M282 216 C255 210 240 165 210 122" className="flow-line flow-line--grid" style={{ strokeWidth: thickness(fromGrid), opacity: flow(fromGrid) }} />
        </g>

        <g className="flow-node" transform="translate(24,26)">
          <rect width="86" height="62" rx="12" className="flow-node__box" />
          <Icon name="sun" size={22} x={12} y={10} style={{ color: 'var(--lime)' }} />
          <text x="42" y="24" className="flow-node__label">Paneles</text>
          <text x="42" y="44" className="flow-node__value">{Math.round(pvW / 1000)} kWp</text>
          <text x="12" y="57" className="flow-node__sub">{Math.round(pv)} W ahora</text>
        </g>

        <g className="flow-node" transform="translate(142,72)">
          <rect width="72" height="62" rx="12" className="flow-node__box flow-node__box--accent" />
          <Icon name="inverter" size={22} x={25} y={8} style={{ color: 'var(--lime)' }} />
          <text x="36" y="46" className="flow-node__label" textAnchor="middle">Inversor</text>
          <text x="36" y="58" className="flow-node__sub" textAnchor="middle">AC</text>
        </g>

        <g className="flow-node" transform="translate(270,26)">
          <rect width="70" height="62" rx="12" className="flow-node__box" />
          <Icon name="house" size={22} x={10} y={10} style={{ color: 'var(--demand)' }} />
          <text x="36" y="46" className="flow-node__label" textAnchor="middle">Casa</text>
          <text x="36" y="58" className="flow-node__sub" textAnchor="middle">{Math.round(interval.demandW)} W</text>
        </g>

        <g className="flow-node" transform="translate(36,182)">
          <rect width="88" height="66" rx="12" className="flow-node__box" />
          <rect x="12" y="12" width="24" height="38" rx="4" className="flow-batt__shell" />
          <rect x="15" y={15 + (32 - 32 * interval.soc)} width="18" height={32 * interval.soc} rx="2" className="flow-batt__fill" />
          <text x="44" y="24" className="flow-node__label">Batería</text>
          <text x="44" y="43" className="flow-node__value">{batteryKwh.toFixed(1)} kWh</text>
          <text x="44" y="58" className="flow-node__sub">{Math.round(interval.soc * 100)} % · {Math.round(toBattery || fromBattery)} W</text>
        </g>

        <g className="flow-node" transform="translate(270,182)">
          <rect width="70" height="66" rx="12" className="flow-node__box" />
          <Icon name="grid" size={22} x={24} y={8} style={{ color: gridOn ? 'var(--grid)' : '#64756e' }} />
          <text x="35" y="44" className="flow-node__label" textAnchor="middle">Red</text>
          <text x="35" y="58" className="flow-node__sub" textAnchor="middle">{gridOn ? `${Math.round(fromGrid)} W` : 'sin servicio'}</text>
        </g>
      </svg>
      <div className="energy-flow__foot">
        <span><i className="dot dot--solar" /> Solar</span>
        <span><i className="dot dot--storage" /> Batería</span>
        <span><i className="dot dot--grid" /> Red</span>
      </div>
    </div>
  );
}

export function CompareBars({ rows, unit, max }: { rows: Array<{ label: string; value: number; note?: string; key: string }>; unit: string; max?: number }) {
  const top = max ?? Math.max(0.0001, ...rows.map((r) => r.value));
  return (
    <div className="compare-bars">
      {rows.map((row) => (
        <div className="compare-bars__row" key={row.key}>
          <div className="compare-bars__label">{row.label}</div>
          <div className="compare-bars__track">
            <div className="compare-bars__fill" style={{ width: `${Math.max(2, (row.value / top) * 100)}%` }} />
          </div>
          <div className="compare-bars__value">{row.value.toFixed(1)} {unit}{row.note && <small>{row.note}</small>}</div>
        </div>
      ))}
    </div>
  );
}
