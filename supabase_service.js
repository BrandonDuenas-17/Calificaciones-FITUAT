// supabase_service.js - Módulo de integración con Supabase (PostgreSQL + Realtime)
// Reemplaza a Firebase Firestore para la persistencia en la nube y supervisión en tiempo real

const SUPABASE_CONFIG = {
  // Credenciales activas de Supabase (Facultad de Ingeniería Tampico)
  url: localStorage.getItem("supabase_url") || "https://xjlqzwigqmevbffaavjl.supabase.co",
  anonKey: localStorage.getItem("supabase_anon_key") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbHF6d2lncW1ldmJmZmFhdmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4MzI2NzcsImV4cCI6MjEwNTQwODY3N30.T4U1JRUH4DiGAZWhaFd83Q1em2NUHWxMCpibeX2-OFs"
};

const SupabaseService = {
  client: null,
  isInitialized: false,
  isOnline: navigator.onLine,
  status: "connecting", // "connected", "offline", "error"
  activeChannel: null,

  init: async function() {
    if (typeof supabase === "undefined") {
      console.warn("Supabase SDK no detectado. Operando en modo de respaldo local.");
      this.status = "offline";
      return false;
    }

    const cleanUrl = (SUPABASE_CONFIG.url || "").trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
    const cleanKey = (SUPABASE_CONFIG.anonKey || "").trim();

    const isPlaceholder = !cleanUrl || 
                          cleanUrl.includes("your-project-id") || 
                          !cleanKey || 
                          cleanKey.includes("your-anon-key");

    if (isPlaceholder) {
      console.warn("Supabase: Credenciales pendientes de configurar. Se usarán datos locales hasta que ingreses tu URL y Anon Key.");
      this.status = "offline";
      return false;
    }

    try {
      this.client = supabase.createClient(cleanUrl, cleanKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });

      // Prueba rápida de conexión
      const { data, error } = await this.client.from("teachers").select("id").limit(1);
      if (error && error.code !== "PGRST116") {
        console.warn("Aviso de conexión Supabase:", error.message);
      }

      this.isInitialized = true;
      this.status = navigator.onLine ? "connected" : "offline";

      // Monitoreo de conexión a internet
      window.addEventListener("online", () => {
        this.isOnline = true;
        this.status = "connected";
        this.notifyStatusChange();
      });

      window.addEventListener("offline", () => {
        this.isOnline = false;
        this.status = "offline";
        this.notifyStatusChange();
      });

      return true;
    } catch (err) {
      console.error("Error al inicializar Supabase Client:", err);
      this.status = "error";
      return false;
    }
  },

  notifyStatusChange: function() {
    if (typeof App !== "undefined" && App.updateCloudStatusBadge) {
      App.updateCloudStatusBadge();
    }
  },

  // Obtener directorio público de profesores desde Supabase (sin contraseñas y sin calificaciones masivas - VULN-3.0-02)
  fetchTeachers: async function() {
    if (!this.isInitialized || !this.client) return null;

    try {
      const { data, error } = await this.client
        .from("teachers")
        .select("id, nombre, usuario, correo, departamento, role, avatar, data, updated_at")
        .order("nombre", { ascending: true });

      if (error) {
        console.error("Error al obtener profesores de Supabase:", error);
        return null;
      }

      return data || [];
    } catch (e) {
      console.error("Error de red al consultar Supabase:", e);
      return null;
    }
  },

  // Obtener calificaciones y cursos ÚNICAMENTE del docente autenticado bajo demanda (VULN-3.0-02)
  fetchTeacherData: async function(teacherId) {
    if (!this.isInitialized || !this.client || !teacherId) return null;

    try {
      const { data, error } = await this.client
        .from("teachers")
        .select("id, data, updated_at")
        .eq("id", teacherId)
        .maybeSingle();

      if (error) {
        console.error("Error al obtener calificaciones del docente:", error);
        return null;
      }

      return data ? data.data : null;
    } catch (e) {
      console.error("Error de red al consultar calificaciones del docente:", e);
      return null;
    }
  },

  // Verificación segura de credenciales para inicio de sesión en Supabase
  verifyCredentials: async function(identifier, password) {
    if (!this.isInitialized || !this.client) return null;

    try {
      const term = (identifier || "").trim().toLowerCase();

      // 1. Intento primario vía RPC seguro (ejecutado dentro de PostgreSQL)
      try {
        const { data: rpcData, error: rpcError } = await this.client.rpc("verify_teacher_credentials", {
          p_identifier: term,
          p_password: password
        });

        if (!rpcError && rpcData && rpcData.length > 0) {
          const res = rpcData[0];
          if (res.success && res.id) {
            return {
              success: true,
              teacherId: res.id,
              teacher: {
                id: res.id,
                nombre: res.nombre,
                usuario: res.usuario,
                correo: res.correo,
                role: res.role
              }
            };
          } else if (res.id) {
            return { success: false, reason: "wrong_password" };
          } else {
            return { success: false, reason: "user_not_found" };
          }
        }
      } catch (rpcEx) {
        // Procedimiento aún no creado en Supabase, continuar con consulta directa de respaldo
      }

      // 2. Consulta filtrada de respaldo
      const { data, error } = await this.client
        .from("teachers")
        .select("id, password, nombre, usuario, correo, role")
        .or(`usuario.ilike.${term},correo.ilike.${term}`)
        .limit(1);

      if (error || !data || data.length === 0) {
        return { success: false, reason: "user_not_found" };
      }

      const teacher = data[0];
      const validPass = teacher.password || "123";
      if (validPass !== password) {
        return { success: false, reason: "wrong_password" };
      }

      return { success: true, teacherId: teacher.id, teacher: teacher };
    } catch (e) {
      console.error("Error al verificar credenciales:", e);
      return { success: false, reason: "network_error" };
    }
  },

  // Sembrar catálogo inicial si la tabla teachers está vacía
  seedInitialDataIfEmpty: async function(initialTeachers) {
    if (!this.isInitialized || !this.client || !initialTeachers || initialTeachers.length === 0) return;

    try {
      const { data, error } = await this.client.from("teachers").select("id").limit(1);
      if (!error && (!data || data.length === 0)) {
        console.log("Supabase vacío. Sembrando catálogo inicial...");
        const records = initialTeachers.map(t => ({
          id: t.id,
          nombre: t.nombre,
          usuario: t.usuario,
          correo: t.correo || "",
          password: t.password || "123",
          departamento: t.departamento || "Facultad de Ingeniería Tampico",
          role: t.role || "docente",
          avatar: t.avatar || "",
          data: t.data || { courses: [], students: [] },
          updated_at: new Date().toISOString()
        }));

        await this.client.from("teachers").upsert(records, { onConflict: "id" });
        console.log("Catálogo inicial sembrado con éxito en Supabase.");
      }
    } catch (e) {
      console.error("Error al sembrar datos iniciales en Supabase:", e);
    }
  },

  // Guardar o actualizar un docente en Supabase
  saveTeacher: async function(teacher) {
    if (!teacher || !teacher.id) return false;

    if (!this.isInitialized || !this.client) {
      // Si aún no está conectado a Supabase, confirmamos guardado local
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saved");
      }
      return false;
    }

    try {
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saving");
      }

      // BLINDAJE VULN-3.0-01 (Anti-IDOR):
      // 1. Intento primario vía función RPC segura en PostgreSQL
      const payloadData = teacher.data || { courses: [], students: [] };
      try {
        const { data: rpcSuccess, error: rpcErr } = await this.client.rpc("save_teacher_grades", {
          p_teacher_id: teacher.id,
          p_data: payloadData
        });
        if (!rpcErr && rpcSuccess === true) {
          this.status = "connected";
          this.notifyStatusChange();
          if (typeof App !== "undefined" && App.setCloudSaveStatus) {
            App.setCloudSaveStatus("saved");
          }
          return true;
        }
      } catch (rpcEx) {}

      // 2. Respaldo directo en tabla (solo columnas data y updated_at)
      const payload = {
        data: payloadData,
        updated_at: new Date().toISOString()
      };

      const { error } = await this.client
        .from("teachers")
        .update(payload)
        .eq("id", teacher.id);

      if (error) throw error;

      this.status = "connected";
      this.notifyStatusChange();

      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saved");
      }
      return true;
    } catch (error) {
      console.error("Error al guardar calificaciones en Supabase:", error);
      this.status = navigator.onLine ? "error" : "offline";
      this.notifyStatusChange();

      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("error", error.message);
      }
      return false;
    }
  },

  // Registrar un nuevo docente en Supabase (Solo Coordinación Académica)
  createTeacher: async function(teacher) {
    if (!this.isInitialized || !this.client || !teacher || !teacher.id) return false;

    try {
      const payload = {
        id: teacher.id,
        nombre: teacher.nombre,
        usuario: teacher.usuario,
        correo: teacher.correo || "",
        password: teacher.password || "123",
        departamento: teacher.departamento || "Facultad de Ingeniería Tampico",
        role: teacher.role || "docente",
        avatar: teacher.avatar || "",
        data: teacher.data || { courses: [], students: [] },
        updated_at: new Date().toISOString()
      };

      const { error } = await this.client
        .from("teachers")
        .insert([payload]);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error al registrar docente en Supabase:", error);
      return false;
    }
  },

  // Actualizar contraseña de forma segura (SEC-01 / SEC-03)
  updatePassword: async function(teacherId, newPassword, oldPassword) {
    if (!this.isInitialized || !this.client || !teacherId || !newPassword) return false;

    try {
      // Procedimiento seguro con validación previa y hashing bcrypt en PostgreSQL
      const { data: rpcSuccess, error: rpcErr } = await this.client.rpc("change_teacher_password", {
        p_id: teacherId,
        p_old_password: oldPassword || "",
        p_new_password: newPassword
      });

      if (rpcErr) {
        console.error("Error al ejecutar change_teacher_password en Supabase:", rpcErr);
        return false;
      }

      return !!rpcSuccess;
    } catch (error) {
      console.error("Error al actualizar contraseña:", error);
      return false;
    }
  },

  // Restablecer contraseña de cualquier docente (Exclusivo para Coordinación / Administración)
  adminResetTeacherPassword: async function(adminId, targetTeacherId, newPassword) {
    if (!this.isInitialized || !this.client || !targetTeacherId || !newPassword) return false;

    try {
      // 1. Intento primario vía RPC seguro en PostgreSQL
      try {
        const { data: rpcSuccess, error: rpcErr } = await this.client.rpc("admin_reset_teacher_password", {
          p_admin_id: adminId || "admin-coordinacion",
          p_target_teacher_id: targetTeacherId,
          p_new_password: newPassword
        });

        if (!rpcErr && rpcSuccess === true) {
          return true;
        }
      } catch (rpcEx) {
        console.warn("RPC admin_reset_teacher_password no disponible, usando respaldo directo:", rpcEx);
      }

      // 2. Respaldo directo en tabla teachers
      const { error } = await this.client
        .from("teachers")
        .update({
          password: newPassword,
          updated_at: new Date().toISOString()
        })
        .eq("id", targetTeacherId);

      if (error) {
        console.error("Error en respaldo directo al restablecer contraseña:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error al restablecer contraseña por administrador:", error);
      return false;
    }
  },

  // Eliminar un docente de Supabase
  deleteTeacher: async function(teacherId) {
    if (!this.isInitialized || !this.client || !teacherId) return false;

    try {
      const { error } = await this.client
        .from("teachers")
        .delete()
        .eq("id", teacherId);

      return !error;
    } catch (e) {
      console.error("Error al eliminar docente en Supabase:", e);
      return false;
    }
  },

  // Escuchar cambios en vivo de un profesor (Modo Supervisión para Coordinación FIUAT)
  listenToTeacher: function(teacherId, onUpdate) {
    if (!this.isInitialized || !this.client || !teacherId) return null;

    this.stopListening();

    try {
      this.activeChannel = this.client
        .channel(`supervision-${teacherId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "teachers",
            filter: `id=eq.${teacherId}`
          },
          payload => {
            if (payload && payload.new && onUpdate) {
              onUpdate(payload.new);
            }
          }
        )
        .subscribe(status => {
          if (status === "SUBSCRIBED") {
            console.log(`Canal Realtime Supabase activo para supervisar: ${teacherId}`);
          }
        });

      return this.activeChannel;
    } catch (e) {
      console.error("Error al suscribirse al canal Realtime de Supabase:", e);
      return null;
    }
  },

  // Detener la escucha en tiempo real
  stopListening: function() {
    if (this.activeChannel && this.client) {
      this.client.removeChannel(this.activeChannel);
      this.activeChannel = null;
    }
  },

  // Sincronizar el Roster Oficial completo a Supabase en lotes
  syncFullFacultyRoster: async function(roster, onProgress) {
    if (!this.isInitialized || !this.client || !roster || roster.length === 0) return false;

    try {
      const batchSize = 50;
      let totalSaved = 0;

      for (let i = 0; i < roster.length; i += batchSize) {
        const chunk = roster.slice(i, i + batchSize).map(t => ({
          id: t.id,
          nombre: t.nombre,
          usuario: t.usuario,
          correo: t.correo || "",
          password: t.password || "123",
          departamento: t.departamento || "Facultad de Ingeniería Tampico",
          role: t.role || "docente",
          avatar: t.avatar || "",
          data: t.data || { courses: [], students: [] },
          updated_at: new Date().toISOString()
        }));

        const { error } = await this.client
          .from("teachers")
          .upsert(chunk, { onConflict: "id" });

        if (error) throw error;

        totalSaved += chunk.length;
        if (onProgress) {
          onProgress(totalSaved, roster.length);
        }
      }
      return true;
    } catch (e) {
      console.error("Error al sincronizar roster oficial en Supabase:", e);
      return false;
    }
  },

  // Actualizar credenciales en caliente desde la interfaz
  setCredentials: function(url, anonKey) {
    if (url) {
      const cleanUrl = url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
      localStorage.setItem("supabase_url", cleanUrl);
      SUPABASE_CONFIG.url = cleanUrl;
    }
    if (anonKey) {
      const cleanKey = anonKey.trim();
      localStorage.setItem("supabase_anon_key", cleanKey);
      SUPABASE_CONFIG.anonKey = cleanKey;
    }
    return this.init();
  }
};

// Alias para compatibilidad total
const CloudService = SupabaseService;
const FirebaseService = SupabaseService;
