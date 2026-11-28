import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import type {
  RecommendationCard,
  RecommendationProgress,
  RecommendationWorkerResponse,
  SolarRecommendation,
} from '../domain/calculator/recommendations';
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
        <Stat value={fmtW(recommendation.inverter.ratedW * recommendation.inverterCount)} label="Potencia inversor" sub={recommendation.inverterCount + ' unidad(es) en paralelo'} />
        <Stat tone="solar" value={(recommendation.coverageWorst * 100).toFixed(1) + ' %'} label="Peor cobertura" sub="24 escenarios normales" />
      </div>
      <p className="field__hint">
        SOC de la prueba: {(recommendation.initialSoc * 100).toFixed(1)} % a las 08:00 → {(recommendation.finalSocWorst * 100).toFixed(1)} % mínimo al día siguiente a las 08:00.
        El SOC final se considera sostenible según el mismo umbral de la evaluación existente.
      </p>

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
          <p>{recommendation.inverterCount} × {equipmentName(recommendation.inverter)} · banco {recommendation.battery.nominalV} V</p>
        </div>
      </div>

      <p className="field__hint">
        Demanda diaria de diseño: {fmtKwh(recommendation.simulatedDemandKwh)} · Energía fotovoltaica aprovechada (mediana): {fmtKwh(recommendation.simulatedPvKwh)}.
        Energía no suministrada en el peor escenario normal: {fmtKwh(recommendation.unservedKwh)}.
        La prueba separada de apagón total alcanza {Math.round(recommendation.blackoutCoverage * 100)} % de cobertura y deja {fmtKwh(recommendation.blackoutUnservedKwh)} sin suministrar; se informa aparte, no sustituye el criterio normal de compatibilidad.
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
      <Button full icon="check" onClick={onSelect}>Usar esta instalación</Button>
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
  const params = useMemo(() => {
    const active = state.installations.find((item) =>
      item.id === state.activeInstallationId && item.householdProfileId === household?.id,
    );
    const saved = active ?? state.installations.find((item) => item.householdProfileId === household?.id);
    return saved?.params ?? systemParams();
  }, [state.installations, state.activeInstallationId, household?.id]);

  const [cards, setCards] = useState<RecommendationCard[]>([]);
  const [progress, setProgress] = useState<RecommendationProgress | null>(null);
  const [progressByTier, setProgressByTier] = useState<Record<string, RecommendationProgress>>({});
  const [generationStatus, setGenerationStatus] = useState<'running' | 'complete' | 'cancelled' | 'error'>('running');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (!household) return;
    const worker = new Worker(
      new URL('../domain/calculator/recommendations.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    setCards([]);
    setProgress(null);
    setProgressByTier({});
    setGenerationError(null);
    setGenerationStatus('running');

    worker.onmessage = (event: MessageEvent<RecommendationWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        setProgress(message.progress);
        setProgressByTier((current) => ({
          ...current,
          [message.progress.tierId]: message.progress,
        }));
      } else if (message.type === 'tier') {
        setCards((current) => [
          ...current.filter((card) => card.tier.id !== message.card.tier.id),
          message.card,
        ]);
      } else if (message.type === 'complete') {
        setCards(message.cards);
        setGenerationStatus('complete');
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      } else if (message.type === 'error') {
        setGenerationError(message.message);
        setGenerationStatus('error');
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };

    worker.onerror = (event) => {
      setGenerationError(event.message || 'Error inesperado al calcular las recomendaciones.');
      setGenerationStatus('error');
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    worker.postMessage({
      input: {
        household,
        panels: state.panels,
        batteries: state.batteries,
        inverters: state.inverters,
        params,
      },
    });

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [household, state.panels, state.batteries, state.inverters, params, generationAttempt]);

  function cancelGeneration() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setGenerationStatus('cancelled');
  }

  function retryGeneration() {
    setGenerationAttempt((attempt) => attempt + 1);
  }

  const progressDescription = progress
    ? progress.phase === 'preparing'
      ? `Preparando el nivel ${progress.tierId}…`
      : progress.phase === 'generating'
        ? `Generando combinaciones para ${progress.tierId}…`
        : progress.phase === 'validating'
          ? `Validando ${progress.tierId}: ${progress.candidatesValidated} candidatas probadas.`
          : `Nivel ${progress.tierId} completado.`
    : 'Preparando los datos de consumo y el catálogo de equipos…';

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
      inverterCount: recommendation.inverterCount,
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
        description="Las propuestas usan los equipos de tu catálogo y se validan con los mismos escenarios de 24 horas y criterios energéticos que la pantalla de Resultados."
      />
      {generationStatus === 'running' && (
        <Panel tone="paper" className="recommendation-calculation">
          <div className="panel__head">
            <h3>Calculando recomendaciones</h3>
            <Badge tone="storage">En segundo plano</Badge>
          </div>
          <p className="result-description" aria-live="polite">{progressDescription}</p>
          {progress && (
            <p className="field__hint">
              {progress.candidatesGenerated} candidatas generadas · {progress.candidatesValidated} evaluadas · {progress.scenariosEvaluated} escenarios · {progress.technicalChecks ?? 0} chequeos técnicos
            </p>
          )}
          <div className="recommendation-progress" aria-hidden="true">
            <span />
          </div>
          <p className="field__hint">Puedes seguir usando esta página mientras se calcula. Las propuestas aparecerán una por una.</p>
          <Button variant="quiet" onClick={cancelGeneration}>Cancelar cálculo</Button>
        </Panel>
      )}
      {generationStatus === 'cancelled' && (
        <Note level="warning" title="Cálculo cancelado">
          Las propuestas que ya se habían completado siguen disponibles. Puedes reiniciar la búsqueda.
          <Button variant="outline" onClick={retryGeneration}>Volver a calcular</Button>
        </Note>
      )}
      {generationStatus === 'error' && (
        <Note level="warning" title="No se pudo completar el cálculo">
          {generationError ?? 'Ocurrió un error inesperado.'}
          <Button variant="outline" onClick={retryGeneration}>Reintentar</Button>
        </Note>
      )}
      <Note level="info" title="Qué significa que una propuesta sea viable">
        Se reutiliza exactamente la evaluación energética existente: comienza a las 08:00 con SOC inicial igual al mayor entre el 30 % y el SOC mínimo físico de la batería, y termina a las 08:00 del día siguiente. Se comprueban los 24 escenarios de retorno de red. La compatibilidad energética exige cobertura mínima del 99,9 %, SOC final sostenible respecto al inicial y ninguna comida eléctrica sin atender, igual que en Resultados. El apagón total se evalúa y muestra por separado.
        <p className="field__hint">Hipótesis utilizadas: {params.hsp.toFixed(1)} HSP, eficiencia global {Math.round(params.systemEfficiency * 100)} %, sombra/suciedad {Math.round(params.shading * 100)} % y temperatura ambiente {params.ambientC} °C.</p>
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
      {generationStatus === 'complete' && (
        <details className="recommendation-search-stats">
          <summary>Estadísticas de la búsqueda</summary>
          <ul>
            {Object.values(progressByTier).map((item) => (
              <li key={item.tierId}>
                <strong>{item.tierId}</strong>: {item.candidatesGenerated} candidatas · {item.candidatesValidated} simuladas · {item.scenariosEvaluated} escenarios · {item.technicalChecks ?? 0} chequeos técnicos ({item.technicalRejections ?? 0} descartes) · {item.candidateGenerationMs ?? 0} ms generación + {item.validationMs ?? 0} ms validación = {item.elapsedMs ?? 0} ms
              </li>
            ))}
          </ul>
        </details>
      )}
      {generationStatus === 'complete' && cards.every((card) => !card.recommendation) && (
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
      )}
    </div>
  );
}
