import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './ui/icons';
import { Home } from './screens/Home';
import { HouseholdWizard } from './screens/HouseholdWizard';
import { SystemWizard } from './screens/SystemWizard';
import { Simulation } from './screens/Simulation';
import { Result } from './screens/Result';
import { Catalog } from './screens/Catalog';
import { Contact } from './screens/Contact';
import { OfferCheck } from './screens/OfferCheck';
import { More } from './screens/More';
import { Recommendations } from './screens/Recommendations';

const NAV: Array<{ path: string; label: string; icon: IconName; activePaths: string[] }> = [
  { path: '/', label: 'Inicio', icon: 'home', activePaths: ['/'] },
  { path: '/hogar', label: 'Simular', icon: 'calculator', activePaths: ['/hogar', '/instalacion', '/simulacion'] },
  { path: '/resultado', label: 'Resultados', icon: 'grid', activePaths: ['/resultado', '/oferta'] },
  { path: '/mas', label: 'Más', icon: 'layers', activePaths: ['/mas', '/catalogo', '/contacto'] },
];

const parse = (hash: string) => {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const pasoRaw = Number(params.get('paso'));
  return {
    path: path || '/',
    id: params.get('id'),
    hogar: params.get('hogar'),
    nuevo: params.get('nuevo'),
    paso: Number.isInteger(pasoRaw) && pasoRaw >= 1 ? pasoRaw : undefined,
  };
};

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function useHashRoute() {
  const read = () => parse(window.location.hash || '#/');
  const [route, setRoute] = useState(read);
  const first = useRef(true);
  const programmatic = useRef(false);

  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      if (first.current) {
        first.current = false;
        return;
      }
      const main = document.querySelector<HTMLElement>('main.app__body');
      main?.focus({ preventScroll: true });
      if (programmatic.current) {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
      programmatic.current = false;
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (path: string) => {
    const target = parse(`#${path}`);
    if (read().path === target.path && read().id === target.id && read().hogar === target.hogar) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    programmatic.current = true;
    window.location.hash = path;
  };
  return { route, navigate };
}

function headerTitle(path: string): string {
  const titles: Record<string, string> = {
    '/hogar': 'Mi vivienda',
    '/instalacion': 'Sistema fotovoltaico',
    '/recomendaciones': 'Recomendaciones solares',
    '/simulacion': 'Simulación',
    '/resultado': 'Resultados',
    '/oferta': 'Comprobar una oferta',
    '/catalogo': 'Catálogo de equipos',
    '/contacto': 'Contacto',
    '/mas': 'Más opciones',
  };
  return titles[path] ?? 'Solar Cuba';
}

function backTarget(path: string, id: string | null): string {
  if (path === '/simulacion' && id) return `/instalacion?id=${id}`;
  if (path === '/resultado' && id) return `/simulacion?id=${id}`;
  if (path === '/instalacion') return '/';
  if (path === '/catalogo' || path === '/contacto' || path === '/oferta') return '/mas';
  return '/';
}

export default function App() {
  const { route, navigate } = useHashRoute();
  const isHome = route.path === '/';

  return (
    <div className="app">
      <header className={`topbar ${isHome ? 'topbar--home' : 'topbar--inner-page'}`}>
        <div className="topbar__inner">
          {isHome ? (
            <>
              <span className="topbar__brand">
                <span className="topbar__mark"><Icon name="sun" size={20} /></span>
                <strong>Solar Cuba</strong>
              </span>
              <span className="topbar__spacer" />
              <button type="button" className="topbar__link" onClick={() => navigate('/oferta')}>
                <Icon name="shield" size={16} /> Oferta
              </button>
            </>
          ) : (
            <>
              <button type="button" className="topbar__back topbar__back--icon" onClick={() => navigate(backTarget(route.path, route.id))} aria-label="Volver">
                <Icon name="chevron" size={22} />
              </button>
              <strong className="topbar__page-title">{headerTitle(route.path)}</strong>
              <span className="topbar__spacer" />
            </>
          )}
        </div>
      </header>

      <main className="app__body" tabIndex={-1}>
        {route.path === '/' && <Home navigate={navigate} />}
        {route.path === '/hogar' && <HouseholdWizard navigate={navigate} householdId={route.id ?? undefined} initialStep={route.paso} />}
        {route.path === '/instalacion' && <SystemWizard navigate={navigate} installationId={route.id ?? undefined} initialHouseholdId={route.hogar ?? undefined} />}
        {route.path === '/recomendaciones' && <Recommendations navigate={navigate} householdId={route.hogar ?? undefined} />}
        {route.path === '/simulacion' && <Simulation navigate={navigate} installationId={route.id ?? undefined} />}
        {route.path === '/resultado' && <Result navigate={navigate} installationId={route.id ?? undefined} />}
        {route.path === '/oferta' && <OfferCheck navigate={navigate} />}
        {route.path === '/catalogo' && <Catalog />}
        {route.path === '/contacto' && <Contact />}
        {route.path === '/mas' && <More navigate={navigate} />}
      </main>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {NAV.map((item) => {
          const active = item.activePaths.includes(route.path);
          return (
            <button
              type="button"
              key={item.path}
              className={`bottom-nav__item ${active ? 'is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
