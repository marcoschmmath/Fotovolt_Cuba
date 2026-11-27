import { useId } from 'react';
import type { ReactNode } from 'react';
import type { EnergyFlowFrame, FrameTotals } from './energyFlow';
import { describeFrame, formatPower, frameTotals } from './energyFlow';
import './EnergyDiagram.css';

/**
 * Diagrama de flujo de energía (React + SVG + CSS).
 * Solo DIBUJA el frame que recibe: no calcula balances ni ejecuta el motor.
 *
 * Cada conexión visual corresponde a una magnitud independiente del motor:
 * PV→cargas, red→cargas, PV→batería, red→batería y batería→cargas.
 * Las rutas pasan por el inversor cuando corresponde, pero no agregan cifras
 * medidas en fronteras AC, DC y de almacenamiento distintas.
 */

type FlowColor = 'pv' | 'grid' | 'battery';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VIEW_W = 380;
const VIEW_H = 420;

const RECTS = {
  pv: { x: 18, y: 24, w: 94, h: 76 },
  grid: { x: 268, y: 24, w: 94, h: 76 },
  inverter: { x: 145, y: 166, w: 90, h: 72 },
  battery: { x: 18, y: 322, w: 94, h: 76 },
  home: { x: 268, y: 322, w: 94, h: 76 },
} satisfies Record<string, Rect>;

/** Por debajo de esto una línea se considera inactiva. */
const MIN_ACTIVE_W = 1;

interface FlowDef {
  id: string;
  color: FlowColor;
  /** Cada tramo se dibuja por separado para que tenga su propia flecha de dirección. */
  paths: string[];
  label: { x: number; y: number };
  watts: number;
}

function buildFlows(t: FrameTotals): FlowDef[] {
  return [
    // PV → vivienda: entra al inversor por la izquierda y sale por un carril superior.
    { id: 'pv-load', color: 'pv', paths: ['M 112 62 H 132 V 180 H 145', 'M 235 180 H 244 V 350 H 268'], label: { x: 247, y: 329 }, watts: t.pvToLoadAcW },
    // Red → vivienda: bypass AC exterior, sin cruzar las rutas DC.
    { id: 'grid-load', color: 'grid', paths: ['M 362 62 H 374 V 390 H 362'], label: { x: 350, y: 238 }, watts: t.gridToLoadAcW },
    // PV → batería: conexión DC directa por el corredor exterior izquierdo.
    { id: 'pv-battery', color: 'pv', paths: ['M 18 62 H 8 V 360 H 18'], label: { x: 38, y: 230 }, watts: t.pvToBatteryStoredW },
    // Red → batería: entrada AC al inversor/cargador y salida DC por un carril inferior propio.
    { id: 'grid-battery', color: 'grid', paths: ['M 268 76 H 252 V 206 H 235', 'M 145 206 H 118 V 306 H 80 V 322'], label: { x: 91, y: 291 }, watts: t.gridToBatteryAcW },
    // Batería → vivienda: sube al inversor por el lado inferior y sale por un carril distinto al PV.
    { id: 'battery-load', color: 'battery', paths: ['M 112 360 H 136 V 224 H 145', 'M 235 224 H 258 V 370 H 268'], label: { x: 292, y: 300 }, watts: t.batteryToLoadAcW },
  ];
}

const FLOW_COLORS: readonly FlowColor[] = ['pv', 'grid', 'battery'];

/** Grosor 2.5–8 según la potencia respecto a la referencia. */
function strokeFor(watts: number, referenceW: number): number {
  const ratio = Math.min(watts / Math.max(referenceW, 1), 1);
  return 2.5 + ratio * 5.5;
}

/* ---------- Iconos (caben en ±13 unidades alrededor de 0,0) ---------- */

function PanelIcon() {
  return (
    <g className="ed-icon">
      <path d="M -13 9 L -8 -9 L 13 -9 L 8 9 Z" />
      <path d="M -1 -9 L -6 9 M 6 -9 L 1 9 M -10.5 0 L 10.5 0" />
    </g>
  );
}

function BoltIcon() {
  return (
    <g className="ed-icon">
      <path d="M 3 -12 L -7 2 H -1 L -3 12 L 8 -3 H 2 Z" />
    </g>
  );
}

function InverterIcon() {
  return (
    <g className="ed-icon">
      <rect x={-13} y={-9} width={26} height={18} rx={3} />
      <path d="M -8 0 q 4 -7 8 0 t 8 0" />
    </g>
  );
}

function BatteryIcon({ socPct }: { socPct: number }) {
  const level = (Math.max(0, Math.min(100, socPct)) / 100) * 18;
  return (
    <g className="ed-icon">
      <rect x={-8} y={-10} width={16} height={22} rx={3} />
      <rect x={-3} y={-13.5} width={6} height={3.5} rx={1} />
      <rect
        className={socPct <= 25 ? 'ed-battery-fill ed-battery-fill--low' : 'ed-battery-fill'}
        x={-6}
        y={10 - level}
        width={12}
        height={level}
        rx={1.5}
      />
    </g>
  );
}

function HouseIcon() {
  return (
    <g className="ed-icon">
      <path d="M -13 1 L 0 -11 L 13 1" />
      <path d="M -9 -2 V 11 H 9 V -2" />
      <path d="M -2.5 11 V 4 H 2.5 V 11" />
    </g>
  );
}

/* ---------- Piezas ---------- */

interface NodeProps {
  rect: Rect;
  label: string;
  value?: string;
  dimmed?: boolean;
  icon: ReactNode;
}

function Node({ rect, label, value, dimmed = false, icon }: NodeProps) {
  const cx = rect.x + rect.w / 2;
  return (
    <g className={dimmed ? 'ed-node ed-node--dim' : 'ed-node'}>
      <rect className="ed-node__bg" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={16} />
      <g transform={`translate(${cx} ${rect.y + 24})`}>{icon}</g>
      <text className="ed-node__label" x={cx} y={rect.y + 52}>
        {label}
      </text>
      {value !== undefined && (
        <text className="ed-node__value" x={cx} y={rect.y + 65}>
          {value}
        </text>
      )}
    </g>
  );
}

function FlowLabel({ x, y, watts }: { x: number; y: number; watts: number }) {
  const text = formatPower(watts);
  const width = 16 + text.length * 6;
  return (
    <g className="ed-pill" transform={`translate(${x} ${y})`}>
      <rect x={-width / 2} y={-9} width={width} height={18} rx={9} />
      <text y={3.5}>{text}</text>
    </g>
  );
}

/* ---------- Componente principal ---------- */

export interface EnergyDiagramProps {
  frame: EnergyFlowFrame;
  /** Potencia (W) que corresponde al grosor máximo de línea. */
  referencePowerW?: number;
  /** false = líneas fijas con flecha (pausa o modo estático). */
  animated?: boolean;
  className?: string;
}

export function EnergyDiagram({
  frame,
  referencePowerW = 3000,
  animated = true,
  className,
}: EnergyDiagramProps) {
  const uid = useId().replace(/:/g, '');
  const totals = frameTotals(frame);
  const flows = buildFlows(totals);
  const activeFlows = flows.filter((flow) => flow.watts >= MIN_ACTIVE_W);
  const rootClass = ['energy-diagram', className].filter(Boolean).join(' ');

  return (
    <svg
      className={rootClass}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-labelledby={`${uid}-title ${uid}-desc`}
      focusable="false"
    >
      <title id={`${uid}-title`}>Flujo de energía de la instalación</title>
      <desc id={`${uid}-desc`}>{describeFrame(frame)}</desc>

      <defs>
        {FLOW_COLORS.map((color) => (
          <marker
            key={color}
            id={`${uid}-arrow-${color}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={10}
            markerHeight={10}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path className={`ed-arrow ed-arrow--${color}`} d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        ))}
      </defs>

      {/* Vías (siempre visibles, tenues) */}
      {flows.flatMap((flow) => flow.paths.map((d, index) => (
        <path key={`${flow.id}-track-${index}`} className="ed-track" d={d} />
      )))}

      {/* Flujos activos */}
      {activeFlows.flatMap((flow) => flow.paths.map((d, index) => (
        <path
          key={`${flow.id}-line-${index}`}
          className={`ed-flow__line ed-flow--${flow.color}`}
          d={d}
          strokeWidth={strokeFor(flow.watts, referencePowerW)}
          markerEnd={`url(#${uid}-arrow-${flow.color})`}
          data-animated={animated ? 'true' : 'false'}
          data-flow-id={flow.id}
          data-segment-index={index}
        />
      )))}

      <Node rect={RECTS.pv} label="Paneles · DC" value={formatPower(totals.pvProductionDcW)} icon={<PanelIcon />} />
      <Node
        rect={RECTS.grid}
        label="Red · AC"
        value={frame.gridAvailable ? formatPower(totals.gridImportAcW) : 'Sin red'}
        dimmed={!frame.gridAvailable}
        icon={<BoltIcon />}
      />
      <Node rect={RECTS.inverter} label="Inversor" icon={<InverterIcon />} />
      <Node
        rect={RECTS.battery}
        label="Batería"
        value={`${Math.round(totals.socPct)} %`}
        icon={<BatteryIcon socPct={totals.socPct} />}
      />
      <Node rect={RECTS.home} label="Vivienda · AC" value={formatPower(totals.loadServedAcW)} icon={<HouseIcon />} />

      {totals.pvCurtailedDcW >= MIN_ACTIVE_W && (
        <text className="ed-note" x={RECTS.pv.x + RECTS.pv.w / 2} y={RECTS.pv.y - 9}>
          No aprovechada {formatPower(totals.pvCurtailedDcW)}
        </text>
      )}
      {totals.loadUnservedAcW >= MIN_ACTIVE_W && (
        <text className="ed-note ed-note--demand" x={RECTS.home.x + RECTS.home.w / 2} y={RECTS.home.y + RECTS.home.h + 14}>
          Sin cubrir {formatPower(totals.loadUnservedAcW)}
        </text>
      )}

      {/* Etiquetas encima de todo */}
      {activeFlows.map((flow) => (
        <FlowLabel key={`${flow.id}-label`} x={flow.label.x} y={flow.label.y} watts={flow.watts} />
      ))}
    </svg>
  );
}
