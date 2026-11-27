import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { DEFAULT_PARAMS } from '../domain/core/defaults';
import { analyzeEnergy } from '../domain/calculator/energy';
import { COOKING_FUEL_LABELS } from '../domain/household/types';
import { Badge, Button, EmptyState, Note, Panel, Stat, fmtKwh, fmtW } from '../ui/components';
import { Icon } from '../ui/icons';
import { uid } from '../domain/persistence/storage';

/**
 * Pantalla de inicio: dos acciones claras (diseñar instalación, comprobar
 * oferta) y la gestión de viviendas e instalaciones guardadas.
 */
export function Home({ navigate }: { navigate: (path: string) => void }) {
  const { state, patch } = useApp();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const households = state.households;
  const installations = state.installations;
  const simulations = state.simulations;

  const duplicateHousehold = (id: string) => {
    const source = households.find((h) => h.id === id);
    if (!source) return;
    // Identificadores nuevos: la copia es independiente del original.
    const idMap = new Map<string, string>();
    const appliances = source.appliances.map((a) => {
      const nextId = uid('app');
      idMap.set(a.id, nextId);
      return { ...a, id: nextId };
    });
    const created = {
      ...source,
      id: uid('hogar'),
      name: `${source.name} (copia)`,
      appliances,
      night: { essentialIds: source.night.essentialIds.map((x) => idMap.get(x)).filter((x): x is string => Boolean(x)) },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    patch((current) => ({
      households: [...current.households, created],
      activeHouseholdId: created.id,
    }));
  };

  const deleteHousehold = (id: string) => {
    const household = households.find((h) => h.id === id);
    if (!household) return;
    patch((current) => ({
      households: current.households.filter((h) => h.id !== id),
      installations: current.installations.filter((i) => i.householdProfileId !== id),
      simulations: current.simulations.filter((s) => s.householdProfileId !== id),
      activeHouseholdId: current.households.find((h) => h.id !== id)?.id ?? '',
      activeInstallationId: null,
    }));
    setConfirmDelete(null);
  };

  const renameHousehold = (id: string, name: string) => {
    patch((current) => ({
      households: current.households.map((h) => (h.id === id ? { ...h, name, updatedAt: new Date().toISOString() } : h)),
    }));
    setRenaming(null);
    setNameDraft('');
  };

  return (
    <div className="stack">
      {/* Hero editorial: la ilustración es un recurso independiente, no una captura de UI. */}
      <section className="home-hero">
        <div className="home-hero__copy">
          <span className="eyebrow">ENERGÍA SOLAR PARA EL HOGAR</span>
          <h1>Planifica tu energía solar en Cuba</h1>
          <p className="home-hero__lead">
            Simula tu consumo, compara opciones y conoce si una instalación se adapta a tu casa y a los apagones.
          </p>
        </div>
        <div className="home-hero__art">
          <img src="/images/solar-home-hero.jpg" alt="Casa tropical cubana con paneles solares, batería y palmas" />
        </div>
      </section>

      <div className="home-action-list" aria-label="Comenzar">
        <button type="button" className="home-action-card" onClick={() => navigate('/hogar')}>
          <span className="home-action-card__icon"><Icon name="home" size={25} /></span>
          <span className="home-action-card__copy">
            <strong>Agrega los equipos que deseas mantener encendidos</strong>
            <small>Configura tu vivienda y tus hábitos de consumo.</small>
          </span>
          <Icon name="chevron" size={20} />
        </button>
        <button type="button" className="home-action-card" onClick={() => {
          const household = households.find((h) => h.id === state.activeHouseholdId) ?? households[0];
          if (!household) {
            navigate('/hogar');
            return;
          }
          patch({ activeHouseholdId: household.id });
          navigate(`/instalacion?hogar=${household.id}`);
        }}>
          <span className="home-action-card__icon"><Icon name="inverter" size={25} /></span>
          <span className="home-action-card__copy">
            <strong>Agrega tu sistema fotovoltaico y simula</strong>
            <small>Paneles, baterías e inversor para tu vivienda.</small>
          </span>
          <Icon name="chevron" size={20} />
        </button>
      </div>

      <div className="home-proof" aria-label="Ventajas de Solar Cuba">
        <span><Icon name="bolt" size={20} />Funciona offline</span>
        <span><Icon name="shield" size={20} />Pensado para Cuba</span>
        <span><Icon name="grid" size={20} />Escenarios reales</span>
      </div>

      {/* 2. Qué resuelve, en tres pasos (sin tarjetas repetidas) */}
      <ol className="home-flow">
        <li>
          <span className="home-flow__n" aria-hidden="true">1</span>
          <div>
            <strong>Tu vivienda, una sola vez</strong>
            <p>Equipos, cocina y cargas de noche quedan guardados y se reutilizan en cada instalación.</p>
          </div>
        </li>
        <li>
          <span className="home-flow__n" aria-hidden="true">2</span>
          <div>
            <strong>Compara instalaciones entre sí</strong>
            <p>Cuantas quieras para la misma vivienda: paneles, baterías e inversor, cara a cara.</p>
          </div>
        </li>
        <li>
          <span className="home-flow__n" aria-hidden="true">3</span>
          <div>
            <strong>Comprueba ofertas externas</strong>
            <p>Pega lo que te ofrecen y te digo, con tus números, si sirve en tu casa.</p>
          </div>
        </li>
      </ol>

      <section className="stack" aria-labelledby="mis-viviendas">
        <div className="row row--between">
          <h2 id="mis-viviendas" className="section-title">Mis viviendas</h2>
          <Button variant="quiet" icon="plus" onClick={() => navigate('/hogar')}>Nueva</Button>
        </div>
        {households.length === 0 && (
          <EmptyState
            icon="house"
            title="Todavía no hay viviendas guardadas"
            action={<Button icon="plus" onClick={() => navigate('/hogar')}>Configurar mi vivienda</Button>}
          />
        )}
        <div className="stack" style={{ gap: '.8rem' }}>
          {households.map((household) => {
            const energy = analyzeEnergy(household.appliances, state.installations[0]?.params ?? DEFAULT_PARAMS);
            const forThis = installations.filter((i) => i.householdProfileId === household.id);
            const results = simulations.filter((s) => s.householdProfileId === household.id);
            const startInstall = () => {
              patch({ activeHouseholdId: household.id });
              navigate(`/instalacion?hogar=${household.id}`);
            };
            return (
              <Panel key={household.id} tone="paper" className="household-card">
                <div className="household-card__head">
                  {renaming === household.id ? (
                    <div className="row" style={{ gap: '.5rem' }}>
                      <input
                        className="text-field"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        aria-label="Nuevo nombre de la vivienda"
                      />
                      <Button icon="check" onClick={() => renameHousehold(household.id, nameDraft.trim() || household.name)}>Guardar</Button>
                    </div>
                  ) : (
                    <h3>{household.name}</h3>
                  )}
                  <span className="household-card__tags">
                    <Badge tone={forThis.length ? 'storage' : 'warning'}>
                      {forThis.length} {forThis.length === 1 ? 'instalación' : 'instalaciones'}
                    </Badge>
                    {household.cooking.fuelKind && (
                      <Badge tone="neutral">{COOKING_FUEL_LABELS[household.cooking.fuelKind]}</Badge>
                    )}
                  </span>
                </div>

                <div className="stat-grid stat-grid--four">
                  <Stat label="Equipos" value={String(household.appliances.length)} />
                  <Stat label="Al día" value={fmtKwh(energy.dailyKwh)} />
                  <Stat label="Esenciales de noche" value={String(household.night.essentialIds.length)} />
                  <Stat label="Instalaciones" value={String(forThis.length)} />
                </div>

                {forThis.length === 0 && (
                  <div className="household-card__empty">
                    <Icon name="layers" size={20} />
                    <div>
                      <strong>Todavía sin instalaciones</strong>
                      <p>Diseña un sistema para esta vivienda y aparecerá aquí para compararlo con los demás.</p>
                    </div>
                    <Button icon="sun" onClick={startInstall}>Diseñar instalación</Button>
                  </div>
                )}

                {confirmDelete === household.id ? (
                  <Note level="warning" title={`¿Eliminar «${household.name}»?`}>
                    Se eliminarán sus {forThis.length} {forThis.length === 1 ? 'instalación' : 'instalaciones'} y sus resultados guardados ({results.length}). Los equipos y hábitos de esta vivienda desaparecerán. Las demás viviendas no se tocan.
                    <div className="row" style={{ marginTop: '.5rem', gap: '.5rem' }}>
                      <Button variant="danger" icon="trash" onClick={() => deleteHousehold(household.id)}>Sí, eliminar</Button>
                      <Button variant="quiet" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
                    </div>
                  </Note>
                ) : (
                  <>
                    <div className="household-card__actions">
                      <Button variant="dark" icon="settings" onClick={() => { patch({ activeHouseholdId: household.id }); navigate(`/hogar?id=${household.id}`); }}>
                        Editar vivienda
                      </Button>
                      <Button variant="outline" icon="plus" onClick={startInstall}>
                        Nueva instalación
                      </Button>
                    </div>
                    <div className="household-card__more">
                      <button type="button" className="linkish" onClick={() => duplicateHousehold(household.id)}>
                        Duplicar
                      </button>
                      <button type="button" className="linkish" onClick={() => { setRenaming(household.id); setNameDraft(household.name); }}>
                        Renombrar
                      </button>
                      <button type="button" className="linkish linkish--danger" onClick={() => setConfirmDelete(household.id)}>
                        Eliminar
                      </button>
                    </div>
                  </>
                )}
              </Panel>
            );
          })}
        </div>
      </section>

      {installations.length > 0 && (
        <section className="stack" aria-labelledby="mis-instalaciones">
          <div className="row row--between">
            <h2 id="mis-instalaciones" className="section-title">Mis instalaciones</h2>
            <span className="field__hint">{installations.length} guardadas</span>
          </div>
          <div className="stack" style={{ gap: '.8rem' }}>
            {households.map((household) => {
              const rows = installations.filter((i) => i.householdProfileId === household.id);
              if (!rows.length) return null;
              return (
                <Panel key={household.id} tone="paper">
                  <div className="panel__head"><h3>{household.name}</h3></div>
                  {rows.map((inst) => {
                    const panel = state.panels.find((p) => p.id === inst.panelId);
                    const battery = state.batteries.find((b) => b.id === inst.batteryId);
                    const inverter = state.inverters.find((i) => i.id === inst.inverterId);
                    const isActive = state.activeInstallationId === inst.id;
                    return (
                      <div key={inst.id} className="install-row">
                        <div className="row row--between">
                          <div>
                            <strong>{inst.name}</strong>
                            <p className="field__hint" style={{ margin: '.15rem 0 0' }}>
                              {inst.panelCount} × {panel?.powerW ?? 0} W · {inst.batteryCount} × {battery?.nominalKwh ?? 0} kWh · inversor {inverter ? fmtW(inverter.ratedW) : '—'}
                              {inst.origin === 'offer' ? ' · desde oferta' : ''}
                            </p>
                          </div>
                          {isActive && <Badge tone="solar">Seleccionada</Badge>}
                        </div>
                        <div className="chip-grid">
                          <Button variant="quiet" icon="sun" onClick={() => { patch({ activeHouseholdId: household.id, activeInstallationId: inst.id }); navigate(`/resultado?id=${inst.id}`); }}>Abrir resultado</Button>
                          <Button variant="quiet" icon="settings" onClick={() => navigate(`/instalacion?id=${inst.id}`)}>Editar</Button>
                          <Button variant="quiet" icon="layers" onClick={() => {
                            patch((current) => ({
                              installations: [...current.installations, { ...inst, id: `inst-${Date.now().toString(36)}`, name: `${inst.name} (copia)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
                            }));
                          }}>Duplicar</Button>
                          <Button variant="quiet" icon="trash" onClick={() => patch((current) => ({
                            installations: current.installations.filter((i) => i.id !== inst.id),
                            activeInstallationId: current.activeInstallationId === inst.id ? null : current.activeInstallationId,
                          }))}>Eliminar</Button>
                        </div>
                      </div>
                    );
                  })}
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      {simulations.length > 0 && (
        <section className="stack" aria-labelledby="simulaciones">
          <h2 id="simulaciones" className="section-title">Resultados guardados</h2>
          <Note level="info">
            Son fotos del momento en que se simularon: no cambian aunque edites la vivienda o la instalación después. Se
            conservan las últimas {simulations.length >= 50 ? '50' : simulations.length} para no agotar el almacenamiento del
            dispositivo.
          </Note>
          <div className="stack" style={{ gap: '.6rem' }}>
            {simulations.map((snapshot) => (
              <Panel key={snapshot.id} tone="paper">
                <div className="row row--between">
                  <div>
                    <strong>{snapshot.systemName}</strong>
                    <p className="field__hint" style={{ margin: '.15rem 0 0' }}>
                      {snapshot.householdName} · {new Date(snapshot.createdAt).toLocaleDateString('es-CU')} · {fmtKwh(snapshot.householdKwhPerDay)}/día
                    </p>
                  </div>
                  <Badge tone={snapshot.metrics.coverageWorst >= 0.7 ? 'solar' : 'warning'}>
                    {Math.round(snapshot.metrics.coverageWorst * 100)} % peor caso
                  </Badge>
                </div>
              </Panel>
            ))}
          </div>
        </section>
      )}

      <div className="row row--wrap home-foot">
        <Button variant="quiet" icon="catalog" onClick={() => navigate('/catalogo')}>Catálogo de equipos</Button>
        <Button variant="quiet" icon="contact" onClick={() => navigate('/contacto')}>Contacto del instalador</Button>
      </div>
    </div>
  );
}
