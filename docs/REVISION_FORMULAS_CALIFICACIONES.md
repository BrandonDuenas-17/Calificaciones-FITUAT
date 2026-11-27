# Revisión de Fórmulas y Casos de Prueba — Calificaciones FIUAT

Auditoría ejecutada directamente contra el motor real (`math_engine.js`), el gestor de interfaz/asistencias (`app.js`) y el exportador (`exporter.js`).

---

## 1. Fórmulas Activas Evaluadas

### A. Calificación por Unidad (Ux)
En `math_engine.js` (líneas 155–199):

- **Firmas:** `(Firmas_Ux / maxFirmas_Ux) * W_firmas`
- **Examen:** `(Examen_Ux / 100) * W_examen`
- **Asistencia** (si `W_asist > 0`):
  - Si **no excede** el máximo de faltas (`faltas <= 5`): `(clamp(Asist%, 0, 100) / 100) * W_asist`
  - Si **excede** el máximo (`faltas > 5`) y el modo incluye pérdida de asistencia (`perder_asistencia`, `ambas_alerta`, `ambas_cero`): **`0 pts`**
- **Participación** (si `W_part > 0`): `min(1, max(0, Part_Ux) / maxPart_Ux) * W_part`
- **Total de Unidad:** `clamp(round_1_decimal(suma), 0, 100)`. Si el modo es `reprobar_cero` o `ambas_cero` y excede faltas, la unidad se fuerza a **`0`**.

### B. Calificación Final y Estatus
En `math_engine.js` (líneas 209–228):

- Se promedian únicamente las unidades que tengan al menos un criterio capturado + `Proyecto` (si tiene valor).
- **Fórmula:** `Final = clamp(round(promedio + puntosExtra * 5), 0, 100)`
- **Estatus:** `>= 70` -> **APR** (Aprobado) | `< 70` -> **REP** (Reprobado) | sin evaluaciones -> **PEN**.

### C. Regla de Faltas y Retardos en Sábana
En `app.js` (líneas 2568–2571) y `exporter.js` (líneas 285–288):

- `Asistencias efectivas = P + (R * 0.5) + J`
- `% Asistencia = round(((P + 0.5 * R + J) / (P + F + R + J)) * 100)`
- `Faltas efectivas = F + floor(R / 2)` (cada **2 retardos** suman **1 falta**).
- Con `maxFaltas = 5`, la condición de sanción es estricta (`faltas > 5`): **hasta 5 faltas conserva puntos**; a partir de **6 faltas** aplica sanción.

---

## 2. Hallazgos y Riesgos Detectados (Antes de Subir Calificaciones)

> **Dictamen:** La aritmética base en escenarios limpios es exacta (**0 errores de redondeo IEEE-754** en el barrido de prueba), pero existen **5 errores/riesgos reales** en casos de captura cotidiana que sí pueden producir calificaciones erróneas cuando los maestros suban notas.

| # | Severidad | Dónde ocurre | Problema detectado (reproducido en `MathEngine`) | Impacto al maestro |
| :--- | :---: | :--- | :--- | :--- |
| **H1** | 🔴 **Alta** | `math_engine.js` (L146–L151) | `hasFirmas` y `hasExamen` **no validan** `wFirmas > 0` / `wExamen > 0` (a diferencia de asistencia y participación). Si un docente configura **Firmas 0% / Examen 100%** y hay firmas en U2 pero aún no captura el examen de U2, la fórmula evalúa U2 como **`0`** y baja un promedio de **90 a 45 (REP)**. | Promedios desplomados a reprobado cuando un criterio tiene peso `0%`. |
| **H2** | 🔴 **Alta** | `app.js` (L2570–L2576) + `math_engine.js` (L148–L151) | 1) En `recalculateAttendanceForUnit`, cuando una unidad tiene sesiones creadas pero **0 marcas** (o al usar *"Dejar en blanco"*), asigna `asistencia = 100%` en lugar de `null`. 2) Apenas se registra asistencia en U2 (con `wAsist = 20%`), aunque todavía **no existan firmas ni examen en U2**, `MathEngine` ya calcula `evalU[2] = 20` y la promedia con U1 (`100`) -> **`Final = 60 (REP)`**. | Al pasar lista de la siguiente unidad, todos los alumnos aparecen reprobados antes de hacer examen. |
| **H3** | 🔴 **Alta** | `math_engine.js` (L155–L158) | **`puntajeFirmas` no tiene tope en `wFirmas`** (tampoco `examen` se acota a `[0, 100]` dentro del motor). Si `maxFirmas = 10`, `wFirmas = 60%`, `wExamen = 40%`, y por error se capturan **`12` firmas** con examen de `50`, el cálculo da `72 + 20 = 92` en lugar de `60 + 20 = 80` (el anillo en UI sí topa en 100%, pero la nota sube sin límite hasta 100). | Un error de dedo en firmas infla la nota y compensa exámenes reprobados. |
| **H4** | 🟠 **Media** | `app.js` (L1182) + `exporter.js` (L30, L71–L74) | En modo **`alerta_sd`** (alerta preventiva), la unidad **NO se vuelve 0** en `MathEngine` (ej. `94`), pero la tabla del calificador y el **Excel Docente** ocultan el número y muestran **`SD`**, mientras la **Calificación Final sigue en `94 (APR)`** y el **Excel de Teams** sí muestra `94`. | Contradicción visual entre la celda de unidad (`SD`), la final (`94 APR`) y el acta de Teams. |
| **H5** | 🟠 **Media** | `app.js` (L3815–L3842) | Si un alumno perdió puntos por tener `6 faltas` en la sábana (`rec.faltas.u1 = 6`) y el docente corrige manualmente el `% Asistencia` a `100` en el calificador, `rec.faltas.u1` **sigue en `6`**, por lo que la fórmula le sigue dando **`0 pts`** de asistencia aunque en pantalla vea `100`. | El maestro ve `100%` en la celda pero el alumno sigue penalizado con `0 pts`. |
| **H6** | 🟡 **Baja** | `math_engine.js` (L192–L227) | Con **`reprobar_cero`** en ámbito `semestre` (todas las unidades en `0`), si el alumno tiene `proyecto = 100` y `2 puntos extra`, la fórmula todavía calcula `mean(0,0,0,0,0,100) + 10 = 27` en lugar de `0`. | Confirmar si el proyecto/puntos extra deben anularse o conservarse en modo estricto. |
| **H7** | 🟡 **Baja** | `math_engine.js` (L34) y `app.js` (L5483–L5488) | 1) `maxFaltas: 0` cae al default `3` por uso de `|| 3`. 2) La configuración permite guardar ponderaciones cuya suma sea `!= 100%` (solo pide `confirm`), dejando topes de unidad en `< 100` o sobre-ponderados. | Si un maestro confirma por accidente una suma de `80%`, nadie podrá sacar más de `80`. |

---

## 3. Bloque 1 — Casos SIN Asistencia (`Asistencia = 0%`)

Parámetros base de la simulación: **5 unidades**, `maxFirmas = 10` por unidad, `Asistencia = 0%`, `Participación = 0%`.

### Perfiles de Alumnos Evaluados
- **P1 (Todo completo):** Firmas `10/10`, Examen `100` en las 5 unidades.
- **P1b (Todo bien):** Firmas `10/10`, Examen `90` en las 5 unidades.
- **P2 (Todas las firmas, exámenes mal):** Firmas `10/10`, Examen `40` en las 5 unidades.
- **P2b (Todas las firmas, exámenes en 0):** Firmas `10/10`, Examen `0` en las 5 unidades.
- **P3 (Viceversa — sin firmas, exámenes bien):** Firmas `0/10`, Examen `100` en las 5 unidades.
- **P3b (Pocas firmas, exámenes bien):** Firmas `2/10`, Examen `90` en las 5 unidades.
- **P4 (Mixto 5U):** U1(`10/10, 100`), U2(`8/10, 80`), U3(`10/10, 50`), U4(`4/10, 90`), U5(`6/10, 70`).
- **P5 (Mixto + Proyecto + Extra):** Igual a P4 + `Proyecto = 90` + `1 Punto Extra (+5)`.
- **P6 (Todo en cero):** Firmas `0/10`, Examen `0` en las 5 unidades.

### Matriz de Resultados (Combinaciones `0, 20, 40, 60, 80, 100`)

| Firmas% | Examen% | P1 (10/10, 100) | P1b (10/10, 90) | P2 (10/10, 40) | P2b (10/10, 0) | P3 (0/10, 100) | P3b (2/10, 90) | P4 (Mixto 5U) | P5 (Mixto+P90+1E) | P6 (0/10, 0) |
| ---: | ---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **0%** | **100%** | 100 (APR) | 90 (APR) | 40 (REP) | 0 (REP) | 100 (APR) | 90 (APR) | 78 (APR) | 85 (APR) | 0 (REP) |
| **20%** | **80%** | 100 (APR) | 92 (APR) | 52 (REP) | 20 (REP) | 80 (APR) | 76 (APR) | 78 (APR) | 85 (APR) | 0 (REP) |
| **40%** | **60%** | 100 (APR) | 94 (APR) | 64 (REP) | 40 (REP) | 60 (REP) | 62 (REP) | 77 (APR) | 84 (APR) | 0 (REP) |
| **60%** | **40%** | 100 (APR) | 96 (APR) | 76 (APR) | 60 (REP) | 40 (REP) | 48 (REP) | 77 (APR) | 84 (APR) | 0 (REP) |
| **80%** | **20%** | 100 (APR) | 98 (APR) | 88 (APR) | 80 (APR) | 20 (REP) | 34 (REP) | 76 (APR) | 84 (APR) | 0 (REP) |
| **100%** | **0%** | 100 (APR) | 100 (APR) | 100 (APR) | 100 (APR) | 0 (REP) | 20 (REP) | 76 (APR) | 83 (APR) | 0 (REP) |

### Traza de Verificación Unidad por Unidad (Ejemplo `40% Firmas / 60% Examen`)
- **P4 (Mixto 5U):**
  - `U1`: `(10/10) * 40 + (100/100) * 60 = 40 + 60 = 100`
  - `U2`: `(8/10) * 40 + (80/100) * 60 = 32 + 48 = 80`
  - `U3`: `(10/10) * 40 + (50/100) * 60 = 40 + 30 = 70`
  - `U4`: `(4/10) * 40 + (90/100) * 60 = 16 + 54 = 70`
  - `U5`: `(6/10) * 40 + (70/100) * 60 = 24 + 42 = 66`
  - **Promedio:** `(100 + 80 + 70 + 70 + 66) / 5 = 77.2` -> `round(77.2) = 77 (APR)`
- **P5 (Mixto + Proyecto 90 + 1 Pto Extra):**
  - **Promedio con Proyecto:** `(100 + 80 + 70 + 70 + 66 + 90) / 6 = 79.333...`
  - **Con 1 Punto Extra (+5):** `79.333... + 5 = 84.333...` -> `round = 84 (APR)`

> **Nota:** Todos los resultados del Bloque 1 coinciden 100% con el cálculo algebraico exacto cuando las 5 unidades están completas. Los puntos críticos aquí son **H1** (si se usa `0% / 100%` o `100% / 0%` con captura parcial) y **H3** (si las firmas capturadas superan `maxFirmas`).

---

## 4. Bloque 2 — Casos CON Asistencia (`maxFaltas = 5`)

Parámetros base: **5 unidades**, `maxFirmas = 10`, **20 sesiones de clase por unidad**, límite activo con **`maxFaltas = 5`** y sanción `modoExceder = "perder_asistencia"` (ámbito `unidad`):

- **0 faltas** -> `100%` asistencia (**AÚN cuenta**).
- **5 faltas** (límite máximo permitido) -> `75%` asistencia (**AÚN cuenta**, porque `5 <= 5`).
- **6 faltas** (supera el máximo) -> `70%` asistencia física, pero **anulada a `0 pts`** (`6 > 5`, ya no tiene oportunidad de puntos de asistencia).

### 4A. Escenario donde la Asistencia AÚN Cuenta (`faltas <= 5`)

| F% | E% | A% | Perfecto 0f (10/10, 100, 100%) | Perfecto 5f (10/10, 100, 75%) | Firmas OK / Ex 40 (0f) | Firmas OK / Ex 40 (5f) | Firmas OK / Ex 0 (0f) | Firmas OK / Ex 0 (5f) | Sin Firmas / Ex 100 (0f) | Sin Firmas / Ex 100 (5f) | Mixto 5U (0,2,3,4,5f) |
| ---: | ---: | ---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **0** | **80** | **20** | 100 (APR) | 95 (APR) | 52 (REP) | 47 (REP) | 20 (REP) | 15 (REP) | 100 (APR) | 95 (APR) | 80 (APR) |
| **20** | **60** | **20** | 100 (APR) | 95 (APR) | 64 (REP) | 59 (REP) | 40 (REP) | 35 (REP) | 80 (APR) | 75 (APR) | 79 (APR) |
| **40** | **40** | **20** | 100 (APR) | 95 (APR) | 76 (APR) | 71 (APR) | 60 (REP) | 55 (REP) | 60 (REP) | 55 (REP) | 79 (APR) |
| **60** | **20** | **20** | 100 (APR) | 95 (APR) | 88 (APR) | 83 (APR) | 80 (APR) | 75 (APR) | 40 (REP) | 35 (REP) | 78 (APR) |
| **80** | **0** | **20** | 100 (APR) | 95 (APR) | 100 (APR) | 95 (APR) | 100 (APR) | 95 (APR) | 20 (REP) | 15 (REP) | 78 (APR) |
| **0** | **60** | **40** | 100 (APR) | 90 (APR) | 64 (REP) | 54 (REP) | 40 (REP) | 30 (REP) | 100 (APR) | 90 (APR) | 81 (APR) |
| **20** | **40** | **40** | 100 (APR) | 90 (APR) | 76 (APR) | 66 (REP) | 60 (REP) | 50 (REP) | 80 (APR) | 70 (APR) | 81 (APR) |
| **40** | **20** | **40** | 100 (APR) | 90 (APR) | 88 (APR) | 78 (APR) | 80 (APR) | 70 (APR) | 60 (REP) | 50 (REP) | 80 (APR) |
| **60** | **0** | **40** | 100 (APR) | 90 (APR) | 100 (APR) | 90 (APR) | 100 (APR) | 90 (APR) | 40 (REP) | 30 (REP) | 80 (APR) |
| **0** | **40** | **60** | 100 (APR) | 85 (APR) | 76 (APR) | 61 (REP) | 60 (REP) | 45 (REP) | 100 (APR) | 85 (APR) | 83 (APR) |
| **20** | **20** | **60** | 100 (APR) | 85 (APR) | 88 (APR) | 73 (APR) | 80 (APR) | 65 (REP) | 80 (APR) | 65 (REP) | 82 (APR) |
| **40** | **0** | **60** | 100 (APR) | 85 (APR) | 100 (APR) | 85 (APR) | 100 (APR) | 85 (APR) | 60 (REP) | 45 (REP) | 82 (APR) |
| **0** | **20** | **80** | 100 (APR) | 80 (APR) | 88 (APR) | 68 (REP) | 80 (APR) | 60 (REP) | 100 (APR) | 80 (APR) | 84 (APR) |
| **20** | **0** | **80** | 100 (APR) | 80 (APR) | 100 (APR) | 80 (APR) | 100 (APR) | 80 (APR) | 80 (APR) | 60 (REP) | 84 (APR) |
| **0** | **0** | **100** | 100 (APR) | 75 (APR) | 100 (APR) | 75 (APR) | 100 (APR) | 75 (APR) | 100 (APR) | 75 (APR) | 86 (APR) |

*(En todos los casos de esta tabla `asistenciaPerdida = false`: con **5 faltas exactas** los puntos proporcionales de asistencia siguen sumando.)*

---

### 4B. Escenario donde YA NO Tiene Oportunidad de Puntos de Asistencia (`faltas = 6 > 5`)

En todas las filas siguientes el alumno tiene `6 faltas` (`70%` físico en sábana), pero por exceder `maxFaltas = 5` la fórmula anula los puntos de asistencia a **`0 pts`** (`asistenciaPerdida = true`).

- **Parcial U1–U3 OK, U4–U5 6f:** Alumno perfecto en firmas/examen, con `2 faltas (90%)` en U1–U3 (sí cuenta) y `6 faltas` en U4–U5 (`0 pts` de asistencia).
- **Mixto 5U (U3–U5 6f):** Mismo alumno mixto de 4A pero con `6 faltas` en U3–U5.

| F% | E% | A% | Perfecto 6f (10/10, 100, 0 pts A) | Firmas OK / Ex 40 (6f) | Firmas OK / Ex 0 (6f) | Sin Firmas / Ex 100 (6f) | Pocas Firmas 2/10 / Ex 90 (6f) | Parcial U1-U3 OK, U4-U5 6f | Mixto 5U (U3-U5 6f) |
| ---: | ---: | ---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **0** | **80** | **20** | 80 (APR) | 32 (REP) | 0 (REP) | 80 (APR) | 72 (APR) | 91 (APR) | 70 (APR) |
| **20** | **60** | **20** | 80 (APR) | 44 (REP) | 20 (REP) | 60 (REP) | 58 (REP) | 91 (APR) | 70 (APR) |
| **40** | **40** | **20** | 80 (APR) | 56 (REP) | 40 (REP) | 40 (REP) | 44 (REP) | 91 (APR) | **69 (REP)** |
| **60** | **20** | **20** | 80 (APR) | 68 (REP) | 60 (REP) | 20 (REP) | 30 (REP) | 91 (APR) | **69 (REP)** |
| **80** | **0** | **20** | 80 (APR) | 80 (APR) | 80 (APR) | 0 (REP) | 16 (REP) | 91 (APR) | **68 (REP)** |
| **0** | **60** | **40** | 60 (REP) | 24 (REP) | 0 (REP) | 60 (REP) | 54 (REP) | 82 (APR) | 62 (REP) |
| **20** | **40** | **40** | 60 (REP) | 36 (REP) | 20 (REP) | 40 (REP) | 40 (REP) | 82 (APR) | 62 (REP) |
| **40** | **20** | **40** | 60 (REP) | 48 (REP) | 40 (REP) | 20 (REP) | 26 (REP) | 82 (APR) | 61 (REP) |
| **60** | **0** | **40** | 60 (REP) | 60 (REP) | 60 (REP) | 0 (REP) | 12 (REP) | 82 (APR) | 61 (REP) |
| **0** | **40** | **60** | 40 (REP) | 16 (REP) | 0 (REP) | 40 (REP) | 36 (REP) | 72 (APR) | 54 (REP) |
| **20** | **20** | **60** | 40 (REP) | 28 (REP) | 20 (REP) | 20 (REP) | 22 (REP) | 72 (APR) | 54 (REP) |
| **40** | **0** | **60** | 40 (REP) | 40 (REP) | 40 (REP) | 0 (REP) | 8 (REP) | 72 (APR) | 53 (REP) |
| **0** | **20** | **80** | 20 (REP) | 8 (REP) | 0 (REP) | 20 (REP) | 18 (REP) | 63 (REP) | 46 (REP) |
| **20** | **0** | **80** | 20 (REP) | 20 (REP) | 20 (REP) | 0 (REP) | 4 (REP) | 63 (REP) | 46 (REP) |
| **0** | **0** | **100** | 0 (REP) | 0 (REP) | 0 (REP) | 0 (REP) | 0 (REP) | 54 (REP) | 38 (REP) |

### Traza Paso a Paso — Impacto Real de Superar las 5 Faltas (`40% F / 40% E / 20% A`)
Alumno **Mixto 5U** (Firmas: `10, 8, 10, 4, 6` | Exámenes: `100, 80, 50, 90, 70`):

- **Dentro del límite (`faltas = 0, 2, 3, 4, 5` -> Asist: `100%, 90%, 85%, 80%, 75%`):**
  - `U1 = 40 + 40 + 20 = 100`
  - `U2 = 32 + 32 + 18 = 82`
  - `U3 = 40 + 20 + 17 = 77`
  - `U4 = 16 + 36 + 16 = 68`
  - `U5 = 24 + 28 + 15 = 67`
  - **Promedio:** `78.8` -> **Final = `79 (APR)`**
- **Excediendo 5 faltas en U3–U5 (`faltas = 0, 2, 6, 6, 6` -> U3–U5 pierden asistencia):**
  - `U1 = 100`, `U2 = 82` (conservan puntos de asistencia)
  - `U3 = 40 + 20 + 0 = 60` (`asistenciaPerdida = true`)
  - `U4 = 16 + 36 + 0 = 52` (`asistenciaPerdida = true`)
  - `U5 = 24 + 28 + 0 = 52` (`asistenciaPerdida = true`)
  - **Promedio:** `69.2` -> **Final = `69 (REP)`**

---

### 4C. Comparativa de los 6 Modos de Sanción en Ámbito `Semestre` (`maxFaltas = 5`)

Ejemplo: `40% Firmas / 40% Examen / 20% Asistencia`, alumno con `10/10` firmas y `90` en exámenes en las 5 unidades:

- **Dentro del límite:** `1 falta` por unidad (`total = 5 faltas`, `95%` asistencia).
- **Excedido:** `2 faltas` en U1–U3 y `0` en U4–U5 (`total = 6 faltas > 5`).

| Modo (`modoExceder`) | Con 5 faltas totales (`<= 5`) | Con 6 faltas totales (`> 5`) | Badge SD | Pierde Pts Asist | Observación |
| :--- | ---: | ---: | :---: | :---: | :--- |
| `ninguna` (Informativo) | U1=95 · **Final=95** | U1=94 · **Final=95** | No | No | Solo conteo informativo |
| `perder_asistencia` | U1=95 · **Final=95** | U1=76 · **Final=76** | No | **Sí** | Anula 20% de asistencia en todas las unidades |
| `alerta_sd` | U1=95 · **Final=95** | U1=94* · **Final=95** | **Sí** | No | **Ver H4:** UI muestra `SD` en U1–U5 pero Final sigue `95` |
| `ambas_alerta` | U1=95 · **Final=95** | U1=76* · **Final=76** | **Sí** | **Sí** | Anula asistencia + muestra `SD` en tabla |
| `reprobar_cero` | U1=95 · **Final=95** | U1=0 · **Final=0** | **Sí** | No | Cancela todas las unidades a `0` |
| `ambas_cero` | U1=95 · **Final=95** | U1=0 · **Final=0** | **Sí** | **Sí** | Cancela todas las unidades a `0` y anula asistencia |

> **Regla de Retardos con `maxFaltas = 5`:** Como `faltasEfectivas = F + floor(R / 2)`, un alumno con `4 F + 2 R` tiene `5` faltas efectivas (**aún conserva puntos**), mientras que `5 F + 2 R` suma `6` faltas efectivas (**pierde puntos**).

---

## 5. Acciones Recomendadas

1. **Corregir H1 (`math_engine.js` L146–L147):** exigir `wFirmas > 0` en `hasFirmas` y `wExamen > 0` en `hasExamen` para evitar unidades fantasma en `0` cuando un criterio vale `0%`.
2. **Corregir H2 (`app.js` L2570–L2576 y `math_engine.js` L151):** no asignar `100%` cuando `totalMarked === 0` (dejar `null`), y excluir unidades que solo tengan asistencia hasta que exista firma o examen (salvo cursos `100%` asistencia).
3. **Corregir H3 (`math_engine.js` L155–L163):** acotar `firmas / maxF` a `[0, 1]` y `examen` a `[0, 100]` (salvo que expresamente quieran permitir firmas extra arriba del 100%).
4. **Alinear H4 y H5:** definir cómo debe verse `alerta_sd` entre calificador / Excel Docente / Excel Teams, y avisar o sincronizar faltas al editar asistencia manualmente.
5. **Agregar esta matriz completa a `tests/gradebook.test.mjs`** como pruebas automáticas permanentes (`node --test`).
