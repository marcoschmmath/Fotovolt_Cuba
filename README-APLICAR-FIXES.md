# SolarAPP — corrección de dos pruebas tras la simulación 08:00–08:00

Este overlay contiene solo tres archivos:

- `src/test/architecture.test.ts`: reemplaza una expectativa antigua de déficit nocturno cero. La evaluación ahora parte de SOC 30 % a las 08:00 y, sin combustible alternativo, conserva las comidas como demanda eléctrica obligatoria. Un sistema pequeño puede consumir la reserva para cocinar y acabar con déficit nocturno; el test ahora comprueba que ese déficit existe y que un sistema significativamente mayor lo reduce.
- `src/ui/simulation/EnergyDiagram.tsx`: añade `data-flow-id` y `data-segment-index` a cada tramo SVG para identificar el flujo físico al que pertenece.
- `src/ui/simulation/simulation.test.tsx`: comprueba dos flujos lógicos (PV→cargas y PV→batería), aunque el primero esté compuesto por dos tramos SVG al pasar por el inversor. Por eso el resultado correcto en este caso son tres paths, no dos.

No se modifica el motor de simulación, sus prioridades, ni la política de reserva. Las pruebas de `policy.test.ts` ya cubren por separado que las cargas opcionales de día respetan la reserva y que la cocción sin combustible puede usarla hasta el mínimo físico.

Aplicar desde la raíz del proyecto y revisar primero el estado de Git:

```fish
git status --short
# Extraer el overlay en la raíz del proyecto:
tar -xzf /ruta/a/SolarAPP-fix-pruebas.tar.gz -C .
bun run test
bunx tsc -b
bun run build
```
