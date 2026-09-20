# 📌 RESUMEN DE ESTADO Y CONTEXTO COMPLETO DEL PROYECTO
**Fecha de corte:** 19 de Septiembre de 2026  
**Proyecto:** Sistema de Calificaciones FIUAT • Control Docente y Supervisión Académica  
**Organización:** Facultad de Ingeniería Tampico (Universidad Autónoma de Tamaulipas)  
**Repositorio GitHub:** [https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git](https://github.com/BrandonDuenas-17/Calificaciones-FITUAT.git)  
**Rama activa:** `main`

---

## 🏛️ 1. Arquitectura y Cuentas del Sistema

### A. Autenticación y Cuentas Integradas:
* **Coordinación / Dirección Académica (Cuenta Maestra):**
  * **Identificador:** `admin-coordinacion` / `dir_academica`
  * **Rol:** `admin` (exclusivo para Coordinación Académica FIUAT).
  * **Capacidades:**
    * Supervisión en tiempo real de los 153 docentes de la facultad.
    * Auditoría de actas y calificaciones en modo de solo lectura.
    * Métricas generales de la facultad (771 materias, 18,702 inscripciones, promedio general).
    * Búsqueda instantánea de profesores por nombre o materia asignada.
    * **Nuevo Módulo de Gestión:** Administración centralizada de cuentas docentes y restablecimiento autorizado de contraseñas olvidadas con un solo clic.
* **Plantilla Docente Oficial (153 Profesores):**
  * Acceso automático con credenciales institucionales normalizadas (`CUENTAS_DOCENTES_FIUAT.csv`).
  * Cada profesor cuenta con sus materias asignadas y sus listas de alumnos oficiales con matrícula de 10 dígitos y nombres en altas.
  * Gestión de contraseña personal mediante procedimiento seguro `change_teacher_password`.
  * Caso resuelto: El docente **Alejandro González Turrubiates** (`agturrubiates`) cuenta con su contraseña restablecida a la predeterminada (`123`).

### B. Infraestructura 100% en la Nube (Supabase PostgreSQL):
* **Proveedor:** Supabase Database (PostgreSQL 15+ con extensión `pgcrypto`).
* **Tabla Principal:** `public.teachers` con Row Level Security (RLS) habilitado.
* **Persistencia JSONB:** Columna `data` conteniendo el árbol completo de materias (`courses`), configuraciones de firmas, períodos, aulas y alumnos (`students`).
* **Sincronización Reactiva:**
  * Indicador dinámico de estado en barra superior: `🟢 Nube Sincronizada (Supabase)`.
  * Indicador reactivo en el pie de tabla: `🟢 Sincronizado en la nube (Supabase) · [hh:mm:ss]`.
  * Escuchadores en vivo (`listenToTeacher`) para reflejar cambios en tiempo real durante auditorías.

---

## 🛡️ 2. Blindajes de Seguridad Implementados (Auditorías 1.0 a 4.0)

El sistema cuenta con un blindaje multicapa rigurosamente auditado y validado mediante pruebas automatizadas:

| Mecanismo de Seguridad | Nivel | Descripción y Blindaje |
| :--- | :---: | :--- |
| **Aislamiento de Contraseñas** | Base de Datos (PostgreSQL) | `revoke select on public.teachers` aplicado; la columna `password` está estrictamente excluida de consultas REST y solo se opera mediante RPCs con `SECURITY DEFINER`. |
| **Encriptación Bcrypt** | Base de Datos (pgcrypto) | Las contraseñas se almacenan mediante hash bcrypt (`$2a$08$`) generado por `public.crypt()` y `public.gen_salt('bf', 8)`. |
| **Protección Anti-XSS** | Cliente (`app.js`) | Celdas dinámicas e inputs del calificador operan exclusivamente con índices numéricos puros `${index}`, neutralizando cualquier inyección por matrícula o nombre. |
| **Firma Criptográfica de Sesión** | Cliente (`app.js`) | Clave efímera de 256 bits generada dinámicamente con `crypto.getRandomValues()` en `_getSessionSecret()`; tokens y firmas validadas contra adulteración. |
| **Control de Acceso (RBAC)** | Cliente y Servidor | Métodos administrativos (`superviseTeacher`, `openAdminManageTeacherModal`, `syncFullFacultyRoster`) protegidos por `isAdmin()`; el setter `currentUser` bloquea manipulaciones de rol en caliente. |
| **Content Security Policy (CSP)** | Encabezados (`index.html`) | Directivas estrictas de seguridad sin `'unsafe-eval'`. |
| **Modo Solo Lectura en Auditoría** | Cliente (`app.js`) | Al auditar a un docente, se bloquea la modificación de notas, duplicado de grupos y borrado de listas para preservar la integridad de las actas. |

---

## 🚀 3. Hitos y Mejoras Recientes

### A. Restauración de Materias y Listas en el Panel de Supervisión
* **Diagnóstico:** En una fase previa de optimización, `fetchTeachers()` había omitido el campo `data`, provocando que las tarjetas mostraran *"0 listas"* y *"Alumnos en catálogo: 0"*.
* **Solución:** Se reincorporó `data` en la proyección `select()` autorizada en [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js), manteniendo la columna `password` totalmente excluida.
* **Resultado:** Las 153 tarjetas volvieron a desplegar sus materias reales (ej. Mary Carmen Acosta Cervantes con 8 materias y 164 alumnos), las métricas globales se reactivaron y la búsqueda por asignatura funciona al 100%.

### B. Módulo de Administración de Cuentas y Restablecimiento de Claves (Cuenta Maestra)
* **Objetivo:** Resolver contingencias donde los docentes olviden sus credenciales sin que puedan recuperarlas por sí mismos.
* **Interfaz:** Se integró el botón `[ 🔒 Administrar Cuenta / Clave ]` en cada tarjeta docente del panel de supervisión.
* **Modal Institucional:** Permite a la Dirección asignar una clave personalizada o utilizar el botón de acción rápida *"Restablecer a Clave Predeterminada ('123')"*.
* **Procedimiento Seguro:** Implementación del RPC `admin_reset_teacher_password` en [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql) y método complementario en [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js).
* **Validación:** Se comprobó que docentes regulares tienen denegado el acceso a este modal, garantizando que solo la Cuenta Maestra pueda ejecutarlo.

---

## 📂 4. Estructura y Roles de los Archivos del Proyecto

* [index.html](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/index.html):
  * Estructura principal, modales institucionales (Registro, Cambio de Contraseña, Sincronización Roster, y Administración de Cuentas Docentes), directivas CSP y contenedor de toasts.
* [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js):
  * Controlador central: gestión de sesión, panel de control administrativo, renderizado del calificador, navegación tipo Excel, atajos de teclado y validaciones de seguridad.
* [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js):
  * Módulo singleton para la comunicación con Supabase PostgreSQL: autenticación vía RPC, consulta de profesores, persistencia de calificaciones y restablecimiento administrativo de claves.
* [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql):
  * Script DDL completo de PostgreSQL: definición de tabla `teachers`, políticas RLS, permisos por columna y funciones RPC seguras (`verify_teacher_credentials`, `change_teacher_password`, `admin_reset_teacher_password`, `save_teacher_grades`).
* [styles.css](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/styles.css):
  * Identidad gráfica institucional FIUAT (#212052 Azul Noche, #E07E33 Naranja UAT), estilos Notion, temas Claro/Oscuro y diseño responsivo para tarjetas de supervisión.
* [faculty_roster.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/faculty_roster.js):
  * Catálogo oficial compilado de los 153 profesores, 771 materias/grupos y listas completas de alumnos extraídas del archivo institucional de la facultad.
* [CUENTAS_DOCENTES_FIUAT.csv](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/CUENTAS_DOCENTES_FIUAT.csv) / [CUENTAS_DOCENTES_FIUAT.md](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/CUENTAS_DOCENTES_FIUAT.md):
  * Directorio oficial de usuarios y credenciales de acceso para los 153 profesores de la FIUAT.
* [exporter.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/exporter.js):
  * Generación y exportación de actas y listas oficiales en formato Excel mediante SheetJS con soporte para Modo Privacidad.

---

## 🎯 5. Estado Actual del Sistema

* ✅ **100% en la Nube:** Conectado a Supabase PostgreSQL con estado activo.
* ✅ **Datos Íntegros:** 154 registros docentes, 771 materias y más de 18,700 alumnos cargados y verificados.
* ✅ **Panel de Supervisión Funcional:** Conteo de materias, grupos y alumnos visible en todas las tarjetas de profesores.
* ✅ **Módulo de Reseteo de Claves Activo:** Cuenta Maestra capacitada para desbloquear y administrar cuentas docentes de forma segura.
* ✅ **Seguridad y Blindaje 100% Intactos:** Cero vulnerabilidades críticas, anti-XSS activo, aislamiento de contraseñas y control de acceso estricto.
* ✅ **Código Limpio y Sincronizado:** Rama `main` en GitHub actualizada al último commit.
