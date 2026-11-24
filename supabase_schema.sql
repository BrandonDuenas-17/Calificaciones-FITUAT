-- ============================================================================
-- SISTEMA DE CALIFICACIONES FIUAT • BLINDAJE INTEGRAL SUPABASE (v73)
-- ============================================================================
-- INSTRUCCIONES:
-- 1. Abre tu proyecto FIUAT en https://supabase.com -> "SQL Editor" -> "New query".
-- 2. Pega todo este archivo y presiona "Run".
-- 3. Verifica al final que "total_docentes_antes" y "total_docentes_despues"
--    sean exactamente 154 (CERO pérdida de datos y CERO reseteo de contraseñas).
-- ============================================================================

-- 0. Validación previa de integridad (debe mostrar 154 docentes)
select count(*) as total_docentes_antes from public.teachers;

-- 1. Habilitar extensión criptográfica (bcrypt + bytes aleatorios seguros)
create extension if not exists pgcrypto with schema extensions;

-- 2. Asegurar tabla principal sin alterar datos existentes
create table if not exists public.teachers (
  id text primary key,
  nombre text not null,
  usuario text not null,
  correo text,
  password text not null,
  departamento text,
  role text default 'docente',
  avatar text default '',
  data jsonb default '{"courses": [], "students": []}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 3. Tabla de sesiones autenticadas en servidor (inaccesible directo desde anon)
create table if not exists public.teacher_sessions (
  token text primary key,
  teacher_id text not null references public.teachers(id) on delete cascade,
  role text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create index if not exists idx_teacher_sessions_teacher_id on public.teacher_sessions(teacher_id);
create index if not exists idx_teacher_sessions_expires_at on public.teacher_sessions(expires_at);

-- 4. Tabla de control anti-fuerza bruta en servidor (5 intentos = 60s, incluso admin)
create table if not exists public.login_attempts (
  identifier text primary key,
  failed_count integer not null default 0,
  locked_until timestamp with time zone
);

-- 5. Habilitar RLS y revocar TODO acceso directo a tablas desde clientes web
alter table public.teachers enable row level security;
alter table public.teacher_sessions enable row level security;
alter table public.login_attempts enable row level security;

drop policy if exists "Acceso total para docentes y coordinacion FIUAT" on public.teachers;
drop policy if exists "Lectura pública del catálogo docente" on public.teachers;
drop policy if exists "Docentes pueden actualizar sus calificaciones" on public.teachers;
drop policy if exists "Permitir creación de cuentas docentes" on public.teachers;

revoke all on public.teachers from public, anon, authenticated;
revoke all on public.teacher_sessions from public, anon, authenticated;
revoke all on public.login_attempts from public, anon, authenticated;

-- Retirar public.teachers de Realtime para impedir difusión de filas a clientes anónimos
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'teachers'
  ) then
    alter publication supabase_realtime drop table public.teachers;
  end if;
exception when others then
  null;
end $$;

-- 6. Retirar firmas antiguas vulnerables (sin token de sesión)
drop function if exists public.verify_teacher_credentials(text, text);
drop function if exists public.change_teacher_password(text, text, text);
drop function if exists public.admin_reset_teacher_password(text, text, text, text);
drop function if exists public.save_teacher_grades(text, jsonb);

-- 7. Health-check liviano (sin exponer tabla teachers)
create or replace function public.ping_service()
returns boolean
language sql
security definer
set search_path = public
as $$
  select true;
$$;

revoke all on function public.ping_service() from public;
grant execute on function public.ping_service() to anon, authenticated;

-- 8. Inicio de sesión con rate-limit en servidor, auto-migración a bcrypt y emisión de token
create or replace function public.login_teacher(p_identifier text, p_password text)
returns table (
  success boolean,
  reason text,
  retry_after integer,
  session_token text,
  must_change_password boolean,
  id text,
  nombre text,
  usuario text,
  correo text,
  departamento text,
  role text,
  avatar text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_term text := lower(trim(coalesce(p_identifier, '')));
  v_pass text := coalesce(p_password, '');
  v_pass_trim text := trim(v_pass);
  v_attempt record;
  v_teacher record;
  v_crypt_pass text;
  v_is_valid boolean := false;
  v_is_master boolean := false;
  v_token text;
  v_new_attempts integer;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_term = '' or v_pass = '' then
    return query select false, 'invalid_input'::text, 0, null::text, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Revisar bloqueo por fuerza bruta en servidor (aplica a docentes y admin)
  select failed_count, locked_until into v_attempt
  from public.login_attempts
  where identifier = v_term;

  if found and v_attempt.locked_until is not null and v_attempt.locked_until > v_now then
    return query select
      false,
      'locked'::text,
      ceil(extract(epoch from (v_attempt.locked_until - v_now)))::integer,
      null::text, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  v_is_master := (
    v_term in ('admin', 'admin-coordinacion', 'coordinacion', 'dir_academica')
    or v_term like 'coordinacion@%'
  );

  if v_is_master then
    select t.id, t.nombre, t.usuario, t.correo, t.departamento, t.role, t.avatar, t.password
    into v_teacher
    from public.teachers t
    where t.role = 'admin' or t.id = 'admin-coordinacion' or lower(t.usuario) = 'admin'
    limit 1;
  else
    select t.id, t.nombre, t.usuario, t.correo, t.departamento, t.role, t.avatar, t.password
    into v_teacher
    from public.teachers t
    where lower(t.usuario) = v_term
       or lower(t.correo) = v_term
       or lower(t.id) = v_term
    limit 1;
  end if;

  if not found then
    return query select false, 'user_not_found'::text, 0, null::text, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Validación criptográfica estricta (sin claves por defecto hardcodeadas si password es NULL)
  if v_teacher.password is not null and v_teacher.password <> '' then
    if v_teacher.password like '$2%' then
      begin
        v_crypt_pass := crypt(v_pass, v_teacher.password);
        if v_crypt_pass = v_teacher.password then
          v_is_valid := true;
        elsif v_pass_trim <> v_pass then
          v_crypt_pass := crypt(v_pass_trim, v_teacher.password);
          v_is_valid := (v_crypt_pass = v_teacher.password);
        end if;
      exception when others then
        v_is_valid := false;
      end;
    else
      -- Compatibilidad con contraseñas en texto plano existentes: migrar a bcrypt al autenticar
      if v_teacher.password = v_pass or trim(v_teacher.password) = v_pass_trim then
        v_is_valid := true;
        update public.teachers
        set password = crypt(v_pass_trim, gen_salt('bf', 8))
        where public.teachers.id = v_teacher.id;
      end if;
    end if;
  end if;

  if not v_is_valid then
    v_new_attempts := coalesce(v_attempt.failed_count, 0) + 1;
    if v_new_attempts >= 5 then
      insert into public.login_attempts(identifier, failed_count, locked_until)
      values (v_term, 0, v_now + interval '60 seconds')
      on conflict (identifier) do update
        set failed_count = 0, locked_until = v_now + interval '60 seconds';
      return query select false, 'locked'::text, 60, null::text, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    else
      insert into public.login_attempts(identifier, failed_count, locked_until)
      values (v_term, v_new_attempts, null)
      on conflict (identifier) do update
        set failed_count = v_new_attempts, locked_until = null;
      return query select false, 'wrong_password'::text, (5 - v_new_attempts), null::text, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    end if;
    return;
  end if;

  -- Éxito: limpiar intentos fallidos y sesiones vencidas
  delete from public.login_attempts where identifier = v_term;
  delete from public.teacher_sessions where expires_at <= v_now;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.teacher_sessions(token, teacher_id, role, expires_at)
  values (v_token, v_teacher.id, coalesce(v_teacher.role, 'docente'), v_now + interval '12 hours');

  return query select
    true,
    null::text,
    0,
    v_token,
    (coalesce(v_teacher.role, 'docente') <> 'admin' and v_pass_trim = '123'),
    v_teacher.id,
    v_teacher.nombre,
    v_teacher.usuario,
    v_teacher.correo,
    v_teacher.departamento,
    coalesce(v_teacher.role, 'docente'),
    coalesce(v_teacher.avatar, '');
end;
$$;

revoke all on function public.login_teacher(text, text) from public;
grant execute on function public.login_teacher(text, text) to anon, authenticated;

-- 9. Validar sesión existente al recargar página
create or replace function public.validate_session(p_token text)
returns table (
  valid boolean,
  must_change_password boolean,
  id text,
  nombre text,
  usuario text,
  correo text,
  departamento text,
  role text,
  avatar text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_is_default_pass boolean := false;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if p_token is null or trim(p_token) = '' then
    return query select false, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  select s.token, t.id, t.nombre, t.usuario, t.correo, t.departamento, t.role, t.avatar, t.password
  into v_row
  from public.teacher_sessions s
  join public.teachers t on t.id = s.teacher_id
  where s.token = trim(p_token)
    and s.expires_at > v_now
  limit 1;

  if not found then
    return query select false, false, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if coalesce(v_row.role, 'docente') <> 'admin' and v_row.password is not null then
    if v_row.password like '$2%' then
      begin
        v_is_default_pass := (crypt('123', v_row.password) = v_row.password);
      exception when others then
        v_is_default_pass := false;
      end;
    else
      v_is_default_pass := (trim(v_row.password) = '123');
    end if;
  end if;

  return query select
    true,
    v_is_default_pass,
    v_row.id,
    v_row.nombre,
    v_row.usuario,
    v_row.correo,
    v_row.departamento,
    coalesce(v_row.role, 'docente'),
    coalesce(v_row.avatar, '');
end;
$$;

revoke all on function public.validate_session(text) from public;
grant execute on function public.validate_session(text) to anon, authenticated;

-- 10. Cerrar sesión en servidor
create or replace function public.logout_teacher(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is not null and trim(p_token) <> '' then
    delete from public.teacher_sessions where token = trim(p_token);
  end if;
  return true;
end;
$$;

revoke all on function public.logout_teacher(text) from public;
grant execute on function public.logout_teacher(text) to anon, authenticated;

-- 11. Lectura quirúrgica de calificaciones (solo el dueño o Coordinación)
create or replace function public.get_teacher_data(p_token text, p_teacher_id text)
returns table (
  ok boolean,
  reason text,
  data jsonb,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess record;
  v_t record;
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > timezone('utc'::text, now())
  limit 1;

  if not found then
    return query select false, 'unauthorized'::text, null::jsonb, null::timestamptz;
    return;
  end if;

  if v_sess.role <> 'admin' and v_sess.teacher_id <> p_teacher_id then
    return query select false, 'forbidden'::text, null::jsonb, null::timestamptz;
    return;
  end if;

  select t.data, t.updated_at into v_t
  from public.teachers t
  where t.id = p_teacher_id
  limit 1;

  if not found then
    return query select false, 'not_found'::text, null::jsonb, null::timestamptz;
    return;
  end if;

  return query select true, null::text, coalesce(v_t.data, '{"courses":[],"students":[]}'::jsonb), v_t.updated_at;
end;
$$;

revoke all on function public.get_teacher_data(text, text) from public;
grant execute on function public.get_teacher_data(text, text) to anon, authenticated;

-- 12. Guardado autenticado de calificaciones con bloqueo optimista (Anti-IDOR + Anti-sobrescritura)
create or replace function public.save_teacher_grades(
  p_token text,
  p_teacher_id text,
  p_data jsonb,
  p_expected_updated_at timestamp with time zone default null
)
returns table (
  ok boolean,
  conflict boolean,
  reason text,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess record;
  v_curr_updated_at timestamptz;
  v_new_updated_at timestamptz := timezone('utc'::text, now());
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > v_new_updated_at
  limit 1;

  if not found then
    return query select false, false, 'unauthorized'::text, null::timestamptz;
    return;
  end if;

  if v_sess.role <> 'admin' and v_sess.teacher_id <> p_teacher_id then
    return query select false, false, 'forbidden'::text, null::timestamptz;
    return;
  end if;

  select t.updated_at into v_curr_updated_at
  from public.teachers t
  where t.id = p_teacher_id
  for update;

  if not found then
    return query select false, false, 'not_found'::text, null::timestamptz;
    return;
  end if;

  -- Bloqueo optimista: evitar sobrescribir cambios más recientes hechos desde otro dispositivo
  if p_expected_updated_at is not null
     and v_curr_updated_at is not null
     and abs(extract(epoch from (v_curr_updated_at - p_expected_updated_at))) > 1 then
    return query select false, true, 'conflict'::text, v_curr_updated_at;
    return;
  end if;

  update public.teachers
  set data = coalesce(p_data, '{"courses":[],"students":[]}'::jsonb),
      updated_at = v_new_updated_at
  where id = p_teacher_id;

  return query select true, false, null::text, v_new_updated_at;
end;
$$;

revoke all on function public.save_teacher_grades(text, text, jsonb, timestamptz) from public;
grant execute on function public.save_teacher_grades(text, text, jsonb, timestamptz) to anon, authenticated;

-- 13. Cambio de contraseña propia con bcrypt (usa sesión real; arregla bug de id vs usuario)
create or replace function public.change_teacher_password(
  p_token text,
  p_old_password text,
  p_new_password text
)
returns table (
  ok boolean,
  reason text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sess record;
  v_current_pass text;
  v_crypt_old text;
  v_old_valid boolean := false;
  v_clean_new text := trim(coalesce(p_new_password, ''));
  v_old_raw text := coalesce(p_old_password, '');
  v_old_trim text := trim(v_old_raw);
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > timezone('utc'::text, now())
  limit 1;

  if not found then
    return query select false, 'unauthorized'::text;
    return;
  end if;

  if length(v_clean_new) < 6 then
    return query select false, 'password_too_short'::text;
    return;
  end if;

  if v_clean_new = '123' then
    return query select false, 'default_password_forbidden'::text;
    return;
  end if;

  select t.password into v_current_pass
  from public.teachers t
  where t.id = v_sess.teacher_id;

  if not found or v_current_pass is null or v_current_pass = '' then
    return query select false, 'not_found'::text;
    return;
  end if;

  if v_current_pass like '$2%' then
    begin
      v_crypt_old := crypt(v_old_raw, v_current_pass);
      if v_crypt_old = v_current_pass then
        v_old_valid := true;
      elsif v_old_trim <> v_old_raw then
        v_crypt_old := crypt(v_old_trim, v_current_pass);
        v_old_valid := (v_crypt_old = v_current_pass);
      end if;
    exception when others then
      v_old_valid := false;
    end;
  else
    v_old_valid := (v_current_pass = v_old_raw or trim(v_current_pass) = v_old_trim);
  end if;

  if not v_old_valid then
    return query select false, 'wrong_password'::text;
    return;
  end if;

  update public.teachers
  set password = crypt(v_clean_new, gen_salt('bf', 8)),
      updated_at = timezone('utc'::text, now())
  where id = v_sess.teacher_id;

  -- Revocar sesiones de otros dispositivos al cambiar la clave
  delete from public.teacher_sessions
  where teacher_id = v_sess.teacher_id
    and token <> trim(p_token);

  return query select true, null::text;
end;
$$;

revoke all on function public.change_teacher_password(text, text, text) from public;
grant execute on function public.change_teacher_password(text, text, text) to anon, authenticated;

-- 14. Restablecimiento de clave por Coordinación (requiere sesión admin + clave real admin)
create or replace function public.admin_reset_teacher_password(
  p_token text,
  p_admin_password text,
  p_target_teacher_id text,
  p_new_password text
)
returns table (
  ok boolean,
  reason text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sess record;
  v_admin_pass text;
  v_crypt_admin text;
  v_admin_valid boolean := false;
  v_clean_new text := trim(coalesce(p_new_password, ''));
  v_admin_raw text := coalesce(p_admin_password, '');
  v_admin_trim text := trim(v_admin_raw);
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > timezone('utc'::text, now())
  limit 1;

  if not found or v_sess.role <> 'admin' then
    return query select false, 'forbidden'::text;
    return;
  end if;

  if length(v_clean_new) < 3 then
    return query select false, 'password_too_short'::text;
    return;
  end if;

  select t.password into v_admin_pass
  from public.teachers t
  where t.id = v_sess.teacher_id and t.role = 'admin';

  if not found or v_admin_pass is null or v_admin_pass = '' then
    return query select false, 'admin_not_found'::text;
    return;
  end if;

  if v_admin_pass like '$2%' then
    begin
      v_crypt_admin := crypt(v_admin_raw, v_admin_pass);
      if v_crypt_admin = v_admin_pass then
        v_admin_valid := true;
      elsif v_admin_trim <> v_admin_raw then
        v_crypt_admin := crypt(v_admin_trim, v_admin_pass);
        v_admin_valid := (v_crypt_admin = v_admin_pass);
      end if;
    exception when others then
      v_admin_valid := false;
    end;
  else
    v_admin_valid := (v_admin_pass = v_admin_raw or trim(v_admin_pass) = v_admin_trim);
  end if;

  if not v_admin_valid then
    return query select false, 'wrong_admin_password'::text;
    return;
  end if;

  if not exists (select 1 from public.teachers where id = p_target_teacher_id) then
    return query select false, 'target_not_found'::text;
    return;
  end if;

  update public.teachers
  set password = crypt(v_clean_new, gen_salt('bf', 8)),
      updated_at = timezone('utc'::text, now())
  where id = p_target_teacher_id;

  -- Revocar sesiones activas del docente restablecido
  delete from public.teacher_sessions where teacher_id = p_target_teacher_id;

  return query select true, null::text;
end;
$$;

revoke all on function public.admin_reset_teacher_password(text, text, text, text) from public;
grant execute on function public.admin_reset_teacher_password(text, text, text, text) to anon, authenticated;

-- 15. Alta de docente exclusiva de Coordinación (cifra contraseña con bcrypt)
create or replace function public.admin_create_teacher(
  p_token text,
  p_id text,
  p_nombre text,
  p_usuario text,
  p_correo text,
  p_password text,
  p_departamento text,
  p_data jsonb default '{"courses":[],"students":[]}'::jsonb
)
returns table (
  ok boolean,
  reason text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sess record;
  v_clean_user text := lower(trim(coalesce(p_usuario, '')));
  v_clean_email text := lower(trim(coalesce(p_correo, '')));
  v_clean_pass text := trim(coalesce(p_password, ''));
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > timezone('utc'::text, now())
  limit 1;

  if not found or v_sess.role <> 'admin' then
    return query select false, 'forbidden'::text;
    return;
  end if;

  if trim(coalesce(p_id, '')) = '' or trim(coalesce(p_nombre, '')) = '' or v_clean_user = '' or length(v_clean_pass) < 4 then
    return query select false, 'invalid_input'::text;
    return;
  end if;

  if exists (
    select 1 from public.teachers t
    where t.id = trim(p_id)
       or lower(t.usuario) = v_clean_user
       or (v_clean_email <> '' and lower(coalesce(t.correo, '')) = v_clean_email)
  ) then
    return query select false, 'duplicate_teacher'::text;
    return;
  end if;

  insert into public.teachers(id, nombre, usuario, correo, password, departamento, role, avatar, data, updated_at)
  values (
    trim(p_id),
    trim(p_nombre),
    v_clean_user,
    v_clean_email,
    crypt(v_clean_pass, gen_salt('bf', 8)),
    coalesce(nullif(trim(p_departamento), ''), 'Facultad de Ingeniería Tampico'),
    'docente',
    '',
    coalesce(p_data, '{"courses":[],"students":[]}'::jsonb),
    timezone('utc'::text, now())
  );

  return query select true, null::text;
end;
$$;

revoke all on function public.admin_create_teacher(text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.admin_create_teacher(text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- 16. Resumen ligero del Panel Maestro (solo Coordinación; evita descargar 18,702 registros)
create or replace function public.get_admin_teachers_summary(p_token text)
returns table (
  id text,
  nombre text,
  usuario text,
  correo text,
  departamento text,
  role text,
  avatar text,
  updated_at timestamp with time zone,
  courses_count integer,
  students_count integer,
  courses_preview jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess record;
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > timezone('utc'::text, now())
  limit 1;

  if not found or v_sess.role <> 'admin' then
    return;
  end if;

  return query
  select
    t.id,
    t.nombre,
    t.usuario,
    t.correo,
    t.departamento,
    coalesce(t.role, 'docente') as role,
    coalesce(t.avatar, '') as avatar,
    t.updated_at,
    (case when jsonb_typeof(t.data->'courses') = 'array' then jsonb_array_length(t.data->'courses') else 0 end)::integer as courses_count,
    (case when jsonb_typeof(t.data->'students') = 'array' then jsonb_array_length(t.data->'students') else 0 end)::integer as students_count,
    coalesce(cp.preview, '[]'::jsonb) as courses_preview
  from public.teachers t
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', coalesce(x.c->>'id', ''),
        'nombre', coalesce(x.c->>'nombre', ''),
        'grupo', coalesce(x.c->>'grupo', 'Grupo A'),
        'aula', coalesce(x.c->>'aula', ''),
        'periodo', coalesce(x.c->>'periodo', ''),
        'recordsCount', x.rec_count
      )
    ) as preview
    from (
      select
        elem as c,
        (case when jsonb_typeof(elem->'records') = 'array' then jsonb_array_length(elem->'records') else 0 end)::integer as rec_count
      from jsonb_array_elements(
        case when jsonb_typeof(t.data->'courses') = 'array' then t.data->'courses' else '[]'::jsonb end
      ) as elem
    ) as x
  ) as cp on true
  order by t.nombre asc;
end;
$$;

revoke all on function public.get_admin_teachers_summary(text) from public;
grant execute on function public.get_admin_teachers_summary(text) to anon, authenticated;

-- 17. Respaldo global para Coordinación (omite la columna password)
create or replace function public.admin_export_all_teachers(p_token text)
returns table (
  id text,
  nombre text,
  usuario text,
  correo text,
  departamento text,
  role text,
  avatar text,
  data jsonb,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess record;
begin
  select s.teacher_id, s.role into v_sess
  from public.teacher_sessions s
  where s.token = trim(coalesce(p_token, ''))
    and s.expires_at > timezone('utc'::text, now())
  limit 1;

  if not found or v_sess.role <> 'admin' then
    return;
  end if;

  return query
  select
    t.id, t.nombre, t.usuario, t.correo, t.departamento,
    coalesce(t.role, 'docente'), coalesce(t.avatar, ''),
    coalesce(t.data, '{"courses":[],"students":[]}'::jsonb),
    t.updated_at
  from public.teachers t
  order by t.nombre asc;
end;
$$;

revoke all on function public.admin_export_all_teachers(text) from public;
grant execute on function public.admin_export_all_teachers(text) to anon, authenticated;

-- 18. Validación posterior de integridad (debe coincidir exactamente con total_docentes_antes = 154)
select count(*) as total_docentes_despues from public.teachers;
