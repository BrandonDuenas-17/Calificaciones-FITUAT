---
name: Executive Academic Grid
colors:
  surface: '#fef8f7'
  surface-dim: '#ded9d8'
  surface-bright: '#fef8f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f2f2'
  surface-container: '#f3ecec'
  surface-container-high: '#ede7e6'
  surface-container-highest: '#e7e1e1'
  on-surface: '#1d1b1b'
  on-surface-variant: '#5c403b'
  inverse-surface: '#323030'
  inverse-on-surface: '#f6efef'
  outline: '#906f6a'
  outline-variant: '#e5bdb7'
  surface-tint: '#bc160a'
  primary: '#960200'
  on-primary: '#ffffff'
  primary-container: '#be180c'
  on-primary-container: '#ffd0c9'
  inverse-primary: '#ffb4a8'
  secondary: '#ac331e'
  on-secondary: '#ffffff'
  secondary-container: '#fb6b50'
  on-secondary-container: '#660a00'
  tertiary: '#4a4747'
  on-tertiary: '#ffffff'
  tertiary-container: '#625f5f'
  on-tertiary-container: '#dfd9d9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad4'
  primary-fixed-dim: '#ffb4a8'
  on-primary-fixed: '#410000'
  on-primary-fixed-variant: '#930200'
  secondary-fixed: '#ffdad3'
  secondary-fixed-dim: '#ffb4a5'
  on-secondary-fixed: '#3f0400'
  on-secondary-fixed-variant: '#8b1a07'
  tertiary-fixed: '#e7e1e1'
  tertiary-fixed-dim: '#cac5c5'
  on-tertiary-fixed: '#1d1b1b'
  on-tertiary-fixed-variant: '#494646'
  background: '#fef8f7'
  on-background: '#1d1b1b'
  surface-variant: '#e7e1e1'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 1.625rem
    fontWeight: '700'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 1.25rem
    fontWeight: '700'
    lineHeight: 1.5rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.25rem
  title-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.125rem
  body-default:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.125rem
  body-numeric:
    fontFamily: Space Grotesk
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: 0.02em
  body-caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  label-badge:
    fontFamily: Space Grotesk
    fontSize: 0.6875rem
    fontWeight: '700'
    lineHeight: 0.875rem
    letterSpacing: 0.04em
  label-code:
    fontFamily: Space Grotesk
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 0.875rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.625rem
  space-lg: 0.875rem
  space-xl: 1.25rem
---

## Brand & Style

The design system establishes a high-density, engineering-grade academic workstation modeled on executive spreadsheets and institutional software. Crafted specifically for faculty instructors, administrators, and departmental directors, the UI operates as a digital ledger: utilitarian, razor-sharp, zero-distraction, and mathematically precise. It dispenses with generic SaaS ornamentation, dashboard metric cards, floating sidebars, and oversized empty space in favor of immediate data throughput and rigorous density.

The aesthetic fuses **Corporate Engineering Modernism** with **Notion/Excel-inspired data density**. Visual authority is anchored in university heritage—deep crimson and dark red tones juxtaposed with high-impact crimson technical accents. Surfaces are crisp, bounded by exact 1px geometric borders, rigid column alignments, frozen ledger planes, and immediate typographic readability for dense numeric tables.

Emotional goals:
- **Operational Trust:** Faculty members feel in complete command of complex evaluations and grade matrices.
- **Utilitarian Speed:** Frictionless tabular keyboard navigation, rapid status cycling, zero layout shifts.
- **Academic Rigor:** Institutional prestige maintained through balanced, restrained color and razor-sharp typographic discipline.

## Colors

The color architecture enforces strict institutional hierarchy while preserving data clarity across prolonged desktop sessions.

- **Primary (`#be180c`):** Action crimson drives primary touchpoints—commit actions, active tab indicators, keyboard cell focus outlines, and urgent visual cues. It is strictly forbidden from covering expansive background surfaces to prevent retinal fatigue.
- **Secondary (`#7c0e00`):** Deep Crimson forms the institutional spine, enveloping the fixed primary navigation bar, primary brand badges, and dominant typography for maximum contrast.
- **Tertiary (`#262424`):** Dark neutral serves as a structural secondary tint, anchoring table category headers, multi-tiered header borders, and technical framing.
- **Neutrals (`#4b4848`, `#e4e4e2`, `#fbfbfa`, `#ffffff`):** Provide a neutral, paper-like surface canvas. Sub-pixel contrasts between `#fbfbfa` (table column headers and toolbars) and `#ffffff` (data cells) ensure crisp grid perception.

### Color Rules
- **Semantic Cell Badging:** 
  - *Present / Approved (`P`):* `#0f7b6c` text on `#e6f6f2` tint.
  - *Late / Pending (`R`):* `#be180c` text on `#faebd7` tint.
  - *Absent / Failed (`F`):* `#b91c1c` text on `#fdebec` tint.
  - *Excused (`J`):* `#1e3a8a` text on `#eff6ff` tint.
- **Frozen Header Anchoring:** Frozen columns (`Matrícula`, `Nombre`) maintain 100% solid opacity (`#ffffff` in default cells, `#fbfbfa` in headers) to eliminate ghosting artifacts over horizontally scrolling data cells.

## Typography

The typography pairs geometric discipline with technical clarity. `Space Grotesk` governs headlines, numeric fields, badges, and frozen student identifiers, ensuring tabular precision and distinct glyph boundaries. `Plus Jakarta Sans` provides geometric humanist balance for full student names, toolbar action labels, and instructional secondary text.

### Implementation Principles
- **Data Densification:** Standard body typography operates at `0.8125rem` (13px), calibrated with a compact `1.125rem` (18px) line height to preserve vertical space in massive grade sheets.
- **Tabular Numerics:** All grade evaluations, IDs (`Matrícula`), weights, and unit averages must render with tabular figures (`font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1`) to ensure perfect vertical decimal alignment across 60+ row batches.
- **Badge All-Caps:** Status labels (`APROBADO`, `REPROBADO`, `P`, `F`, `R`, `J`) render in `Space Grotesk` at `0.6875rem` (11px) with bold weight and `0.04em` letter-spacing for instantaneous perceptual distinction.

## Layout & Spacing

### Strict Zero-Scroll 100vh Architecture
This design system enforces a **Zero Window Scroll** rule on all desktop viewports. The root HTML/Body elements are pinned to `height: 100vh; overflow: hidden`. The viewport divides strictly into four stacked horizontal bands:

1. **Top Institutional Shell (`48px`):** Fixed Deep Crimson (`#7c0e00`) band housing the institution identity mark, cloud sync latency status, teacher profile chip, and theme toggle.
2. **Horizontal Navigation Bar (`38px`):** Horizontal workspace tabs with 2px active bottom borders. No sidebar menus exist.
3. **Workspace Control Band (`52px`):** Course title, inline semester selector pill, unit pagination stepper, dynamic filter search input, and right-aligned export/import action cluster.
4. **Frozen Ledger Plane (`calc(100vh - 138px)`):** Full remaining viewport allocated exclusively to the data table. Internal scrolling applies bidirectionally (`overflow: auto`).

### Freeze-Pane Geometry
- **Frozen Header:** Table `<thead>` is pinned with `position: sticky; top: 0; z-index: 20`.
- **Frozen Left Columns:** 
  - Column 1 (`#` / Index): Fixed width `36px`, `position: sticky; left: 0; z-index: 10`.
  - Column 2 (`Matrícula`): Fixed width `110px`, `position: sticky; left: 36px; z-index: 10`.
  - Column 3 (`Nombre Estudiante`): Fixed width `240px`, `position: sticky; left: 146px; z-index: 10`.
  - The right edge of the third frozen column projects a razor-thin structural shadow divider over horizontally moving data columns.
- **Intersection Corner:** The top-left cell intersection (`#`, `Matrícula`, `Nombre` headers) locks with `z-index: 30`.

## Elevation & Depth

Visual hierarchy does not rely on soft, volumetric blurs. Instead, it employs **structural engineering boundaries**: precise 1px hairline borders (`#e4e4e2`), high tonal surface differentiation, and targeted unidirectional directional cast shadows.

- **Baseline Grid Surface (Level 0):** Flat `#ffffff` cell bodies against `#e4e4e2` linear borders.
- **Header & Toolbars (Level 1):** Tone change (`#fbfbfa`) with a 1px solid bottom divider (`#e4e4e2`).
- **Frozen Left Rail Elevation:** The final frozen left column (`Nombre Estudiante`) casts a directional rightward cast shadow: `4px 0 6px -2px rgba(124, 14, 0, 0.08)` ensuring scrolling data visibly slips beneath the frozen ledger spine.
- **Top Sticky Header Elevation:** When scrolling vertically, the `<thead>` projects `0 3px 6px -1px rgba(124, 14, 0, 0.06)`.
- **Dropdown & Modals (Level 2):** Floating context menus, weight formula drawers, and grade breakdown modals utilize crisp boundaries with controlled diffusion: `0 8px 20px -3px rgba(124, 14, 0, 0.12), 0 0 0 1px rgba(124, 14, 0, 0.06)`.

## Shapes

The shape system adopts a **Soft Industrial** geometry (`roundedness: 2`). Radii are slightly more pronounced while protecting grid alignment and maintaining the crisp integrity of spreadsheet cells.

- **Micro Radii (`4px - 6px`):** Standard data buttons, search input fields, dropdown triggers, and numeric inline inputs.
- **Intermediate Radii (`8px - 10px`):** Multi-segment filter pills (`.gradebook-select-pill`), grouping chips, and context flyout dialogs.
- **Macro Radii (`12px`):** Reserved solely for global settings modal containers.
- **Full Pill (`9999px`):** Exclusively utilized for binary status indicators (e.g., Live Database Sync bead, student count pill badges, evaluation status tokens `APROBADO` / `REPROBADO`).

## Components

### 1. Data Sheet Cells & Row Rows (`.table-cell`, `.grid-row`)
- **Row Height:** Exact `32px` minimum for maximum compact throughput without mis-clicks.
- **Cell Padding:** `6px 8px`.
- **Typography:** Numeric evaluations aligned right with tabular figures; textual names aligned left in sentence case or uppercase engineering convention.
- **Hover & Active States:** Hovering a row applies a unified background (`#f4f4f2`). Cells in active direct-entry mode display a `2px solid #be180c` focus boundary inset without expanding row geometry.

### 2. Action Buttons (`.btn-primary`, `.btn-default`)
- **Primary CTA:** Background tinted in Crimson gradient (`#be180c` to `#7c0e00`), border `1px solid #7c0e00`, text `#ffffff`, height `34px`, padding `0 12px`, radius `6px`, font weight 600.
- **Default / Secondary Utility:** Background `#ffffff`, border `1px solid #e4e4e2`, text `#7c0e00`, hover background `#f4f4f2`. Used for "Exportar Excel", "Ponderación", "Importar".

### 3. Navigation Tabs (`.nav-tabs`)
- Rendered in the second tier of the header. Horizontal flex container with zero margin.
- **Tab Item:** Height `38px`, padding `0 16px`, color `#a5a5a8` on dark header or `#4b4848` on light viewports.
- **Active Tab:** Text color `#ffffff` (or `#7c0e00`), anchored by a bottom indicator line of `2px solid #be180c`. Includes a trailing pill badge showing real-time cohort counts (e.g., `35 alumnos`).

### 4. Segmented Selector Pills (`.gradebook-select-pill`)
- Used for switching Semesters and Groups without page reloads.
- Composed of an integrated chip with a bold descriptor label (`SEMESTRE:`, `GRUPO:`) paired with a native or stylized dropdown chevron. Background `#fbfbfa`, border `1px solid #e4e4e2`, height `32px`, border-radius `8px`.

### 5. Attendance & Status Badges
- Compact indicators rendering letter codes (`P`, `F`, `R`, `J`).
- Width and height fixed at `22px × 22px` for single-character matrix grids, or inline flex badges with `2px 6px` padding for status summaries. Rounded to `6px`.
- Text color and background pairs must strictly obey Section 2 named semantic tokens.

### 6. Search & Quick Filters
- Pinned to the workspace utility bar. Height `32px`, min-width `240px`.
- Integrated search glyph positioned at `8px` left inset. Focus state engages `1px solid #be180c` with an ultra-light ambient glow (`0 0 0 2px rgba(190, 24, 12, 0.15)`).