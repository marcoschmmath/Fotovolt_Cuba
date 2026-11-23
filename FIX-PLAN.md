# FIX-PLAN — SolarAPP

Checkpoint de seguridad completado 23/11/2026:

- **Git:** no existía → `git init` + commit base `af11990` con el estado actual completo.
- **Lockfiles:** `package-lock.json` (original, intacto) y `bun.lock` (migrado). `bun install --frozen-lockfile` → *107 installs / 177 packages, sin cambios* → el lockfile de Bun es válido y reproducible.
- **Runtime:** Bun 1.4.5 (principal) + Node v26.13.1 disponibles. Sin privilegios elevados.
- **Línea base:** `bunx tsc -b` → exit 0 · `bun run test` → **44/44 en verde**.

Motor de tests: **Vitest** a través de los scripts existentes de `package.json` (no el runner nativo de Bun).

## Fases y dependencias

| Fase | Contenido | Depende de |
| --- | --- | --- |
| **A** | Física crítica: A1 descarga compartida, A2 carga compartida, A3 DoD/SOC único, A4 recarga PV, A5 autonomía única, A6 datos PV inválidos, A7 strings infeasibles, A8 sin cargas | checkpoint |
| **B** | Contabilidad eléctrica: B1 eficiencia de inversor, B2 unidades kWh, B3 gráfico de flujo, B4 recarga por opción | A (los flujos de energía cambian) |
| **C** | Integridad de datos: C1 storage+migración, C2 catálogo completo, C3 coef. temperatura, C4 input numérico, C5 validación, C6 selección, C7 `batteryCount` | A/B (definiciones estables) |
| **D** | Lógica y UX: D1 informe de oferta, D2 rejilla temporal, D3 gate del wizard, D4 paginación, D5 accesibilidad, D6 dark mode, D7 estado numérico | C |
| **E** | PWA: E1 caché SW, E2 CSS, E3 reduced-motion, E4 registro/meta | independiente |
| **F** | Tests de regresión + invariantes + sensibilidad a mutación | A–E |
| **L** | Limpieza y documentación (fase G del encargo) | F verde |

Reglas: verificar cada hallazgo en el código antes de tocarlo; no cambiar el significado de parámetros ni unidades en silencio; `tsc -b` + suite en verde tras **cada** fase; commit por fase.

## Verificación de sensibilidad a mutación (obligatoria, fase F)

Revertir temporalmente el arreglo de A1, A2, A3 y A4 debe hacer **fallar** el test de regresión correspondiente. Se documenta el resultado en `IMPLEMENTATION-REPORT.md`.
