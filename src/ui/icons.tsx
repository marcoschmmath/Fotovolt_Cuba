import type { ReactElement, SVGProps } from 'react';

export type IconName =
  | 'home' | 'calculator' | 'layers' | 'catalog' | 'contact' | 'sun' | 'battery'
  | 'inverter' | 'house' | 'grid' | 'fridge' | 'ac' | 'tv' | 'router' | 'bulb'
  | 'microwave' | 'stove' | 'rice' | 'pump' | 'fan' | 'washer' | 'plug'
  | 'bolt' | 'clock' | 'shield' | 'check' | 'plus' | 'minus' | 'trash'
  | 'chevron' | 'info' | 'warning' | 'phone' | 'whatsapp' | 'doc' | 'settings'
  | 'play' | 'pause' | 'share' | 'close' | 'lock' | 'spark' | 'slider';

const paths: Record<IconName, ReactElement> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-6h5v6" /></>,
  calculator: <><rect x="5" y="2.5" width="14" height="19" rx="2.5" /><path d="M8.5 6.5h7" /><path d="M8.5 11h2m3 0h2m-7 4h2m3 0h2m-7 4h2m3 0h2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
  catalog: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.5h18M9 9.5V20" /></>,
  contact: <><path d="M4 5.5h16v13H4z" /><circle cx="12" cy="10" r="2.5" /><path d="M7.5 16.5c.8-1.9 2.4-2.8 4.5-2.8s3.7.9 4.5 2.8" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" /></>,
  battery: <><rect x="3" y="6.5" width="17" height="11" rx="2.5" /><path d="M20 10v4" /><path d="m10.5 9-2 3.5h3l-1.5 3.5" /></>,
  inverter: <><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M7.5 8h5m-5 4h9m-9 4h5" /><circle cx="17" cy="8" r="1" /></>,
  house: <><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>,
  grid: <><path d="M4 20V8m5 12V4m6 16V9m5 11V6" /><path d="M2.5 20h19" /></>,
  fridge: <><rect x="6" y="2.5" width="12" height="19" rx="2" /><path d="M6 9h12" /><path d="M9 6v1.5M9 12v3" /></>,
  ac: <><rect x="2.5" y="5" width="19" height="8" rx="2" /><path d="M6 9.5h12" /><path d="M7 17c0 1.5-1 1.8-1 3M12 17c0 1.5-1 1.8-1 3M17 17c0 1.5-1 1.8-1 3" /></>,
  tv: <><rect x="2.5" y="5" width="19" height="12.5" rx="2" /><path d="M8 21h8M12 17.5V21" /></>,
  router: <><rect x="3" y="11" width="18" height="8" rx="2" /><path d="M7 15h.01M11 15h.01" /><path d="M12 8V4m-4 1a7 7 0 0 1 8 0M8.5 6a4 4 0 0 1 7 0" /></>,
  bulb: <><path d="M9 17h6m-5.5 3h5" /><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-1 .8-1.5 1.6-1.5 2.5h-4c0-.9-.5-1.7-1.5-2.5Z" /></>,
  microwave: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /><rect x="6" y="11" width="8" height="5" rx="1" /><path d="M17 11h1.5v5H17" /></>,
  stove: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9h17" /><circle cx="8" cy="13" r="1.8" /><circle cx="16" cy="13" r="1.8" /></>,
  rice: <><path d="M5 11h14l-1.5 9h-11L5 11Z" /><path d="M4 11h16M8 8c0-1.5 1-2 1-3.5M12 8c0-1.5 1-2 1-3.5M16 8c0-1.5 1-2 1-3.5" /></>,
  pump: <><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /><path d="m7 7 3 3M14 14l3 3M17 7l-3 3M10 14l-3 3" /></>,
  fan: <><circle cx="12" cy="12" r="2" /><path d="M12 10c0-4 1-6 3-6s3 3 1 5c-1 1-2.5 1-4 1M14 12c4 0 6 1 6 3s-3 3-5 1c-1-1-1-2.5-1-4M12 14c0 4-1 6-3 6s-3-3-1-5c1-1 2.5-1 4-1M10 12c-4 0-6-1-6-3s3-3 5-1c1 1 1 2.5 1 4" /></>,
  washer: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 8h16" /><circle cx="12" cy="14" r="4" /><path d="M7.5 5.5h.01M10.5 5.5h.01" /></>,
  plug: <><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" /><path d="M12 17v4" /></>,
  bolt: <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></>,
  shield: <><path d="M12 3 20 6v5.5c0 5-3.3 8.2-8 9.5-4.7-1.3-8-4.5-8-9.5V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
  warning: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17.5h.01" /></>,
  phone: <><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3c0 1.4-1.1 2.5-2.5 2.5A16.5 16.5 0 0 1 4 6c0-1.4 1.1-2.5 2.5-2.5Z" /></>,
  whatsapp: <><path d="M20 11.5a8 8 0 0 1-11.7 7.1L3 20l1.4-5.2A8 8 0 1 1 20 11.5Z" /><path d="M9 9c0 3.3 2.7 6 6 6 .7 0 1.3-.6 1.3-1.3l-2-1-1 1a7 7 0 0 1-2.7-2.7l1-1-1-2C10.3 8 9 8.4 9 9Z" /></>,
  doc: <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></>,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" /></>,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  spark: <><path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5L10 13l-6.5-2L10 9l2-6.5Z" /></>,
  slider: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
};

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
