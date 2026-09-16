# Sistema de Calificaciones • Álgebra Lineal & Cálculo Integral
### Plataforma de Control Docente y Calificaciones estilo Notion

Esta plataforma fue diseñada para replicar exactamente la experiencia de **Notion**, integrando la base de datos relacional de alumnos con columna **Rollup**, las fórmulas de evaluación de unidades y calificación final, y un módulo especializado de exportación para **Microsoft Teams**.

---

## 🚀 Cómo Iniciar la Aplicación

No requiere instalar ningún programa ni servidor. Solo haz:
1. **Doble clic sobre el archivo `index.html`** en esta carpeta.
2. Se abrirá automáticamente en tu navegador predeterminado (Chrome, Edge, Firefox, etc.).
3. Todos los datos que ingreses se guardan de forma instantánea y automática en tu equipo.

---

## 📋 ¿Cómo cargar los alumnos de tu nuevo semestre?

Dado que los datos iniciales son un ejemplo del semestre anterior:

1. **Opción Rápida (Pegar desde Excel o Teams):**
   - Haz clic en el botón **`🧹 Nuevo Semestre`** para vaciar los alumnos de prueba.
   - Haz clic en **`📋 Pegar Lista de Excel`**.
   - Copia las dos columnas de tu lista oficial en Excel (**Matrícula** y **Nombre Completo**) y pégalas en el recuadro.
   - Presiona **`Importar Alumnos`** y ¡listo! Todos los alumnos quedarán registrados en el **Directorio Maestro** y enlazados con **Rollup** a la materia.

2. **Opción por Directorio Maestro (Pestaña "Directorio de Alumnos"):**
   - En esta pestaña puedes registrar, editar nombres o actualizar matrículas.
   - Cualquier cambio que hagas en el Directorio Maestro se refleja al instante en **todas las materias y grupos** a través de la relación **Rollup**.

---

## 👥 Múltiples Materias y Grupos Separados

Ahora puedes llevar el control de tantos grupos y materias como impartas:

1. **Crear una Nueva Materia o Grupo:**
   - Haz clic en el botón superior **`+ Nueva Materia / Grupo`** (o en la barra de pestañas).
   - Escribe o selecciona la materia (ej. *Álgebra Lineal*, *Cálculo Integral*, *Cálculo Diferencial*, etc.).
   - Define el grupo (ej. *Grupo A*, *Grupo B*, *1A*, etc.) y las unidades a calificar.
2. **Cambiar entre Grupos y Materias:**
   - En el calificador verás un selector agrupado por materia para alternar en 1 clic entre tus grupos.
3. **Duplicar Estructura:**
   - Si ya configuraste los topes de firmas de un grupo, haz clic en **`⚙️ Ajustes`** $\rightarrow$ **`Duplicar estructura para otro Grupo`** para crear el siguiente grupo en 1 segundo con la misma configuración.

---

## 📐 Fórmulas Matemáticas Integradas

### 1. Evaluación por Unidad ($U_1$ a $U_5$):
$$\text{Evaluación } U_x = \left(\frac{\text{Firmas } U_x}{\max(\text{Firmas } U_x)} \times 50\right) + (\text{Examen } U_x \times 0.5)$$
* **Firmas (50%):** Se normalizan automáticamente al tope configurado de firmas de cada unidad (con visualización circular en anillo como en Notion).
* **Examen (50%):** Con barra horizontal y semáforo de color dinámico.

### 2. Evaluación Final:
$$\text{Final} = \min\Big(100, \; \text{round}\big(\text{mean}(U_1, U_2, U_3, U_4, U_5, \text{Proyecto}) + (\text{Puntos Extra} \times 5)\big)\Big)$$
* Promedio de las 5 unidades más el Proyecto Final.
* Suma $+5$ puntos sobre el promedio final por cada **Punto Extra** registrado.
* Redondeo automático y límite de 100 puntos.

---

## 📤 Publicar en Teams (Solo Lectura y Protección)

Ve a la pestaña **`Publicar en Teams`**:
1. **Excel para Teams (.xlsx):**
   - Genera una hoja de cálculo limpia con formato oficial de actas escolares.
   - Puedes activar el **"Modo Privacidad"** (solo mostrar Matrículas sin nombres) para proteger los datos de tus estudiantes en Teams.
2. **Reporte Imprimible / PDF:**
   - Para guardar en PDF o imprimir un resumen visual con estatus Aprobado/Reprobado.
3. **Consulta Rápida por Matrícula:**
   - Si proyectas tu pantalla en clase, el alumno escribe su matrícula y solo se muestra su tarjeta individual con su desglose, protegiendo las notas del resto del grupo.

---

## 💾 Copias de Seguridad (Backup)
En la pestaña **Publicar en Teams** encontrarás los botones para:
* **Descargar Respaldo (.json):** Guarda una copia de todas tus materias y alumnos en tu computadora o nube.
* **Restaurar Respaldo:** Te permite restaurar tus calificaciones en cualquier equipo.

---

## 🏛️ Perfil Maestro / Supervisión Docente (Coordinación FIUAT)

El sistema cuenta con un **Perfil Maestro** para la Coordinación o Dirección Académica con permisos para supervisar a todos los profesores:

### Cuentas de Acceso:
1. **Cuenta Maestra (Coordinación Académica):**
   * **Usuario:** `admin` &nbsp;|&nbsp; **Contraseña:** `admin` (o clic en la tarjeta dorada de la pantalla de inicio)
   * **Alcance:** Acceso al **Panel Central de Control**, métricas de toda la facultad, botón de **Supervisión / Auditoría** directa en cada profesor y descarga de respaldo global.
2. **Cuentas Docentes (Aislamiento Privado):**
   * **Ing. Roberto García M.:** `rgarcia` &nbsp;|&nbsp; `123` (Álgebra Lineal y Cálculo Integral)
   * **Dra. Martha Elena Sánchez:** `msanchez` &nbsp;|&nbsp; `123` (Programación Web y Bases de Datos)
   * **Nuevo Docente:** Puedes registrar nuevos profesores con su propio usuario, contraseña y departamento.

### Modo Supervisión:
* Desde el Panel Maestro, haz clic en **`👁️ Supervisar / Auditar Calificaciones`** en cualquier profesor.
* Aparecerá una barra superior dorada indicando que estás auditando a dicho profesor, permitiéndote revisar sus listas, notas y actas.
* Presiona **`Volver al Panel Maestro`** para regresar al centro de control.

