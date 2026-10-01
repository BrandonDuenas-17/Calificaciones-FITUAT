# 📌 RESUMEN DE ESTADO, CONTEXTO Y BITÁCORA DIARIA DEL PROYECTO
**Última actualización:** 1 de Octubre de 2026  
**Proyecto:** Sistema de Calificaciones FIUAT • Control Docente y Supervisión Académica  
**Organización:** Facultad de Ingeniería Tampico (Universidad Autónoma de Tamaulipas)  
**Repositorio GitHub:** [https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git](https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git)  
**Rama activa:** `main`  
**Versión en Producción (Vercel):** `2026.10.01.v37` (URL: [https://calificaciones-fituat.vercel.app/](https://calificaciones-fituat.vercel.app/))  

---

## 📜 1. Reglas Operativas Estrictas del Proyecto (Mandatorias)
Codificadas en `AGENTS.md` y `.agents/rules/project_rules.md` para todo agente de IA y desarrollador:
1. **Preservación Absoluta de Datos Existentes:**
   - CERO pérdida de datos. Prohibido reiniciar, sembrar de cero o sobrescribir calificaciones, materias, listas de alumnos y evaluaciones (columna `data` en Supabase).
   - Las contraseñas personalizadas y los usuarios del catálogo no deben ser reseteados masivamente.
   - Verificación continua del conteo íntegro de **154 docentes** y sus 771 materias antes y después de cualquier cambio.
2. **Preservación y Fortalecimiento de la Seguridad:**
   - CERO bypasses o contraseñas hardcodeadas (prohibido aceptar `"admin"` o `"123"` fuera de validación contra la base de datos).
   - Defensa en profundidad: control de acceso estricto por rol (`isAdmin()`), protección contra escalación por consola con `Object.freeze`, firmas criptográficas efímeras (SEC-02), bloqueo por fuerza bruta (5 intentos = 60s), cierre por inactividad (20 min) y sanitización anti-fórmulas en CSV/Excel (CWE-1236).
   - Toda actualización de credenciales debe ser confirmada afirmativamente por la base de datos remota antes de notificar éxito.
3. **GitOps y Despliegue Limpio en GitHub:**
   - Commits semánticos y verificados. Push obligatorio a `origin/main` dejando el árbol de trabajo completamente limpio (`working tree clean`).
   - Cache-busting sistemático (`vXX`) en `index.html` para todos los archivos estáticos modificados (`app.js`, `styles.css`, `supabase_service.js`).

---

## 🗓️ 2. Bitácora Diaria de Cambios y Contexto (Historial por Día)

### 📅 1 de Octubre de 2026 (Versión v37)

#### 1. Integración de Selector de Semestre y Filtrado Reactivo de Listas
* **Requerimiento:** Integrar junto al selector de grupo un control para seleccionar el semestre (ej. `2026 - 3 OTOÑO`, `2026 - 1 PRIMAVERA`) que filtre de forma inmediata las listas del docente para mostrar solo las del periodo seleccionado, garantizando **cero mezcla de listas** y **preservación absoluta de calificaciones**.
* **Solución Implementada:**
  - **Doble Selector Encapsulado en Píldoras Estilizadas:** Se rediseñó la cabecera del calificador y del módulo de asistencias para albergar `.gradebook-switchers-row` con dos controles acoplados:
    1. **Píldora de Semestre (`.gradebook-semester-pill`):** Dropdown con etiqueta `SEMESTRE:`, acento naranja institucional UAT y listado dinámico de periodos (`2026 - 3 OTOÑO`, `2026 - 1 PRIMAVERA` y cualquier periodo personalizado).
    2. **Píldora de Materia/Grupo (`.gradebook-course-pill`):** Dropdown con etiqueta `LISTA / GRUPO:`, agrupado por materia con `<optgroup>`, filtrado reactivamente para mostrar únicamente los cursos del semestre activo.
  - **Aislamiento Criptográfico y Reactivo:** Al cambiar de semestre, el sistema no altera ni sobrescribe ninguna calificación. Si el docente selecciona un semestre sin materias creadas aún, se despliega una vista limpia y segura (`renderEmptyGradebook`) con acceso directo a crear una materia en dicho periodo o volver con un clic a `2026 - 3 OTOÑO`.
  - **Modal de Creación y Ajustes Actualizado:** Tanto al crear una nueva lista como al editar ajustes o duplicar grupos, el campo de periodo se sincroniza y preselecciona el semestre activo con un `<datalist>` institucional.
  - **Despliegue y Cache-Busting:** Versión `2026.10.01.v37` desplegada en GitHub con cache-busting en `index.html`, `styles.css` y `app.js`.

---

### 📅 23 de Septiembre de 2026 (Versiones v34 y v35)

#### 1. Blindaje Criptográfico de Cuenta Maestra y Eliminación de Bypasses
* **Problema:** Existía inconsistencia en la autenticación de la cuenta maestra (`admin-coordinacion`), donde tras un cambio de contraseña se permitían accesos por claves por defecto hardcodeadas en scripts de contingencia (`"admin"`, `"123"`).
* **Acción:**
  - Se eliminaron todos los bypasses y claves fijas del frontend.
  - La autenticación de la Cuenta Maestra ahora se valida estrictamente contra Supabase mediante la función RPC `verify_teacher_credentials` protegida con bcrypt.
  - Se blindó el modal administrativo para exigir la contraseña real del administrador actual antes de autorizar cualquier cambio de contraseña a un docente.
* **Resultado:** Seguridad criptográfica estricta sin atajos; las contraseñas cambiadas son las únicas que otorgan acceso.

#### 2. Codificación Formal de Reglas del Proyecto
* **Acción:** Se crearon los archivos normativos [AGENTS.md](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/AGENTS.md) y [.agents/rules/project_rules.md](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/.agents/rules/project_rules.md) para garantizar la continuidad operativa, el blindaje de datos y la disciplina en Git.
* **Mantenimiento:** Se eliminaron scripts temporales en `.agents/` para erradicar advertencias en el panel de problemas del entorno de desarrollo.

#### 3. Corrección del Empalme Visual en Modo Supervisión (`v34`)
* **Problema:** Al auditar a un docente desde la cuenta de coordinación, la pantalla se veía empalmada y duplicada.
* **Causa Raíz:** Existían dos banners de supervisión renderizándose al mismo tiempo (uno en `#supervisionBannerContainer` y otro concatenado dentro de `renderGradebook`), sumado a reglas CSS heredadas con `position: sticky; top: 60px` que montaban el banner directamente sobre el título y los botones de la materia.
* **Solución:**
  - Se eliminó el banner interno duplicado de `renderGradebook`.
  - Se unificó toda la información en una sola barra superior estilizada (`.supervision-top-bar`) con badge dinámico (`✏️ MODO EDICIÓN` / `👁️ MODO AUDITORÍA`), conmutador de modo y botón para volver al panel maestro.
  - Se desplegó en Vercel con cache-busting `2026.09.23.v34`.

#### 4. Corrección de Inconsistencia de Encabezados entre Materias (`v35`)
* **Problema:** En materias con nombres cortos (ej. *Administración por Calidad Total*), el calificador se mostraba en 2 filas limpias; pero en materias con claves y nombres largos (ej. *RC.HB005.2970.3-3.EO2 - (RC.HB005.2970.3-3) SUSTENTABILIDAD Y RESPONSABILIDAD SOCIAL*, 88 caracteres), la cabecera se rompía en 4 filas desarticuladas y el `<select>` se inflaba a más de 850px de ancho.
* **Causa Raíz:**
  1. El elemento nativo `<select>` incluía etiquetas `<optgroup label="...">` sin ancho máximo delimitado (`max-width`), provocando que el navegador lo expandiera al ancho del texto más largo.
  2. Título, selector de grupo y los 6 botones de acción estaban mezclados en un único contenedor flexible (`.page-title-row`) con `flex-wrap: wrap`, haciendo que la longitud del nombre colisionara aleatoriamente y empujara los controles a filas distintas según la materia.
* **Solución Implementada:**
  - Rediseño desacoplado en **dos filas fijas e independientes** para todas las materias:
    - **Fila 1 (`.gradebook-header-top`):** Título de la materia y badge de grupo con elipsis fluida (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) a la izquierda, y Selector de Grupo con ancho controlado (`width: 250px; max-width: 270px`) a la derecha.
    - **Fila 2 (`.gradebook-header-bottom`):** Subtítulo con periodo y número de unidades a la izquierda, y Stepper de Unidades (`[UNIDADES: - 5 +]`) con los 5 botones de acción (`Nueva Lista`, `Ajustes`, `Pegar Alumnos`, `Vaciar Grupo`, `Descargar Excel`) a la derecha.
  - Sanitización HTML en los atributos `<optgroup label="${this.escapeHtml(subject)}">`.
  - Soporte responsivo para pantallas pequeñas (`<= 768px` y `<= 480px`).
* **Resultado:** Uniformidad visual absoluta en el 100% de las materias del catálogo.
* **Commit:** [`dd1fce8`](https://github.com/BrandonDuenas-17/Calificaciones-FITUAT/commit/dd1fce8) subido a GitHub y activo en producción bajo `v35`.

---

### 📅 19 de Septiembre de 2026 (Versión v33)

#### 1. Restauración de Materias y Listas en el Panel de Supervisión
* **Diagnóstico:** En una fase de optimización de red, `fetchTeachers()` había omitido el campo `data`, provocando que las tarjetas de profesores mostraran *"0 listas"* y *"Alumnos en catálogo: 0"*.
* **Solución:** Se reincorporó `data` en la proyección `select()` autorizada en [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js), preservando la columna sensible `password` excluida.
* **Resultado:** Las tarjetas de los profesores desplegaron sus materias reales, alumnos y métricas globales de la facultad (771 materias, 18,702 inscripciones).

#### 2. Módulo de Administración de Cuentas y Restablecimiento de Claves Docentes
* **Objetivo:** Resolver contingencias de docentes con claves extraviadas sin intervención directa en base de datos.
* **Solución:** Botón `[ 🔒 Administrar Cuenta / Clave ]` en cada tarjeta del panel maestro con modal para asignar contraseña personalizada o restablecer a clave por defecto (`123`).
* **Seguridad:** Implementación del RPC seguro `admin_reset_teacher_password` con `SECURITY DEFINER` y verificación estricta de rol `admin`.
* **Caso:** Contraseña de **Alejandro González Turrubiates** (`agturrubiates`) restablecida exitosamente.

---

## 🏛️ 3. Arquitectura y Cuentas del Sistema

### A. Cuentas Integradas:
* **Coordinación / Dirección Académica (Cuenta Maestra):**
  * **Usuario:** `admin-coordinacion` / `dir_academica`
  * **Rol:** `admin` (exclusivo para Coordinación Académica FIUAT).
  * **Capacidades:**
    * Supervisión en tiempo real de los 154 docentes de la facultad.
    * Auditoría de actas y calificaciones con conmutador dinámico (Modo Auditoría Solo Lectura / Modo Edición Autorizada).
    * Métricas generales de la facultad (771 materias, 18,702 inscripciones, promedios).
    * Búsqueda instantánea de profesores por nombre o asignatura.
    * Administración centralizada de cuentas docentes y restablecimiento autorizado de credenciales.
* **Plantilla Docente Oficial (154 Registros):**
  * Acceso automático con credenciales institucionales normalizadas (`CUENTAS_DOCENTES_FIUAT.csv`).
  * Cada profesor cuenta con sus materias asignadas y sus listas de alumnos oficiales con matrícula de 10 dígitos y nombres en altas.
  * Gestión de contraseña personal mediante procedimiento seguro `change_teacher_password`.

### B. Infraestructura en la Nube (Supabase PostgreSQL):
* **Proveedor:** Supabase Database (PostgreSQL 15+ con extensión `pgcrypto`).
* **Tabla Principal:** `public.teachers` con Row Level Security (RLS) habilitado.
* **Persistencia JSONB:** Columna `data` conteniendo el árbol completo de materias (`courses`), configuraciones de firmas, períodos, aulas y alumnos (`students`).
* **Sincronización Reactiva:**
  * Indicador dinámico de estado en barra superior: `🟢 Nube Sincronizada (Supabase)`.
  * Indicador reactivo en el pie de tabla: `🟢 Sincronizado en la nube (Supabase) · [hh:mm:ss]`.
  * Escuchadores en tiempo real (`listenToTeacher`) para reflejar cambios en vivo durante auditorías.

---

## 🛡️ 4. Blindajes de Seguridad en Profundidad

| Mecanismo de Seguridad | Nivel | Descripción y Blindaje |
| :--- | :---: | :--- |
| **Aislamiento de Contraseñas** | Base de Datos (PostgreSQL) | `revoke select on public.teachers` aplicado; la columna `password` está estrictamente excluida de consultas REST y solo se opera mediante RPCs con `SECURITY DEFINER`. |
| **Encriptación Bcrypt** | Base de Datos (pgcrypto) | Las contraseñas se almacenan mediante hash bcrypt (`$2a$08$`) generado por `public.crypt()` y `public.gen_salt('bf', 8)`. |
| **Protección Anti-XSS** | Cliente (`app.js`) | Celdas dinámicas e inputs del calificador operan exclusivamente con índices numéricos puros `${index}`, neutralizando cualquier inyección por matrícula o nombre. |
| **Firma Criptográfica de Sesión** | Cliente (`app.js`) | Clave efímera de 256 bits generada dinámicamente con `crypto.getRandomValues()` en `_getSessionSecret()`; tokens y firmas validadas contra manipulación local. |
| **Control de Acceso (RBAC)** | Cliente y Servidor | Métodos administrativos (`superviseTeacher`, `openAdminManageTeacherModal`, `syncFullFacultyRoster`) protegidos por `isAdmin()`; el setter `currentUser` bloquea manipulaciones de rol en caliente con `Object.freeze`. |
| **Content Security Policy (CSP)** | Encabezados (`index.html`) | Directivas estrictas de seguridad sin `'unsafe-eval'` y anti-clickjacking para prevenir incrustación maliciosa en iframes. |
| **Modo Solo Lectura en Auditoría** | Cliente (`app.js`) | Al auditar a un docente, se bloquea la modificación de notas, duplicado de grupos y vaciado de listas a menos que el administrador active explícitamente el Modo Edición. |
| **Sanitización contra Inyección CSV** | Cliente (`exporter.js`) | Celdas prefijadas con `=`, `+`, `-`, `@` son neutralizadas para prevenir ejecución de fórmulas maliciosas en Excel (CWE-1236 - SEC-07). |

---

## 📂 5. Directorio de Archivos del Proyecto y Roles

* [index.html](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/index.html):
  * Estructura principal, modales institucionales (Registro, Cambio de Contraseña, Sincronización Roster, y Administración de Cuentas Docentes), directivas CSP, inyección de estilos críticos y contenedor de toasts. Versión activa: `v35`.
* [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js):
  * Controlador central: gestión de sesión, panel de control administrativo, renderizado del calificador en 2 filas fijas, navegación tipo Excel, atajos de teclado, modo supervisión y validaciones de seguridad.
* [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js):
  * Módulo singleton para la comunicación con Supabase PostgreSQL: autenticación vía RPC, consulta de profesores, persistencia de calificaciones y restablecimiento administrativo de claves.
* [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql):
  * Script DDL completo de PostgreSQL: definición de tabla `teachers`, políticas RLS, permisos por columna y funciones RPC seguras (`verify_teacher_credentials`, `change_teacher_password`, `admin_reset_teacher_password`, `save_teacher_grades`).
* [styles.css](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/styles.css):
  * Identidad gráfica institucional FIUAT (#212052 Azul Noche, #E07E33 Naranja UAT), estilos Notion, temas Claro/Oscuro, barra unificada de supervisión y diseño responsivo para encabezados de materia en 2 filas fijas.
* [faculty_roster.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/faculty_roster.js):
  * Catálogo oficial compilado de los profesores, materias/grupos y listas completas de alumnos extraídas del archivo institucional de la facultad.
* [CUENTAS_DOCENTES_FIUAT.csv](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/CUENTAS_DOCENTES_FIUAT.csv) / [CUENTAS_DOCENTES_FIUAT.md](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/CUENTAS_DOCENTES_FIUAT.md):
  * Directorio oficial de usuarios y credenciales de acceso para los profesores de la FIUAT.
* [exporter.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/exporter.js):
  * Generación y exportación de actas y listas oficiales en formato Excel mediante SheetJS con soporte para Modo Privacidad y sanitización de fórmulas.
* [AGENTS.md](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/AGENTS.md):
  * Reglas de comportamiento operativo mandatorio para cualquier agente de IA (Cero pérdida de datos, Cero bypasses, GitOps limpio).

---

## 🎯 6. Estado Actual del Sistema

* ✅ **100% en la Nube:** Conectado a Supabase PostgreSQL con estado activo y sincronización en tiempo real.
* ✅ **Datos 100% Íntegros:** **154 registros docentes** y 771 materias verificados en base de datos. Ningún registro ni calificación alterada.
* ✅ **Panel de Supervisión Funcional y Desacoplado:** Barra superior unificada de supervisión (`.supervision-top-bar`) con alternancia entre Auditoría y Edición.
* ✅ **Calificador Uniforme en 2 Filas:** Todas las materias (cortas o largas) despliegan exactamente la misma estructura alineada y estética sin colisiones ni desbordamientos (`v35`).
* ✅ **Seguridad Criptográfica Intacta:** Autenticación bcrypt activa, sin claves hardcodeadas ni bypasses.
* ✅ **Git y Despliegue en Vivo:** Repositorio local sincronizado al 100% con `origin/main` en GitHub y desplegado en producción en Vercel.
