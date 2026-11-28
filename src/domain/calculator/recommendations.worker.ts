import {
  generateSolarRecommendations,
  type RecommendationInput,
  type RecommendationWorkerResponse,
} from './recommendations';

interface RecommendationWorkerRequest {
  input: RecommendationInput;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecommendationWorkerRequest>) => void) | null;
  postMessage(message: RecommendationWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  try {
    const cards = generateSolarRecommendations(event.data.input, {
      onProgress: (progress) => {
        workerScope.postMessage({ type: 'progress', progress });
      },
      onTierComplete: (card) => {
        workerScope.postMessage({ type: 'tier', card });
      },
    });
    workerScope.postMessage({ type: 'complete', cards });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'No se pudo completar el cálculo de recomendaciones.',
    });
  }
};

export {};
