import { useEffect, useState } from 'react';
import { useApp } from './app/AppContext';
import { useCalculation } from './app/useCalculation';
import { Icon, type IconName } from './ui/icons';
import { Home } from './screens/Home';
import { Wizard } from './screens/Wizard';
import { Result } from './screens/Result';
import { Catalog } from './screens/Catalog';
import { Contact } from './screens/Contact';
import { OfferCheck } from './screens/OfferCheck';

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = (path: string) => {
    if (read() === path) window.scrollTo({ top: 0, behavior: 'smooth' });
    else window.location.hash = path;
  };
  useEffect(() => { window.scrollTo(0, 0); }, [route]);
  return { route, navigate };
}

const NAV: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '/', label: 'Inicio', icon: 'home' },
  { path: '/calcular', label: 'Calcular', icon: 'calculator' },
  { path: '/resultado', label: 'Resultado', icon: 'layers' },
  { path: '/catalogo', label: 'Equipos', icon: 'catalog' },
  { path: '/contacto', label: 'Contacto', icon: 'contact' },
];

export default function App() {
  const { state } = useApp();
  const { route, navigate } = useHashRoute();
  const calculation = useCalculation(state);
  const dark = route === '/resultado';

  return (
    <div className={`app ${dark ? 'app--dark' : ''}`}>
      <header className={`topbar ${dark ? 'topbar--dark' : ''}`}>
        {route !== '/' ? (
          <button type="button" className="topbar__back" onClick={() => navigate('/')} aria-label="Volver al inicio"><Icon name="chevron" size={18} /></button>
        ) : null}
        <div className="topbar__brand">
          <span className="topbar__mark"><Icon name="sun" size={18} /></span>
          Solar Cuba
        </div>
        <span className="topbar__spacer" />
        {route !== '/oferta' && (
          <button type="button" className="topbar__back topbar__action" onClick={() => navigate('/oferta')} aria-label="Comprobar una oferta" title="Comprobar una oferta">
            <Icon name="shield" size={18} /><span className="topbar__tag">Oferta</span>
          </button>
        )}
      </header>

      <main className="app__body">
        {route === '/' && <Home navigate={navigate} />}
        {route === '/calcular' && <Wizard calculation={calculation} navigate={navigate} />}
        {route === '/resultado' && <Result calculation={calculation} navigate={navigate} />}
        {route === '/catalogo' && <Catalog />}
        {route === '/contacto' && <Contact />}
        {route === '/oferta' && <OfferCheck />}
        {!['/', '/calcular', '/resultado', '/catalogo', '/contacto', '/oferta'].includes(route) && <Home navigate={navigate} />}
      </main>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {NAV.map((item) => {
          const active = route === item.path || (item.path === '/calcular' && route === '/oferta');
          return (
            <button
              type="button"
              key={item.path}
              className={`bottom-nav__item ${item.path === '/calcular' ? 'bottom-nav__item--main' : ''} ${active ? 'is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              <Icon name={item.icon} size={item.path === '/calcular' ? 22 : 20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
