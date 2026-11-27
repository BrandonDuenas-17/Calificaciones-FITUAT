# Plan de Corrección de Fórmulas y Cálculos — Calificaciones FIUAT

Plan quirúrgico para resolver los **7 hallazgos (H1–H7)** y el ajuste de **1 a 5 exámenes por semestre (H8)** detectados en la auditoría del motor de calificaciones, sin alterar ningún dato en Supabase ni debilitar las medidas de seguridad existentes.

---

## Resumen de Alcance

- **Base de datos Supabase:** 0 cambios (preservación total de los 154 docentes y sus registros).
- **Seguridad:** Intacta (roles, `Object.freeze`, sesiones firmadas, bloqueo fuerza bruta, inactividad 20 min, sanitización CWE-1236).
- **Archivos a modificar:** `math_engine.js`, `app.js`, `exporter.js`, `attendance_importer.js`, `tests/gradebook.test.mjs`, `index.html`.
- **Validación:** Suite automática `node --test tests/gradebook.test.mjs` con pruebas de regresión para H1–H7 y matriz de 1 a 5 exámenes (`0%–100%` paso 20%, `maxFaltas = 5`).

---

## Tabla Resumen de Correcciones

| # | Severidad | Archivo(s) | Problema actual | Solución exacta |
| :--- | :---: | :--- | :--- | :--- |
| **H1** | 🔴 Alta | `math_engine.js` (L146–L151) | `hasFirmas` y `hasExamen` no validan `wFirmas > 0` / `wExamen > 0`; con peso `0%` genera unidad fantasma en `0`. | Exigir `wFirmas > 0` en `hasFirmas` y `wExamen > 0` en `hasExamen` (misma regla que `hasAsist` y `hasPart`). |
| **H2** | 🔴 Alta | `app.js` (L2340, L2570), `attendance_importer.js` (L867, L905), `math_engine.js` (L148–L152) | Unidades sin marcas guardan `100%` y pasar lista en U2 sin firmas/examen mete `evalU[2] = wAsist` al promedio. | Guardar `asistencia = null` cuando `totalMarked === 0`, y no promediar unidades que solo tengan asistencia si hay criterios académicos activos. |
| **H3** | 🔴 Alta | `math_engine.js` (L155–L163, L210–L212) | `firmas > maxFirmas` desborda el peso asignado (ej. `12/10` da `72` en criterio de `60%`); faltan topes en motor. | Acotar `firmas / maxF` a `[0, 1]`, `examen` y `proyecto` a `[0, 100]` y `puntosExtra >= 0` dentro de `MathEngine`. |
| **H4** | 🟠 Media | `math_engine.js` (L230–L244), `app.js` (L1182, L4001, L4404, L4551), `exporter.js` (L30, L71–L74) | En `alerta_sd`, la tabla y Excel Docente muestran `SD` ocultando la nota, mientras la Final y Excel Teams usan la nota completa. | Exponer `esReprobarCero` desde `MathEngine`: mostrar **`SD (0)`** en modo estricto y **`SD (94)`** en alerta preventiva en web y ambos Excel. |
| **H5** | 🟠 Media | `app.js` (L3815–L3842, L3951–L3970) | Editar `% Asistencia` manualmente a `100` en un alumno con `> maxFaltas` sigue dando `0 pts` en silencio. | Mostrar `toast` avisando cuántas faltas activan la penalización y pintar en rojo el anillo cuando `isAsistPerdida` esté activo. |
| **H6** | 🟡 Baja | `math_engine.js` (L222–L228) | En `reprobar_cero` semestral, `Proyecto` y `Puntos Extra` siguen dando nota `> 0` aunque todas las unidades estén en `0`. | Si `excedeSemestre && policy.esReprobarCero`, fijar `evalFinal = 0` directamente (en ámbito `unidad` se conserva el comportamiento normal). |
| **H7** | 🟡 Baja | `math_engine.js` (L34), `app.js` (L5482–L5488) | `maxFaltas: 0` cae al default `3` por `|| 3`, y la UI permite guardar ponderaciones cuya suma sea `!= 100%`. | Parsear `maxFaltas` respetando `0`, y bloquear el guardado en *Gestionar Materia* si la suma de criterios es distinta de `100%`. |
| **H8** | 🟢 Mejora | `app.js` (L3712–L3723), `tests/gradebook.test.mjs`, `index.html` | Dejar unidades extra con firmas sin examen evalúa el examen en `0`; faltan tests automáticos de la matriz completa. | Añadir aviso en *Configuración de Fórmulas*, agregar pruebas permanentes de 1–5 unidades y H1–H7 en `gradebook.test.mjs`, y subir `?v=73` a `?v=74` en `index.html`. |

---

## Detalle por Punto

### 1. H1 — Criterios con peso `0%`
- **Cambio en `math_engine.js` (L146–L147):**
  - `const hasFirmas = firmas !== null && wFirmas > 0;`
  - `const hasExamen = examen !== null && wExamen > 0;`
- **Resultado:** Si un docente usa `Firmas 0% / Examen 100%`, las firmas en una unidad sin examen no generan un `0` fantasma ni desploman el promedio.

### 2. H2 — Asistencia vacía y pase de lista adelantado
- **Cambio en `app.js` (`setAttendanceStatusDirect` y `recalculateAttendanceForUnit`) y `attendance_importer.js`:**
  - Si `totalMarked === 0`, guardar `rec.asistencia[uKey] = null` (y mostrar `-` en la sábana) y no escribir `0` en `participacion` si no hubo participaciones.
- **Cambio en `math_engine.js` (L148–L152):**
  - Definir `const hasAcademicWeights = (wFirmas > 0 || wExamen > 0 || wPart > 0);`.
  - Evaluar la unidad cuando `(hasFirmas || hasExamen || hasPart || (!hasAcademicWeights && hasAsist))`.
- **Resultado:** Pasar lista en la siguiente unidad no reprueba alumnos antes del examen; si el curso es `100%` asistencia, sí evalúa directo.

### 3. H3 — Tope estricto en `MathEngine`
- **Cambio en `math_engine.js` (L155–L163 y L210–L212):**
  - `puntajeFirmas = Math.min(1, Math.max(0, Number(firmas)) / maxF) * wFirmas;`
  - `puntajeExamen = (Math.min(100, Math.max(0, Number(examen))) / 100) * wExamen;`
  - `proyecto = Math.min(100, Math.max(0, Number(record.proyecto)));`
  - `puntosExtra = Math.max(0, Number(record.puntosExtra) || 0);`
- **Resultado:** Un error de dedo (`12/10` firmas o valores fuera de rango) jamás infla un criterio arriba de su peso.

### 4. H4 — Consistencia de `alerta_sd`
- **Cambio en `math_engine.js`, `app.js` y `exporter.js`:**
  - Retornar `esReprobarCero: policy.esReprobarCero` desde `calculateStudentGrades`.
  - Mostrar `SD (0)` cuando `isSd && esReprobarCero`, y `SD (${val})` cuando `isSd && !esReprobarCero` en tabla, ficha móvil, Excel Docente y Excel Teams.

### 5. H5 — Edición manual de `% Asistencia` con sanción activa
- **Cambio en `app.js` (`updateAsistencia` y `updateStudentRowView`):**
  - Si tras editar manualmente `% Asistencia` la unidad sigue con `asistenciaPerdidaU[u]` o `isSinDerechoU[u]`, mostrar `showToast` indicando las faltas registradas y que el puntaje sigue en `0 pts` hasta justificarlas.
  - Pintar en rojo el anillo SVG también cuando `isAsistPerdida` sea `true`.

### 6. H6 — `reprobar_cero` semestral con Proyecto y Puntos Extra
- **Cambio en `math_engine.js` (L222–L228):**
  - Si `excedeSemestre && policy.esReprobarCero`, fijar `evalFinal = 0` directamente.

### 7. H7 — `maxFaltas: 0` y suma exacta de `100%`
- **Cambio en `math_engine.js` (L34):** validar `maxFaltas` sin usar `|| 3` para no pisar el `0`.
- **Cambio en `app.js` (L5482–L5488):** bloquear el guardado en *Gestionar Materia* si `wF + wE + wA + wP !== 100`.

### 8. H8 — Pruebas permanentes y despliegue limpio
- Añadir aviso breve en *Configuración de Fórmulas* sobre ajustar `unidadesCount` al número real de exámenes (1 a 5+).
- Incorporar las pruebas de H1–H7 y matriz de 1 a 5 unidades (`0%–100%`, `maxFaltas = 5`) en `tests/gradebook.test.mjs`.
- Subir versión de caché `?v=73` -> `?v=74` en `index.html`, correr `node --test`, hacer commit semántico y `git push origin main`.

---

## Decisiones a Confirmar Antes de Ejecutar

Confírmame si apruebas el plan tal cual o si deseas ajustar alguno de estos 3 criterios de negocio:

1. **H3:** ¿Confirmas topar firmas al `100%` del peso (sin puntos extra por exceder `maxFirmas`)?
2. **H6:** ¿Confirmas que `reprobar_cero` en ámbito **semestre** deje `evalFinal = 0` aunque haya Proyecto o Puntos Extra?
3. **H7:** ¿Confirmas bloquear el guardado si la suma de porcentajes es distinta de `100%` (en lugar de permitir guardar con `confirm`)?
