---
name: Sistema de Calificaciones y Asistencias FIUAT
description: Sistema académico institucional de alta densidad, evaluación continua y control de asistencias para la Facultad de Ingeniería Tampico (UAT).
colors:
  primary: "#e07e33"
  primary-dark: "#c1672a"
  primary-light: "#fff2e6"
  brand-night: "#0f2744"
  brand-navy: "#1b2a4a"
  brand-wine: "#772030"
  neutral-bg: "#ffffff"
  neutral-bg-secondary: "#fbfbfa"
  neutral-bg-hover: "#f4f4f2"
  neutral-text: "#0f2744"
  neutral-text-muted: "#555555"
  neutral-border: "#e4e4e2"
  status-success: "#0f7b6c"
  status-warning: "#e07e33"
  status-danger: "#b91c1c"
  status-info: "#1e3a8a"
typography:
  display:
    fontFamily: "'Visby CF', 'Poppins', -apple-system, sans-serif"
    fontSize: "clamp(1.5rem, 2.5vw, 1.75rem)"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "'Visby CF', 'Poppins', -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "'Visby CF', 'Poppins', -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "'Visby CF', 'Poppins', -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Visby CF', 'Poppins', -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.03em"
rounded:
  sm: "5px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-default:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  pill-selector:
    backgroundColor: "{colors.neutral-bg-secondary}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
    height: "34px"
  table-cell:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-text}"
    padding: "6px 8px"
---

# Design System: Sistema de Calificaciones y Asistencias FIUAT

## Overview

**Creative North Star: "El Cuaderno de Ingeniería Digital"**

El sistema de calificaciones y asistencias de la Facultad de Ingeniería Tampico (FIUAT - UAT) fusiona la inmediatez, robustez y densidad de información de una hoja de cálculo ejecutiva (estilo Excel / Notion con paneles inmovilizados) con la elegancia sobria y moderna de una suite académica institucional contemporánea.

Su propósito central es ofrecer una experiencia de captura rápida y libre de fricción a docentes universitarios en salones, cubículos y dispositivos móviles, al tiempo que proporciona paneles analíticos de supervisión en tiempo real para la Coordinación Académica. El diseño visual descarta la dispersión decorativa innecesaria en favor de la máxima legibilidad de datos, contraste accesible (WCAG AA), y jerarquía táctica mediante el color naranja institucional como acento focal.

**Key Characteristics:**
- **Zero Window Scroll en Escritorio:** El viewport se fija a 100vh. Todo el desplazamiento vertical y horizontal ocurre dentro de los contenedores de datos (tablas con freeze panes).
- **Identidad Institucional Fuerte:** Uso armónico del Azul Noche UAT (`#0f2744`), Azul Marino FI (`#1b2a4a`) y Naranja UAT (`#e07e33`), equilibrados sobre fondos neutros limpios.
- **Doble Esquema de Color Completo:** Modo Claro y Modo Oscuro nativos y contrastados gobernados por `color-scheme` y variables CSS.
- **Tipografía Geométrica Humanista:** *Visby CF* como fuente rectora oficial, aportando seriedad técnica y legibilidad en números y textos densos.

---

## Colors

La paleta cromática está anclada a los manuales de identidad de la Universidad Autónoma de Tamaulipas (UAT) y de la Facultad de Ingeniería Tampico (FIT).

### Primary & Accent
- **Naranja UAT Primario** (`#e07e33`): Color de acción principal, botones CTA, bordes activos, pestañas seleccionadas y focus rings.
- **Naranja Oscuro** (`#c1672a`): Gradientes, sombras sutiles y estados `:hover` / `:active`.
- **Naranja Suave** (`#fff2e6`): Fondos de insignias de grupo, etiquetas secundarias y alertas informativas suaves.

### Brand Institucional
- **Azul Noche UAT** (`#0f2744`): Encabezado superior institucional (`.notion-header`), títulos de página principales y texto de alto contraste.
- **Azul Marino FI** (`#1b2a4a`): Bordes de contraste en botones y subsecciones de ingeniería.
- **Guinda Universitario** (`#772030`): Detalles y acentos universitarios de apoyo.

### Neutrals (Light Mode)
- **Fondo Primario** (`#ffffff`): Lienzo principal de tablas, modales y tarjetas.
- **Fondo Secundario** (`#fbfbfa`): Fondo de cabeceras de tabla, barra de herramientas y contenedores secundarios.
- **Fondo Hover** (`#f4f4f2`): Estado hover de filas de tabla y elementos de lista.
- **Fondo Seleccionado** (`#eaeae7`): Celdas y filas activas en selección.
- **Texto Principal** (`#0f2744`): Color de tipografía base para garantizar máxima agudeza visual.
- **Texto Secundario** (`#555555`): Metadatos, descripciones y subtítulos.
- **Bordes** (`#e4e4e2` / `#eeeee9`): Separadores de tabla, divisores y contornos de inputs.

### Dark Mode Tokens (`[data-theme="dark"]`)
- **Fondo Primario:** `#191919`
- **Fondo Secundario:** `#222222`
- **Fondo Hover:** `#2d2d2d`
- **Texto Primario:** `#f5f5f7`
- **Texto Secundario:** `#a5a5a8`
- **Borde Primario:** `#333333`
- **Acento Primario:** `#f28d44` (Naranja optimizado para contraste sobre fondo oscuro)

### Semántica de Asistencias y Calificaciones
- **Asistencia / Aprobado (P):** Verde institucional (`#0f7b6c`, fondo claro `#e6f6f2`, fondo oscuro `#19382d`).
- **Retardo (R) / Pendiente:** Naranja institucional (`#e07e33`, fondo claro `#faebd7`, fondo oscuro `#3d2a13`).
- **Falta (F) / Reprobado / Sin Derecho:** Rojo institucional (`#b91c1c`, fondo claro `#fdebec`, fondo oscuro `#3d1c1c`).
- **Justificación (J):** Azul informativo (`#1e3a8a`, fondo claro `#eff6ff`, fondo oscuro `#1e293b`).

### Named Rules
- **La Regla del Acento Focal:** El color naranja institucional se reserva exclusivamente para acciones interactivas primarias, estados seleccionados y avisos críticos. No se utiliza como fondo de áreas extensas para evitar fatiga visual en sesiones prolongadas de captura.

---

## Typography

**Display & UI Font:** `Visby CF` (fallback: `'Poppins'`, `-apple-system`, `BlinkMacSystemFont`, `sans-serif`)  
**Monospace / Data Font:** `"SFMono-Regular"`, `Menlo`, `Consolas`, `monospace` (para matrículas y cálculos numéricos)

### Hierarchy
- **Display / Topbar Main:** 13.5px - 16px, Weight 700. Título institucional en encabezado.
- **Headline / Page Title:** 19px - 24px, Weight 700. Título de la materia o vista en pantalla.
- **Title / Subheading:** 13px - 14px, Weight 600. Títulos de columnas de tabla y secciones.
- **Body / Table Cell:** 12px - 13px, Weight 400 - 500. Nombres de alumnos, valores de captura y textos descriptivos.
- **Label / Tag:** 11px - 12px, Weight 700, Letter-spacing `0.025em`. Badges de estatus (P, F, R, J), grupos y semestres.

---

## Layout

1. **Estructura Vertical Fija (App Shell):**
   - **Header Institucional (`.notion-header`):** Fijado arriba (`flex: 0 0 auto`, `z-index: 100`).
   - **Banner de Supervisión (Opcional):** Para vistas de directores y coordinadores.
   - **Contenedor Principal (`.main-content`):** Ocupa exactamente el espacio remanente (`flex: 1 1 0`, `overflow: hidden`).
2. **Paneles Inmovilizados (Excel Freeze-Panes):**
   - **Fila Superior de Cabeceras (`thead th`):** `position: sticky; top: 0; z-index: 35;` con borde inferior naranja de 3px.
   - **Columna 1 (Matrícula):** `position: sticky; left: 0; z-index: 20; width: 130px;`
   - **Columna 2 (Nombre de Alumno):** `position: sticky; left: 130px; z-index: 20; width: 270px;` con sombra divisoria suave.
   - **Esquina Superior Izquierda:** Mayor jerarquía de apilamiento (`z-index: 65;`).
3. **Modo Enfoque:**
   - Permite colapsar el área de títulos (`body.gradebook-focus-mode`) para maximizar las filas visibles de la tabla a más de 25 alumnos por pantalla simultáneamente.

---

## Elevation & Depth

El sistema utiliza **elevación híbrida táctica**: superficies predominantemente planas con bordes nítidos de 1px en reposo, y sombras suaves y controladas para separar niveles de profundidad funcional.

### Shadow Vocabulary
- **Sombra Nivel 1 (`--shadow-sm`):** `0 1px 3px rgba(15, 23, 42, 0.05)` — Botones por defecto e inputs.
- **Sombra Nivel 2 (`--shadow-md`):** `0 4px 10px -1px rgba(15, 23, 42, 0.07)` — Tarjetas modales y paneles flotantes.
- **Sombra Nivel 3 (`--shadow-lg`):** `0 8px 16px -2px rgba(15, 23, 42, 0.1)` — Diálogos de advertencia y menús desplegables.
- **Sombra de Columna Congelada:** `4px 0 8px rgba(15, 23, 42, 0.06)` — Proyectada por la columna fija del nombre del alumno sobre las columnas deslizantes.

---

## Shapes

- **Radio Pequeño (`5px`):** Botones de acción, celdas interactivas, campos de texto y buscador.
- **Radio Mediano (`8px`):** Pastillas de selección de ciclo (`.gradebook-select-pill`), tarjetas y toolbars.
- **Radio Grande (`12px`):** Badges de grupo, pestañas de navegación y ventanas modales de configuración.
- **Pill / Circular (`9999px`):** Indicadores de estado de sincronización con Supabase y chips de conteo rápido.

---

## Components

### Header Institucional
- Fondo azul noche (`#0f2744`) con línea inferior naranja (`2px solid #e07e33`).
- Contenedor de logo UAT/FI con fondo blanco y radio de 7px para contraste absoluto.
- Interruptor de modo oscuro y monitoreo de conectividad en tiempo real.

### Barra de Filtros y Herramientas
- **Píldoras de Selección (`.gradebook-select-pill`):** Contenedores con borde sutil y prefijo en negrita que agrupan selects de periodo y materia.
- **Buscador Rápido:** Input con ícono de lupa integrado y borde reactivo al enfoque.
- **Botón Primario (`.btn-primary`):** Fondo degradado naranja (`#e07e33` a `#c1672a`), texto blanco, texto en negrita y altura estándar de 36px.

### Sábana de Calificaciones y Asistencias
- Celdas con alto confort de clic/toque (mínimo 32px de alto).
- Estados de asistencia con color de texto y fondo unificados:
  - `P` (Presente): Verde
  - `F` (Falta): Rojo
  - `R` (Retardo): Naranja
  - `J` (Justificado): Azul
- Resaltado automático al pasar el cursor (`tr:hover`) que respeta la solidez de fondo en columnas congeladas para evitar superposiciones transparentes.

---

## Do's and Don'ts

### Do:
- **Do** respetar siempre la inmovilización de paneles al rediseñar la sábana de notas. La matrícula y el nombre del estudiante nunca deben perderse de vista al hacer scroll horizontal.
- **Do** mantener el ratio de contraste accesible (mínimo 4.5:1 para texto normal y 3:1 para controles UI grandes) tanto en Modo Claro como en Modo Oscuro.
- **Do** preservar los colores oficiales de la Universidad (`#0f2744`, `#1b2a4a`, `#e07e33`) en encabezados e identidades de marca.
- **Do** optimizar cada pantalla para un uso rápido con teclado (Tab, Enter, flechas) y pantallas táctiles en tablets dentro del aula.

### Don't:
- **Don't** permitir que el documento completo (`html`/`body`) haga scroll infinito en escritorios; el contenedor de la tabla debe gestionar su propio desplazamiento.
- **Don't** utilizar rojos o verdes genéricos chillones. Utilizar siempre las variantes institucionales calibradas (`--color-green: #0f7b6c`, `--color-red: #b91c1c`).
- **Don't** saturar las tablas con sombras o bordes pesados que distraigan de los números y cálculos académicos.
- **Don't** alterar la base de datos o lógica de negocio al modificar los estilos visuales de la interfaz.
