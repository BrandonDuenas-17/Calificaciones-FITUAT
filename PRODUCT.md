# Product Brief: Sistema de Calificaciones y Asistencias FIUAT

## Platform
web

## Purpose
Sistema integral de control de asistencias, evaluación continua y supervisión académica de la Facultad de Ingeniería Tampico (FIUAT - Universidad Autónoma de Tamaulipas).

## Target Users
1. **Docentes Universitarios:** Maestros que imparten múltiples materias y grupos semestrales, necesitando captura ágil y sin fricción de asistencias diarias y calificaciones por unidad en clase, cubículos y salas de maestros.
2. **Coordinación Académica:** Personal administrativo y directivos que supervisan en tiempo real el cumplimiento de entregas y el avance de captura de los 154 docentes del padrón institucional.

## Positioning
Combina la inmediatez y velocidad de una hoja de cálculo (estilo Excel / Notion con paneles inmovilizados) con sincronización en la nube en tiempo real (Supabase PostgreSQL + Realtime), control de límites de faltas / derecho a examen e importación inteligente de libros de asistencia.

## Operating Context
- **Dispositivos (Enfoque Responsivo Híbrido):** Escritorio y laptop para captura intensiva de notas, ponderaciones y sábanas completas; móvil y tablet para pase de lista ágil dentro del aula con fichas táctiles.
- **Entorno de Red:** Conexión online reactiva con soporte para tolerancia local y persistencia sincronizada.

## Core Workflows
1. **Pase de Lista y Asistencias:** Registro de asistencia diaria (P, F, R, J), sábana cronológica por unidad, cálculo automático de % de asistencia, gestión de justificaciones y advertencias de derecho a examen.
2. **Evaluación Continua y Calificador:** Tabla con paneles inmovilizados (*freeze panes*), ponderaciones dinámicas por unidad (tareas, exámenes, firmas/participaciones, proyectos) y cálculo automático de estatus.
3. **Supervisor Académico Realtime:** Monitoreo centralizado del progreso de los 154 docentes y sus respectivos cursos en vivo.
4. **Exportación e Impresión:** Descarga de actas en Excel (.xlsx) y CSV con sanitización estricta contra inyección de fórmulas (CWE-1236).

## Durable Constraints
- **Preservación Absoluta de Datos (AGENTS.md):** Prohibición estricta de vaciar o sobrescribir los datos de Supabase. El catálogo de 154 docentes y sus registros deben mantenerse 100% íntegros.
- **Seguridad en Profundidad:** Autenticación criptográfica, bloqueo por fuerza bruta tras 5 intentos fallidos (60 s), cierre automático por inactividad tras 20 minutos y sesiones firmadas.
- **Identidad Institucional FIT - UAT:** Azul Noche UAT (`#212052`), Azul Marino FI (`#353372`), Naranja UAT Primario (`#e07e33` / `#ffa366`), con soporte nativo de alto contraste para Modo Claro y Modo Oscuro con `color-scheme`.
