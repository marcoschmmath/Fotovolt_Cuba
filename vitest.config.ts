import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Incluye también `.test.tsx`: antes un test de componentes se habría
    // ignorado en silencio.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
