import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

export function fmt(value: number, digits = 1): string {
  return new Intl.NumberFormat('es-CU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
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
      {hint && <span className="field__hint">{hint}</span>}
      {children}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  unit,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="number-field">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) ? Math.min(max ?? Infinity, Math.max(min, parsed)) : min);
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

export function SectionTitle({ eyebrow, title, description, light }: { eyebrow?: string; title: string; description?: string; light?: boolean }) {
  return (
    <header className={`section-title ${light ? 'section-title--light' : ''}`}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
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

export function Stepper({ step, labels, onStep }: { step: number; labels: string[]; onStep?: (step: number) => void }) {
  return (
    <div className="stepper" aria-label={`Paso ${step} de ${labels.length}`}>
      {labels.map((label, index) => (
        <button
          type="button"
          key={label}
          className={`stepper__item ${index + 1 === step ? 'is-current' : ''} ${index + 1 < step ? 'is-done' : ''}`}
          onClick={() => onStep?.(index + 1)}
          aria-current={index + 1 === step ? 'step' : undefined}
          aria-label={`Ir al paso ${index + 1}: ${label}`}
          disabled={!onStep}
        >
          <span className="stepper__dot">{index + 1 < step ? <Icon name="check" size={12} /> : index + 1}</span>
          <span className="stepper__label">{label}</span>
        </button>
      ))}
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
    page?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  return (
    <div className="swiper">
      <div
        className="swiper__track"
        ref={track}
        aria-label={label}
        onScroll={(event) => {
          const element = event.currentTarget;
          const next = Math.round(element.scrollLeft / Math.max(1, element.clientWidth));
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
