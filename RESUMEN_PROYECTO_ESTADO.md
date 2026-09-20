# 📌 RESUMEN DE ESTADO Y CONTEXTO DEL PROYECTO
**Fecha de corte:** 17 de Septiembre de 2026  
**Proyecto:** Sistema de Calificaciones FIUAT • Control Docente y Supervisión Académica  
**Organización:** Facultad de Ingeniería Tampico (Universidad Autónoma de Tamaulipas)  
**Repositorio GitHub:** [https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git](https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git)  
**Rama activa:** `main`

---

## 🏛️ 1. Arquitectura y Cuentas del Sistema

### A. Autenticación y Cuentas Integradas:
* **Coordinación / Dirección Académica (Perfil Maestro):**
  * **Acceso:** Cuenta de Coordinación Académica protegida mediante función RPC `verify_teacher_credentials` con cifrado bcrypt.
  * **Permisos:** Supervisión en vivo de los docentes de la facultad, auditoría de actas en modo de solo lectura, métricas globales de facultad, buscador instantáneo y administración centralizada.
* **Plantilla Docente Oficial:**
  * Acceso automático con credenciales institucionales normalizadas (o ingreso supervisado por Coordinación).
  * Cada profesor cuenta con sus materias asignadas y sus listas de alumnos oficiales con matrícula de 10 dígitos.
  * Contraseñas gestionadas y validadas a través del procedimiento almacenado `change_teacher_password` con hash `pgcrypto` (`$2a$08$`).
* **Registro de Nuevos Docentes:** Funcional desde el panel maestro y sincronizado a Supabase.

### B. Arquitectura 100% en la Nube (Supabase PostgreSQL):
* **Infraestructura:** Supabase Database (PostgreSQL 15+ con extensión `pgcrypto`).
* **Tabla Principal:** `public.teachers` con Row Level Security (RLS) habilitado.
* **Mecanismos de Sincronización 100% Cloud:**
  * Carga inicial optimizada desde Supabase (`fetchTeachers`), restringiendo columnas sensibles.
  * Columna `password` revocada de consultas REST API directas (solo accesible vía RPC `SECURITY DEFINER`).
  * Sin almacenamiento local de catálogos (`localStorage` eliminado para catálogos).
  * Sesión aislada por pestaña (`sessionStorage`) con validación de clave efímera de 256 bits.
  * Indicador dinámico de estado en la barra superior: `🟢 Nube Sincronizada`.
  * Indicador reactivo en el pie de tabla: `🟢 Sincronizado en la nube (Supabase) · [hh:mm]`.

---

## 📊 2. Carga Masiva de Plantilla Oficial (Excel Roster)

* **Origen de Datos:** `ReporteGruposDetalle (10).xlsx` (18,702 filas oficiales de la UAT).
* **Extracción de Alto Rendimiento:**
  * Procesado mediante OpenXML y serialización UTF-8 en segundos sin consumo innecesario de tokens.
  * Generación del catálogo [faculty_roster.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/faculty_roster.js) con 153 profesores, 353 materias/grupos y listas completas de alumnos.
* **Motor de Sincronización en Lote (`FirebaseService.syncFullFacultyRoster`):**
  * Sincronización directa en Firestore mediante commits por lotes (`batch`) de 25 documentos para evitar saturación de red.
  * Modal interactivo de sincronización `#syncRosterModal` con barra de progreso porcentual en tiempo real.
* **Buscador en Tiempo Real de Docentes:**
  * Filtro instantáneo `#adminTeacherSearch` en el Panel de Administración y `#switchTeacherSearch` en el modal de cambio de docente.
  * Permite localizar inmediatamente a cualquier profesor por nombre, apellido o materia asignada.

---

## ⚡ 3. Optimizaciones de Rendimiento y Fluidez

1. **Renderizado Determinista O(1) en Paso Único (`table-layout: fixed`)**:
   * Las tablas (`.notion-table-gradebook` y Directorio) tienen anchos estrictamente fijados por columna en el `<thead>`.
   * El navegador calcula las dimensiones en un solo paso, eliminando por completo los ciclos de reflujo (*reflow jank*) al teclear notas.
2. **Auto-Selección tipo Excel (`onfocus="this.select()"`)**:
   * Cualquier celda numérica seleccionada con clic o navegación por teclado (**Tab**, **Enter**, Flechas) sombrea el valor para sobreescritura directa.
3. **Guardado Directo y Reactivo a Firestore**:
   * Guardado directo en la nube con debounce optimizado a 500ms al teclear notas continuas.
   * Guardado inmediato al agregar/eliminar registros, cursos o nuevos docentes.
4. **Corrección de Modo Oscuro en Área de Firmas**:
   * Celdas numéricas de firmas adaptadas con `color: inherit;` y reglas `#f5f5f7` para visibilidad perfecta con alto contraste.
5. **Estética Limpia**:
   * Flechas nativas del navegador (*spin-buttons*) ocultas para simular fielmente una hoja de cálculo profesional.

---

## 📂 4. Estructura de Archivos del Proyecto

* [index.html](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/index.html):
  * Estructura base, modales de gestión, modal de sincronización masiva con barra de progreso, buscador de profesores y fuentes institucionales.
* [app.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/app.js):
  * Lógica central del sistema: sesión, switch de materias, renderGradebook, buscador en tiempo real de docentes, cálculos reactivos de fórmulas, navegación de teclado y escuchadores de Firebase.
* [styles.css](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/styles.css):
  * Identidad gráfica institucional FIUAT (#212052 Azul Noche, #E07E33 Naranja UAT, Modo Oscuro corregido), barra de progreso, buscador y diseño Notion.
* [firebase_service.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/firebase_service.js):
  * Módulo singleton para inicialización, guardado de docentes, listener en tiempo real de supervisión y `syncFullFacultyRoster` por lotes.
* [faculty_roster.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/faculty_roster.js):
  * Catálogo oficial compilado de los 153 profesores y sus asignaturas/alumnos extraídos del Excel institucional.
* [exporter.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/exporter.js):
  * Generación de libros de Excel oficiales para Microsoft Teams mediante SheetJS, con soporte para Modo Privacidad.
* [sample_data.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/sample_data.js):
  * Semilla inicial con las materias, alumnos y docentes predeterminados.
* [LEEME_INSTRUCCIONES.md](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/LEEME_INSTRUCCIONES.md):
  * Guía detallada para los maestros sobre cómo usar la aplicación y cargar listas.

---

## 🎯 5. Estado Actual del Sistema
* ✅ 100% en la nube (Firebase Firestore).
* ✅ 18,702 registros del Excel cargados y estructurados.
* ✅ 153 profesores listos en la nube con sus listas oficiales de alumnos y materias.
* ✅ Buscador instantáneo operativo para supervisión ágil.
* ✅ Modo oscuro corregido en área de firmas.
* ✅ Fórmulas y ponderaciones verificadas.
