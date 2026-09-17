# 📌 RESUMEN DE ESTADO Y CONTEXTO DEL PROYECTO
**Fecha de corte:** 16 de Septiembre de 2026  
**Proyecto:** Sistema de Calificaciones FIUAT • Control Docente y Supervisión Académica  
**Organización:** Facultad de Ingeniería Tampico (Universidad Autónoma de Tamaulipas)  
**Repositorio GitHub:** [https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git](https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git)  
**Rama activa:** `main` | **Último Commit:** `15c93ea`

---

## 🏛️ 1. Arquitectura y Credenciales del Sistema

### A. Autenticación y Cuentas Integradas:
* **Coordinación / Dirección Académica (Perfil Maestro):**
  * **Usuario:** `admin` | **Contraseña:** `admin`
  * **Permisos:** Supervisión en vivo de todos los docentes, auditoría de actas, métricas globales de facultad y respaldo total.
* **Docente 1:**
  * **Usuario:** `rgarcia` | **Contraseña:** `123`
  * **Nombre:** Ing. Roberto García M. (*Ciencias Básicas*)
  * **Materias:** Álgebra Lineal (Grupo A, Grupo B), Cálculo Integral.
* **Docente 2:**
  * **Usuario:** `msanchez` | **Contraseña:** `123`
  * **Nombre:** Dra. Martha Elena Sánchez (*Ingeniería en Sistemas*)
  * **Materias:** Programación Web, Bases de Datos Avanzadas.
* **Registro de Nuevos Docentes:** Funcional desde la pantalla de login o desde el panel maestro.

### B. Integración en la Nube (Firebase Firestore):
* **ID de Proyecto:** `calificaciones-fiuat`
* **Configuración:**
  * `apiKey`: `AIzaSyD0QmIKjqrcblDJFoel30OGdSuslvwJnuM`
  * `authDomain`: `calificaciones-fiuat.firebaseapp.com`
  * `projectId`: `calificaciones-fiuat`
  * `storageBucket`: `calificaciones-fiuat.firebasestorage.app`
* **Colección Principal:** `teachers` (documentos por `teacherId` para aislamiento total).
* **Mecanismos de Sincronización:**
  * `onSnapshot` con filtro `hasPendingWrites` para evitar re-renderizados con ecos locales.
  * Persistencia offline activada en el navegador.
  * Indicador dinámico de estado en la barra superior: `🟢 Nube Sincronizada` / `🟡 Modo Local`.

---

## ⚡ 2. Optimizaciones de Rendimiento y Fluidez Implementadas

1. **Renderizado Determinista O(1) en Paso Único (`table-layout: fixed`)**:
   * Las tablas (`.notion-table-gradebook` y Directorio) tienen anchos estrictamente fijados por columna en el `<thead>`.
   * El navegador calcula las dimensiones en un solo paso, eliminando por completo los ciclos de reflujo (*reflow jank*) al teclear notas.
2. **Auto-Selección tipo Excel (`onfocus="this.select()"`)**:
   * Cualquier celda numérica seleccionada con clic o navegación por teclado (**Tab**, **Enter**, Flechas) sombrea el valor para sobreescritura directa.
3. **Desacoplamiento de Guardado**:
   * LocalStorage rápido a 250ms.
   * Firestore en lotes a 1200ms para no saturar la red ni bloquear la interfaz.
4. **Actualización Quirúrgica del DOM**:
   * Los cálculos de unidad, barras de progreso y anillos SVG se actualizan por ID sin re-construir el HTML de la tabla.
5. **Estética Limpia**:
   * Flechas nativas del navegador (*spin-buttons*) ocultas para simular fielmente una hoja de cálculo profesional.

---

## 📂 3. Estructura de Archivos del Proyecto

* [index.html](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/index.html):
  * Estructura base, modales de gestión, inclusión de fuentes Visby CF y SDKs de Firebase v8.
* [app.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/app.js):
  * Lógica central del sistema: sesión, switch de materias, renderGradebook, renderDirectory, renderTeams, renderAdmin, cálculos reactivos de fórmulas, navegación de teclado y escuchadores de Firebase.
* [styles.css](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/styles.css):
  * Identidad gráfica institucional FIUAT (#212052 Azul Noche, #E07E33 Naranja UAT, Modo Oscuro), layout de tabla Notion, animaciones optimizadas por hardware.
* [firebase_service.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/firebase_service.js):
  * Módulo singleton para inicialización, guardado de docentes y listener en tiempo real de supervisión.
* [exporter.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/exporter.js):
  * Generación de libros de Excel oficiales para Microsoft Teams mediante SheetJS, con soporte para Modo Privacidad.
* [sample_data.js](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/sample_data.js):
  * Semilla inicial con las materias, alumnos y docentes predeterminados.
* [LEEME_INSTRUCCIONES.md](file:///c:/Users/andre/OneDrive/Documentos/Proyectos/Calificaciones%20Inge/LEEME_INSTRUCCIONES.md):
  * Guía detallada para los maestros sobre cómo usar la aplicación y cargar listas.

---

## 🚀 4. Estado de Despliegue en Git

* **Repositorio Remoto:** `origin` $\rightarrow$ `https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git`
* **Rama Principal:** `main`
* **Commits Clave:**
  * `0973307`: Primer commit (Sistema FIUAT con Perfil Maestro y Teams).
  * `ecc82fd`: Integración con Firebase Firestore (Persistencia en la nube y tiempo real).
  * `2e19914`: Optimización de debounce inteligente, auto-selección y prevención de re-renders.
  * `15c93ea`: Optimización de rendimiento definitiva: `table-layout: fixed` determinista $O(1)$, anchos de columna y eliminación de spin-buttons.
* El repositorio está al día y limpio (`working tree clean`). Cualquier servicio como Vercel o GitHub Pages refleja la última versión automáticamente.

---

## 🎯 5. Siguientes Pasos para Mañana / Próxima Sesión

Cuando retomemos el proyecto mañana, todo estará listo para:
1. Revisar si deseas agregar nuevas materias, campos o ajustar fórmulas.
2. Explorar funciones adicionales (por ejemplo, gráficas estadísticas avanzadas, filtros adicionales o exportaciones en nuevos formatos).
3. Cualquier otra mejora o ajuste fino que consideres conveniente.
