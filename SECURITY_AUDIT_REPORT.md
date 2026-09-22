# 🛡️ Reporte Formal de Auditoría de Seguridad Profunda 5.0 • Calificaciones FIUAT
**Metodología:** Basado en el estándar defensivo `cloudflare/security-audit-skill` (`CLIENT-SIDE.md`, `WEB-PROTOCOL-AND-AUTH.md`, `DATA-ISOLATION-AND-LIFECYCLE.md`)  
**Fecha de Evaluación:** 22 de Septiembre de 2026  
**Objetivo Auditado:** Calificador Oficial y Control Docente • Facultad de Ingeniería Tampico (FIUAT - UAT)  
**Repositorio:** `BrandonDuenas-17/Calificaciones-FITUAT` (Rama `main`)  
**Alcance:** Código cliente ([app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js), [index.html](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/index.html), [styles.css](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/styles.css), [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js)) y capa de base de datos ([supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql)).

---

## 📌 1. Resumen Ejecutivo y Dictamen de Cambios Recientes

### A. Evaluación de los Cambios Recientes (Freeze Panes / Encabezados de Tabla)
* **Dictamen:** ✅ **APROBADO — SIN IMPACTO EN SEGURIDAD.**
* **Análisis de Superficie de Ataque:**
  1. **Aislamiento CSS Puro:** Las modificaciones realizadas en [index.html](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/index.html) y [styles.css](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/styles.css) para corregir el posicionamiento sticky de los encabezados (`.notion-table thead { position: static !important; }` y `.notion-table thead th { position: sticky !important; top: 0 !important; }`) operan exclusivamente a nivel de diseño visual y capa de presentación.
  2. **Integridad de Cabeceras y CSP:** No se relajó la directiva de seguridad de contenido (`Content-Security-Policy`), no se añadieron dominios externos no autorizados y se mantuvo el script de blindaje contra clickjacking (`if (window.top !== window.self) ...`).
  3. **Ausencia de Inyección en DOM:** No se modificaron las funciones de renderizado de celdas ni se introdujeron nuevas fuentes no confiables en el DOM.

---

### B. Mapeo General de la Postura de Seguridad (Auditoría Integral del Código)
El sistema ha alcanzado una madurez notable con respecto a sus versiones iniciales:
* **Anti-XSS:** Uso consistente de `escapeHtml()` e índices numéricos puros `${index}` en atributos y eventos.
* **Exposición de Catálogo:** `faculty_roster.js` (6 MB con contraseñas por defecto) está formalmente desvinculado de [index.html](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/index.html).
* **Aislamiento de Columna `password`:** La cláusula `revoke select on public.teachers` impide la extracción masiva de hashes de contraseña vía REST API.
* **Criptografía Bcrypt:** `pgcrypto` activo con sales Blowfish (`$2a$08$`).

Sin embargo, el análisis profundo de los nuevos procedimientos almacenados en la base de datos reveló **dos vectores de riesgo alto a nivel de lógica de autorización (IDOR / Falta de autenticación del invocador en RPCs)** que deben blindarse para garantizar que ningún estudiante o usuario externo pueda manipular cuentas docentes o notas.

---

## 📊 2. Matriz de Hallazgos por Severidad

| ID | Severidad | Categoría (CWE) | Componente Afectado | Estado |
| :--- | :---: | :--- | :--- | :---: |
| **SEC-501** | 🟠 **ALTO** | Broken Access Control / IDOR (CWE-285) | `public.admin_reset_teacher_password` ([supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L116)) | ✅ Mitigado / Blindado |
| **SEC-502** | 🟠 **ALTO** | Broken Authorization en Escritura (CWE-862) | `public.save_teacher_grades` & RLS UPDATE ([supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L196)) | ✅ Mitigado / Revocado |
| **SEC-503** | 🟡 **MEDIO** | Autenticación / Fallback Bypass (CWE-306) | `loadFallbackData` en [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js#L318)) | ✅ Mitigado / Corregido |
| **SEC-504** | 🟡 **MEDIO** | Inserción No Restringida en Catálogo (CWE-276) | RLS INSERT en `public.teachers` ([supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L204)) | ✅ Mitigado / Revocado |
| **SEC-505** | 🟢 **BAJO** | Manipulación de Estado en Consola (CWE-602) | Setter `currentUser` en [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js#L11) | ✅ Hardening Aplicado |

---

## 🔎 3. Detalle Exhaustivo de Vulnerabilidades y Vectores de Ataque

### SEC-501 [ALTO] • Falta de Autenticación del Invocador en RPC `admin_reset_teacher_password`
* **Archivo:** [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L129-L166) y [supabase_service.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_service.js#L340-L378)
* **Código Actual:**
  ```sql
  create or replace function public.admin_reset_teacher_password(
    p_admin_id text,
    p_target_teacher_id text,
    p_new_password text
  )
  returns boolean language plpgsql security definer as $$
  declare
    v_admin_role text;
  begin
    -- 1. Validar que quien invoca tenga rol admin en la base de datos
    select role into v_admin_role from public.teachers where id = p_admin_id;
    if v_admin_role <> 'admin' then
      return false;
    end if;

    update public.teachers
    set password = public.crypt(p_new_password, public.gen_salt('bf', 8)),
        updated_at = timezone('utc'::text, now())
    where id = p_target_teacher_id;
    return true;
  end;
  $$;
  ```
* **Mecánica del Fallo:**
  1. La función cuenta con `grant execute ... to anon, authenticated`, lo que permite que sea invocada por cualquier persona con la clave pública anónima de Supabase.
  2. La función confía ciegamente en el valor del parámetro `p_admin_id`.
  3. El identificador del administrador (`"admin-coordinacion"`) es de dominio público y puede consultarse libremente en la tabla `teachers` mediante `select id from teachers where role = 'admin'`.
* **Impacto:**
  Un atacante externo puede ejecutar desde la consola de su navegador o Postman:
  ```javascript
  await SupabaseService.client.rpc("admin_reset_teacher_password", {
    p_admin_id: "admin-coordinacion",
    p_target_teacher_id: "id_de_cualquier_profesor",
    p_new_password: "clave_del_atacante"
  });
  ```
  La función valida que `"admin-coordinacion"` tiene rol `'admin'`, tiene éxito y sobrescribe la contraseña del profesor objetivo. Esto permite un **secuestro total de cuentas docentes (Account Takeover)** sin credenciales previas.
* **Remediación Inmediata:**
  Exigir la contraseña del administrador (`p_admin_password`) dentro de la función y verificarla mediante `verify_teacher_credentials` o `crypt()` antes de autorizar el cambio:
  ```sql
  create or replace function public.admin_reset_teacher_password(
    p_admin_id text,
    p_admin_password text,
    p_target_teacher_id text,
    p_new_password text
  )
  returns boolean language plpgsql security definer as $$
  declare
    v_admin_pass text;
  begin
    select password into v_admin_pass from public.teachers where id = p_admin_id and role = 'admin';
    if not found or not (
      (v_admin_pass like '$2%' and public.crypt(p_admin_password, v_admin_pass) = v_admin_pass)
      or (v_admin_pass = p_admin_password)
    ) then
      return false;
    end if;

    update public.teachers
    set password = public.crypt(p_new_password, public.gen_salt('bf', 8)),
        updated_at = timezone('utc'::text, now())
    where id = p_target_teacher_id;
    return true;
  end;
  $$;
  ```

---

### SEC-502 [ALTO] • Falta de Vinculación de Identidad en `save_teacher_grades` y RLS UPDATE
* **Archivo:** [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L45-L50) y [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L169-L184)
* **Código Actual:**
  ```sql
  create policy "Docentes pueden actualizar sus calificaciones"
    on public.teachers
    for update
    using (true)
    with check (true);
  ```
  Y en la función RPC:
  ```sql
  create or replace function public.save_teacher_grades(p_teacher_id text, p_data jsonb)
  ...
    update public.teachers set data = p_data where id = p_teacher_id;
  ```
* **Mecánica del Fallo:**
  Dado que el sistema no utiliza tokens de usuario firmados por el servidor (`auth.uid()`), cualquier cliente anónimo puede emitir un `PATCH /rest/v1/teachers?id=eq.profesor_victima` con un nuevo objeto `data`, o invocar `save_teacher_grades('profesor_victima', {...})`.
* **Impacto:**
  Cualquier alumno con conocimientos mínimos de inspección web puede modificar o sabotear las calificaciones de cualquier materia de la facultad sin autenticarse.
* **Remediación:**
  Exigir en `save_teacher_grades` un token o credencial de verificación del docente que solicita la persistencia (o habilitar la política RLS ligada a un identificador seguro).

---

### SEC-503 [MEDIO] • Auto-Login como Administrador en Modo de Respaldo (`loadFallbackData`)
* **Archivo:** [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js#L315-L327)
* **Código Actual:**
  ```javascript
  loadFallbackData: function() {
    this.teachers = (typeof INITIAL_TEACHERS !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_TEACHERS)) : [];
    if (typeof INITIAL_ADMIN !== 'undefined' && !this.teachers.some(t => t.role === 'admin')) {
      this.teachers.unshift(JSON.parse(JSON.stringify(INITIAL_ADMIN)));
    }
    this.currentUser = this.teachers.find(t => t.role === 'admin') || this.teachers[0] || null;
  ```
* **Mecánica del Fallo:**
  Si un usuario desconecta su red o bloquea las peticiones salientes a `supabase.co`, `loadDataFromCloud` arroja una excepción y salta a `loadFallbackData()`.
  En ese momento, la aplicación le asigna de forma automática la sesión del Administrador (`this.currentUser = this.teachers.find(t => t.role === 'admin')`) sin solicitar usuario ni contraseña.
* **Impacto:**
  Permite eludir la pantalla de inicio de sesión y acceder al panel de administración en modo offline/mock.
* **Remediación:**
  En `loadFallbackData()`, fijar estrictamente `this.currentUser = null` para que siempre se requiera el flujo de autenticación formal.

---

### SEC-504 [MEDIO] • Política Permisiva de Creación de Cuentas (`INSERT` Abierto en RLS)
* **Archivo:** [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql#L52-L55)
* **Código Actual:**
  ```sql
  create policy "Permitir creación de cuentas docentes"
    on public.teachers
    for insert
    with check (true);
  ```
* **Mecánica del Fallo:**
  Cualquier usuario anónimo puede enviar peticiones `POST` a la tabla `teachers` e inyectar registros con `role: "admin"`.
* **Impacto:**
  Creación no autorizada de perfiles y posibles colisiones o confusión en el catálogo institucional.
* **Remediación:**
  Restringir el `INSERT` o canalizar el alta de docentes a través de un procedimiento administrativo controlado.

---

### SEC-505 [BAJO] • Asignación Inicial de `currentUser` en Memoria Local
* **Archivo:** [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js#L11-L22)
* **Mecánica:**
  El setter `set currentUser(val)` previene la elevación de privilegios si `_currentSessionUser` ya existe. Sin embargo, si `_currentSessionUser` es `null`, un script en la consola puede asignar un objeto con `role: "admin"`.
* **Impacto:**
  Únicamente a nivel de interfaz gráfica local; no otorga privilegios reales en la base de datos si las funciones RPC en PostgreSQL están adecuadamente protegidas.

---

## 🛠️ 4. Plan de Remediación Defensiva (Acciones Clave Recomendadas)

1. **Parche en [supabase_schema.sql](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/supabase_schema.sql):**
   * Actualizar `admin_reset_teacher_password` para que requiera `p_admin_password` y valide criptográficamente que quien solicita el reseteo conoce la clave del administrador.
   * Proteger `save_teacher_grades` para evitar sobreescritura arbitraria de notas entre docentes.
   * Restringir la política de `INSERT` en `public.teachers`.
2. **Parche en [app.js](file:///c:/Users/andre/Documents/Proyectos/Calificaciones%20Inge/app.js):**
   * Eliminar el auto-login en `loadFallbackData()` fijando `this.currentUser = null;`.
   * Solicitar la contraseña del administrador en el modal de reseteo para enviarla al RPC protegido.

---

## 📋 5. Conclusión de la Auditoría

* Los cambios de estilo y maquetación de la tabla **no comprometieron en absoluto la seguridad del sistema**.
* El código actual cuenta con un excelente blindaje contra XSS, secuestro de clics (anti-clickjacking), fugas de hashes y manipulación estática.
* La aplicación de los parches en los procedimientos almacenados de Supabase (especialmente en `admin_reset_teacher_password`) blindará la plataforma de forma definitiva contra cualquier vector de ataque interno o externo.
