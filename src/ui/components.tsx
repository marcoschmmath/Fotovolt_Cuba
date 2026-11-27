import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

export function fmt(value: number, digits = 1): string {
  return new Intl.NumberFormat('es-CU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Plural natural en español: «1 equipo», «3 equipos» (sin «equipo(s)»). */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

export function fmtW(watts: number): string {
  if (watts >= 1000) return `${fmt(watts / 1000, 2)} kW`;
  return `${Math.round(watts)} W`;
}

export function fmtKwh(kwh: number): string {
  if (kwh >= 1 || kwh === 0) return `${fmt(kwh, 2)} kWh`;
  return `${Math.round(kwh * 1000)} Wh`;
}

export function fmtMoney(value: number, currency: 'USD' | 'CUP' = 'USD'): string {
  return `${currency} ${new Intl.NumberFormat('es-CU', { maximumFractionDigits: 0 }).format(value)}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'quiet' | 'dark' | 'danger';
  full?: boolean;
  icon?: IconName;
  trailing?: boolean;
}

export function Button({ variant = 'primary', full, icon, trailing, children, className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} ${full ? 'btn--full' : ''} ${className}`}
      {...props}
    >
      {icon && !trailing && <Icon name={icon} size={18} />}
      <span>{children}</span>
      {icon && trailing && <Icon name={icon} size={18} />}
    </button>
  );
}

export function IconButton({ icon, label, ...props }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...props}>
      <Icon name={icon} size={20} />
    </button>
  );
}

export function Chip({
  active,
  children,
  icon,
  ...props
}: { active?: boolean; children: ReactNode; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`chip ${active ? 'chip--active' : ''}`} aria-pressed={active} {...props}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          className={option.value === value ? 'is-active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>{label}</label>
      {hint && <span className="field__hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>{hint}</span>}
      {children}
    </div>
  );
}

/** Mensaje emergente accesible para avisos cortos (copiar, guardar, error). */
export function Toast({ message, tone = 'info' }: { message: string; tone?: 'info' | 'error' }) {
  if (!message) return null;
  return (
    <div className={`toast toast--${tone}`} role="status" aria-live="polite">
      <Icon name={tone === 'error' ? 'warning' : 'check'} size={16} />
      <span>{message}</span>
    </div>
  );
}

/**
 * Copia al portapapeles con feedback explícito. Antes se hacía
 * `void navigator.clipboard?.writeText(...)`: si fallaba (permiso denegado,
 * contexto no seguro) el usuario no se enteraba de nada.
 */
export function useClipboard(): { copy: (text: string) => void; message: string; error: boolean } {
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const timer = useRef<number | null>(null);

  const notify = useCallback((text: string, isError: boolean) => {
    setMessage(text);
    setError(isError);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setMessage('');
      setError(false);
    }, 2600);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    (text: string) => {
      if (!navigator.clipboard?.writeText) {
        notify('No se pudo copiar: este navegador no lo permite.', true);
        return;
      }
      navigator.clipboard.writeText(text).then(
        () => notify('Copiado al portapapeles.', false),
        () => notify('No se pudo copiar. Cópialo manualmente.', true),
      );
    },
    [notify],
  );

  return { copy, message, error };
}

/**
 * Interpreta lo que el usuario ha tecleado en un campo numérico (M2/C8).
 *
 * Devuelve `null` cuando el texto todavía no es un número completo (`''`,
 * `'-'`, `'1,'`): en ese caso el valor guardado NO debe cambiar, porque
 * convertirlo en 0 hacía que el campo saltara al mínimo mientra se escribía.
 *
 * Acepta la coma decimal española y sustituye coherentemente `min`/`max`
 * (incluidos negativos, necesarios para coeficientes térmicos).
 */
export function parseDecimalInput(
  raw: string,
  min = 0,
  max = Number.POSITIVE_INFINITY,
): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Campo numérico con búfer de texto (M2/C8):
 *  - admite coma decimal española y punto (`1,5`, `1.5`);
 *  - no convierte una entrada incompleta (`''`, `'-'`, `'1,'`) en 0 ni salta
 *    al mínimo mientras se teclea;
 *  - respeta `min`/`max` negativos (coeficientes térmicos como −0,003);
 *  - se normaliza al salir del campo.
 */
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  unit,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Sólo documental: el campo es de texto con `inputMode="decimal"`. */
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const id = useId();
  const [buffer, setBuffer] = useState<string | null>(null);

  // Si el valor cambia desde fuera (otro control, perfil, reset), el búfer de
  // tecleo deja de tener sentido y se descarta.
  useEffect(() => {
    setBuffer((current) => {
      if (current === null) return null;
      const parsed = Number(current.replace(',', '.'));
      return Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9 ? current : null;
    });
  }, [value]);

  const text = buffer ?? (Number.isFinite(value) ? String(value) : '');

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="number-field">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            setBuffer(raw);
            const parsed = parseDecimalInput(raw, min, max);
            if (parsed !== null) onChange(parsed);
          }}
          onBlur={() => {
            const parsed = parseDecimalInput(buffer ?? '', min, max);
            if (parsed !== null) onChange(parsed);
            setBuffer(null);
          }}
        />
        {unit && <span className="number-field__unit">{unit}</span>}
      </div>
    </Field>
  );
}

export function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  display,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  display?: string;
  hint?: string;
}) {
  const id = useId();
  const progress = ((value - min) / Math.max(0.0001, max - min)) * 100;
  return (
    <div className="range-field">
      <div className="range-field__head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{display ?? value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        style={{ '--range-progress': `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  multiline,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  multiline?: boolean;
  autoComplete?: string;
}) {
  const id = useId();
  const shared: InputHTMLAttributes<HTMLInputElement> = {
    id,
    value,
    placeholder,
    type,
    autoComplete,
    onChange: (event) => onChange(event.target.value),
  };
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      {multiline ? (
        <textarea id={id} value={value} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...shared} />
      )}
    </Field>
  );
}

export function Panel({ children, tone = 'paper', className = '', style }: { children: ReactNode; tone?: 'paper' | 'dark' | 'green' | 'transparent'; className?: string; style?: CSSProperties }) {
  return <section className={`panel panel--${tone} ${className}`} style={style}>{children}</section>;
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  light,
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  light?: boolean;
  /** Nivel de encabezado: 1 para el título principal de la pantalla. */
  level?: 1 | 2 | 3;
}) {
  const Heading = level === 1 ? 'h1' : level === 3 ? 'h3' : 'h2';
  return (
    <header className={`section-title ${light ? 'section-title--light' : ''}`}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <Heading>{title}</Heading>
      {description && <p>{description}</p>}
    </header>
  );
}

export function Stat({ value, label, tone, sub }: { value: string; label: string; tone?: 'solar' | 'storage' | 'demand' | 'grid'; sub?: string }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function Note({ children, level = 'info', title }: { children: ReactNode; level?: 'info' | 'warning' | 'error' | 'success'; title?: string }) {
  return (
    <div className={`note note--${level}`}>
      <Icon name={level === 'info' ? 'info' : level === 'success' ? 'check' : 'warning'} size={18} />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'solar' | 'storage' | 'warning' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Stepper({
  step,
  labels,
  onStep,
  canGoTo,
}: {
  step: number;
  labels: string[];
  onStep?: (step: number) => void;
  /** Indica si un paso es alcanzable; los no alcanzables quedan deshabilitados. */
  canGoTo?: (step: number) => boolean;
}) {
  return (
    <div
      className="stepper"
      style={{ '--stepper-steps': labels.length } as CSSProperties}
      aria-label={`Paso ${step} de ${labels.length}`}
    >
      {labels.map((label, index) => {
        const target = index + 1;
        const reachable = canGoTo ? canGoTo(target) : true;
        return (
          <button
            type="button"
            key={label}
            className={`stepper__item ${target === step ? 'is-current' : ''} ${target < step ? 'is-done' : ''}`}
            onClick={() => {
              if (!onStep || !reachable) return;
              onStep(target);
            }}
            aria-current={target === step ? 'step' : undefined}
            aria-label={
              reachable
                ? `Ir al paso ${target}: ${label}`
                : `Paso ${target} (${label}): completa los pasos anteriores para desbloquearlo`
            }
            aria-disabled={!reachable}
            disabled={!onStep || !reachable}
            title={reachable ? undefined : 'Completa los pasos anteriores'}
          >
            <span className="stepper__dot">{target < step ? <Icon name="check" size={12} /> : target}</span>
            <span className="stepper__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**Páginas deslizables con puntos indicadores y botones anterior/siguiente.*/
export function SwipePages<T>({
  items,
  render,
  label,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  label: string;
}) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    setIndex(clamped);
    const page = track.current?.children[clamped] as HTMLElement | undefined;
    if (!page) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    page.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  }

  /** Página visible según la posición real de cada hijo (no según el viewport). */
  function visiblePage(element: HTMLDivElement): number {
    const pages = Array.from(element.children) as HTMLElement[];
    if (!pages.length) return 0;
    const center = element.scrollLeft + element.clientWidth / 2;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    pages.forEach((page, position) => {
      const distance = Math.abs(page.offsetLeft + page.offsetWidth / 2 - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = position;
      }
    });
    return best;
  }

  return (
    <div className="swiper">
      <div
        className="swiper__track"
        ref={track}
        aria-label={label}
        onScroll={(event) => {
          const next = visiblePage(event.currentTarget);
          if (next !== index) setIndex(next);
        }}
      >
        {items.map((item, i) => (
          <div className="swiper__page" key={i}>{render(item, i)}</div>
        ))}
      </div>
      <div className="swiper__controls">
        <button type="button" aria-label="Página anterior" disabled={index === 0} onClick={() => goTo(index - 1)}>
          <Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="swiper__dots" role="tablist" aria-label={`${label}: página ${index + 1} de ${items.length}`}>
          {items.map((_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === index} className={i === index ? 'is-active' : ''} aria-label={`Ir a la página ${i + 1}`} onClick={() => goTo(i)} />
          ))}
        </div>
        <button type="button" aria-label="Página siguiente" disabled={index === items.length - 1} onClick={() => goTo(index + 1)}>
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, action }: { icon: IconName; title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={30} />
      <p>{title}</p>
      {action}
    </div>
  );
}
