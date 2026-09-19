-- ============================================================================
-- SISTEMA DE CALIFICACIONES FIUAT • SCRIPT DE CONFIGURACIÓN PARA SUPABASE
-- ============================================================================
-- Instrucciones:
-- 1. Entra a tu panel en https://supabase.com y crea un nuevo proyecto.
-- 2. Ve a la pestaña "SQL Editor" en el menú lateral izquierdo.
-- 3. Haz clic en "New query", pega todo el contenido de este archivo y presiona "Run".
-- ============================================================================

-- 1. Crear tabla de profesores (teachers)
create table if not exists public.teachers (
  id text primary key,
  nombre text not null,
  usuario text not null,
  correo text,
  password text default '123',
  departamento text,
  role text default 'docente',
  avatar text default '',
  data jsonb default '{"courses": [], "students": []}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Habilitar Row Level Security (RLS)
alter table public.teachers enable row level security;

-- 3. Crear política de acceso completo para clientes web (Docentes y Dirección FIUAT)
drop policy if exists "Acceso total para docentes y coordinacion FIUAT" on public.teachers;
create policy "Acceso total para docentes y coordinacion FIUAT"
  on public.teachers
  for all
  using (true)
  with check (true);

-- 4. Habilitar Realtime para permitir la supervisión en vivo del Administrador
alter publication supabase_realtime add table public.teachers;

-- 5. Crear índices de búsqueda rápida
create index if not exists idx_teachers_usuario on public.teachers (usuario);
create index if not exists idx_teachers_role on public.teachers (role);

-- ============================================================================
-- ¡Listo! La base de datos está preparada para recibir los datos de FIUAT.
-- ============================================================================
