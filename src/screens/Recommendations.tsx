import { useMemo } from 'react';
import { useApp } from '../app/AppContext';
import { generateSolarRecommendations, type SolarRecommendation } from '../domain/calculator/recommendations';
import { systemParams, type SystemConfiguration } from '../domain/system/types';
import { uid } from '../domain/persistence/storage';
import { Badge, Button, Note, Panel, SectionTitle, Stat, fmtKwh, fmtW } from '../ui/components';

function equipmentName(item: { brand: string; model: string }): string {
  return [item.brand, item.model].filter(Boolean).join(' ').trim();
}

function RecommendationOption({
  recommendation,
  onSelect,
}: {
  recommendation: SolarRecommendation;
  onSelect: () => void;
}) {
  return (
    <Panel tone="paper" className="recommendation-option">
      <div className="panel__head">
        <h3>{recommendation.label}</h3>
        <Badge tone={recommendation.technicalStatus === 'verified' ? 'storage' : 'warning'}>
          {recommendation.technicalStatus === 'verified' ? 'Verificación técnica completa' : 'Verificación parcial'}
        </Badge>
      </div>
      <p className="result-description">{recommendation.description}</p>

      <div className="stat-grid stat-grid--four">
        <Stat tone="solar" value={fmtW(recommendation.installedPvW)} label="Campo solar" sub={recommendation.panelCount + ' panel(es)'} />
        <Stat tone="storage" value={fmtKwh(recommendation.installedBatteryKwh)} label="Batería nominal" sub={recommendation.batteryCount + ' módulo(s)'} />
        <Stat value={fmtW(recommendation.inverter.ratedW)} label="Potencia inversor" />
        <Stat tone="solar" value={(recommendation.finalSoc * 100).toFixed(1) + ' %'} label="SOC al completar 24 h" sub="Sin red eléctrica" />
      </div>

      <div className="recommendation-equipment">
        <div>
          <strong>Paneles</strong>
          <p>{recommendation.panelCount} × {equipmentName(recommendation.panel)} · {recommendation.panel.powerW} W por módulo</p>
        </div>
        <div>
          <strong>Baterías</strong>
          <p>{recommendation.batteryCount} × {equipmentName(recommendation.battery)} · {recommendation.battery.nominalKwh} kWh por módulo</p>
        </div>
        <div>
          <strong>Inversor</strong>
          <p>{equipmentName(recommendation.inverter)} · banco {recommendation.battery.nominalV} V</p>
        </div>
      </div>

      <p className="field__hint">
        Simulación sin red: {fmtKwh(recommendation.simulatedDemandKwh)} de demanda y {fmtKwh(recommendation.simulatedPvKwh)} de producción fotovoltaica. Energía no suministrada: {fmtKwh(recommendation.unservedKwh)}.
      </p>
      {recommendation.estimatedPrice !== undefined && recommendation.currency && (
        <p><strong>Coste estimado de paneles, baterías e inversor:</strong> {recommendation.estimatedPrice.toLocaleString('es-CU')} {recommendation.currency}</p>
      )}
      {recommendation.warnings.length > 0 && (
        <Note level="warning" title="Antes de comprar">
          <ul className="diagnostic-list">
            {recommendation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </Note>
      )}
      <Button block icon="check" onClick={onSelect}>Usar esta instalación</Button>
    </Panel>
  );
}

/**
 * Genera tres instalaciones a partir del perfil ya guardado. Esta pantalla
 * nunca edita ni reemplaza el perfil de vivienda del usuario.
 */
export function Recommendations({
  navigate,
  householdId,
}: {
  navigate: (path: string) => void;
  householdId?: string;
}) {
  const { state, patch } = useApp();
  const household = state.households.find((item) => item.id === (householdId ?? state.activeHouseholdId)) ??
    state.households.find((item) => item.id === householdId) ?? null;
  const params = useMemo(
    () => state.installations.find((item) => item.householdProfileId === household?.id)?.params ?? systemParams(),
    [state.installations, household?.id],
  );

  const cards = useMemo(() => {
    if (!household) return [];
    return generateSolarRecommendations({
      household,
      panels: state.panels,
      batteries: state.batteries,
      inverters: state.inverters,
      params,
    });
  }, [household, state.panels, state.batteries, state.inverters, params]);

  function saveRecommendation(recommendation: SolarRecommendation) {
    if (!household) return;
    const now = new Date().toISOString();
    const record: SystemConfiguration = {
      id: uid('inst'),
      householdProfileId: household.id,
      name: recommendation.label + ' · ' + household.name,
      panelId: recommendation.panel.id,
      panelCount: recommendation.panelCount,
      batteryId: recommendation.battery.id,
      batteryCount: recommendation.batteryCount,
      inverterId: recommendation.inverter.id,
      installationType: 'hybrid',
      params: { ...params },
      recommendationTier: recommendation.tier,
      origin: 'user',
      createdAt: now,
      updatedAt: now,
    };
    patch((current) => ({
      installations: [...current.installations, record],
      activeHouseholdId: household.id,
      activeInstallationId: record.id,
    }));
    navigate('/resultado?id=' + record.id);
  }

  if (!household) {
    return (
      <div className="stack wizard-page">
        <SectionTitle title="No encontramos esa vivienda" description="Guarda primero el perfil de consumo para poder recomendar un sistema." />
        <Button onClick={() => navigate('/hogar')}>Configurar vivienda</Button>
      </div>
    );
  }

  return (
    <div className="stack wizard-page recommendations-screen">
      <SectionTitle
        eyebrow={household.name}
        title="Tres formas de alimentar tu vivienda"
        description="Las propuestas usan los equipos de tu catálogo y se comprueban con una simulación de 24 horas sin red eléctrica."
      />
      <Note level="info" title="Qué significa que una propuesta sea viable">
        El cálculo parte de la batería cargada al 100 %, simula el consumo y la producción solar durante 24 horas y exige que no quede energía sin suministrar y que la batería termine al menos al 99,9 %. La comprobación usa las HSP, pérdidas, temperatura y sombras configuradas; no garantiza ese resultado durante días nublados.
      </Note>
      {cards.map((card) => (
        <section className="stack" key={card.tier.id} aria-label={'Opción ' + card.tier.label}>
          {card.recommendation ? (
            <RecommendationOption
              recommendation={card.recommendation}
              onSelect={() => saveRecommendation(card.recommendation!)}
            />
          ) : (
            <Panel tone="paper">
              <div className="panel__head"><h3>{card.tier.label}</h3><Badge tone="warning">Sin combinación viable</Badge></div>
              <p>{card.tier.description}</p>
              <Note level="warning">{card.reason ?? 'No se encontró una combinación compatible con el catálogo actual.'}</Note>
            </Panel>
          )}
        </section>
      ))}
      <Panel tone="paper">
        <h3>¿No aparece una propuesta?</h3>
        <p className="result-description">Puede faltar potencia fotovoltaica admisible, una batería con capacidad o corriente suficiente, o un inversor compatible con la tensión y los consumos de la vivienda.</p>
        <div className="wizard-actions">
          <Button variant="quiet" onClick={() => navigate('/catalogo')}>Revisar catálogo</Button>
          <Button variant="outline" onClick={() => navigate('/hogar?id=' + household.id)}>Revisar prioridades y consumos</Button>
        </div>
        <p className="field__hint">También puedes continuar con el diseño manual sin perder este perfil.</p>
        <Button variant="dark" onClick={() => navigate('/instalacion?hogar=' + household.id)}>Diseñar manualmente</Button>
      </Panel>
    </div>
  );
}
