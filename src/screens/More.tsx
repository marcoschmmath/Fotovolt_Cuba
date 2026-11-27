import { Button, Panel, SectionTitle } from '../ui/components';
import { Icon } from '../ui/icons';

export function More({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div className="stack more-screen">
      <SectionTitle title="Más opciones" description="Consulta equipos, revisa una oferta o ponte en contacto con el instalador." />

      <Panel tone="paper" className="more-link-card">
        <span className="more-link-card__icon"><Icon name="catalog" size={23} /></span>
        <div className="more-link-card__copy">
          <strong>Catálogo de equipos</strong>
          <span>Paneles, baterías e inversores disponibles.</span>
        </div>
        <Button variant="quiet" onClick={() => navigate('/catalogo')}>Abrir</Button>
      </Panel>

      <Panel tone="paper" className="more-link-card">
        <span className="more-link-card__icon"><Icon name="shield" size={23} /></span>
        <div className="more-link-card__copy">
          <strong>Comprobar una oferta</strong>
          <span>Evalúa el sistema que te propone un proveedor en tu vivienda.</span>
        </div>
        <Button variant="quiet" onClick={() => navigate('/oferta')}>Abrir</Button>
      </Panel>

      <Panel tone="paper" className="more-link-card">
        <span className="more-link-card__icon"><Icon name="contact" size={23} /></span>
        <div className="more-link-card__copy">
          <strong>Contacto</strong>
          <span>Habla con el instalador para revisar tu proyecto.</span>
        </div>
        <Button variant="quiet" onClick={() => navigate('/contacto')}>Abrir</Button>
      </Panel>
    </div>
  );
}
