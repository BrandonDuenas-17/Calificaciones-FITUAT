// supabase_service.js - Cliente RPC autenticado contra Supabase (PostgreSQL)
// Todas las operaciones pasan por funciones SECURITY DEFINER validadas con token de sesión.

const SUPABASE_CONFIG = {
  url: "https://xjlqzwigqmevbffaavjl.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbHF6d2lncW1ldmJmZmFhdmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4MzI2NzcsImV4cCI6MjEwNTQwODY3N30.T4U1JRUH4DiGAZWhaFd83Q1em2NUHWxMCpibeX2-OFs"
};

const SESSION_TOKEN_KEY = "fiuat_server_session_token";

const SupabaseService = {
  client: null,
  isInitialized: false,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  status: "connecting", // "connected", "offline", "error"
  lastError: null,
  _pollInterval: null,
  _reconnectTimer: null,
  _listenersBound: false,

  _rpcWithTimeout: async function(fnName, params = {}, timeoutMs = 12000) {
    if (!this.client) {
      return { data: null, error: new Error("Cliente Supabase no inicializado") };
    }
    let timer = null;
    try {
      const rpcPromise = this.client.rpc(fnName, params);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${Math.round(timeoutMs / 1000)}s) en la red Wi-Fi`)), timeoutMs);
      });
      return await Promise.race([rpcPromise, timeoutPromise]);
    } catch (err) {
      return { data: null, error: err };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  scheduleReconnect: function() {
    if (this._reconnectTimer || typeof window === "undefined") return;
    this._reconnectTimer = setInterval(async () => {
      if (this.isInitialized && this.status === "connected") {
        clearInterval(this._reconnectTimer);
        this._reconnectTimer = null;
        return;
      }
      await this.checkConnection();
    }, 5000);
  },

  stopReconnect: function() {
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  },

  ensureConnected: async function() {
    if (this.isInitialized && this.client) return true;
    if (this.client) {
      return await this.checkConnection();
    }
    return await this.init();
  },

  getSessionToken: function() {
    try {
      return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  },

  setSessionToken: function(token) {
    try {
      if (token) {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      } else {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    } catch (e) {}
  },

  init: async function() {
    if (typeof supabase === "undefined") {
      console.warn("Supabase SDK no detectado.");
      this.status = "offline";
      return false;
    }

    try {
      if (!this.client) {
        this.client = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        });
      }

      if (!this._listenersBound && typeof window !== "undefined" && window.addEventListener) {
        this._listenersBound = true;
        window.addEventListener("online", () => {
          this.isOnline = true;
          this.checkConnection();
        });

        window.addEventListener("offline", () => {
          this.isOnline = false;
          this.status = "offline";
          this.notifyStatusChange();
          this.scheduleReconnect();
        });
      }

      // Health-check fail-fast (5s) sin consultar la tabla teachers
      const probeResult = await this._rpcWithTimeout("ping_service", {}, 5000);

      // Si ping_service aún no existe en BD (PGRST202), el servidor respondió y está en línea
      const isSchemaPending = probeResult.error && (probeResult.error.code === "PGRST202" || String(probeResult.error.message || "").includes("ping_service"));
      if (probeResult.error && !isSchemaPending) {
        console.warn("Supabase no disponible o portal Wi-Fi pendiente:", probeResult.error.message || probeResult.error);
        this.isInitialized = false;
        this.status = "offline";
        this.scheduleReconnect();
        return false;
      }

      this.isInitialized = true;
      this.status = (typeof navigator === "undefined" || navigator.onLine) ? "connected" : "offline";
      this.stopReconnect();
      return true;
    } catch (err) {
      console.error("Error al inicializar Supabase Client:", err);
      this.isInitialized = false;
      this.status = "error";
      this.scheduleReconnect();
      return false;
    }
  },

  notifyStatusChange: function() {
    if (typeof App !== "undefined" && App.updateCloudStatusBadge) {
      App.updateCloudStatusBadge();
    }
  },

  // Inicio de sesión autenticado vía RPC (rate-limit + bcrypt + emisión de token en Postgres)
  login: async function(identifier, password) {
    this.lastError = null;
    if (!this.isInitialized || !this.client) {
      const connected = await this.ensureConnected();
      if (!connected || !this.client) {
        return { success: false, reason: "connection_error" };
      }
    }

    try {
      const { data, error } = await this._rpcWithTimeout("login_teacher", {
        p_identifier: (identifier || "").trim().toLowerCase(),
        p_password: password || ""
      }, 12000);

      if (error) {
        if (error.code === "PGRST202" || String(error.message || "").includes("login_teacher")) {
          this.lastError = "Actualización de seguridad pendiente en Supabase (ejecuta supabase_schema.sql).";
          return { success: false, reason: "schema_pending", message: this.lastError };
        }
        this.lastError = error.message;
        return { success: false, reason: "connection_error", message: error.message };
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return { success: false, reason: "user_not_found" };
      }
      if (typeof row !== "object" || typeof row.success !== "boolean") {
        this.lastError = "La red Wi-Fi interceptó la respuesta (verifica el portal cautivo de la UAT).";
        return { success: false, reason: "connection_error", message: this.lastError };
      }

      if (row.success && row.session_token && row.id) {
        this.setSessionToken(row.session_token);
        this.status = "connected";
        this.notifyStatusChange();
        return {
          success: true,
          sessionToken: row.session_token,
          mustChangePassword: !!row.must_change_password,
          teacherId: row.id,
          teacher: {
            id: row.id,
            nombre: row.nombre,
            usuario: row.usuario,
            correo: row.correo,
            departamento: row.departamento,
            role: row.role || "docente",
            avatar: row.avatar || ""
          }
        };
      }

      return {
        success: false,
        reason: row.reason || "wrong_password",
        retryAfter: Number(row.retry_after) || 0
      };
    } catch (e) {
      console.error("Error en login_teacher:", e);
      this.lastError = e.message;
      return { success: false, reason: "connection_error", message: e.message };
    }
  },

  // Validar sesión existente contra la tabla teacher_sessions en Postgres
  validateSession: async function() {
    const token = this.getSessionToken();
    if (!token) return null;
    if (!this.isInitialized || !this.client) {
      const connected = await this.ensureConnected();
      if (!connected || !this.client) return null;
    }

    try {
      const { data, error } = await this._rpcWithTimeout("validate_session", { p_token: token }, 10000);
      if (error) return null;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object" || typeof row.valid !== "boolean") {
        // Respuesta interceptada por portal cautivo o corte temporal: NO borrar token válido
        return null;
      }
      if (!row.valid || !row.id) {
        this.setSessionToken("");
        return null;
      }

      return {
        mustChangePassword: !!row.must_change_password,
        teacher: {
          id: row.id,
          nombre: row.nombre,
          usuario: row.usuario,
          correo: row.correo,
          departamento: row.departamento,
          role: row.role || "docente",
          avatar: row.avatar || ""
        }
      };
    } catch (e) {
      return null;
    }
  },

  // Revocar sesión en servidor
  logout: async function() {
    this.stopListening();
    this.stopReconnect();
    const token = this.getSessionToken();
    this.setSessionToken("");
    if (!token || !this.isInitialized || !this.client) return true;

    try {
      await this._rpcWithTimeout("logout_teacher", { p_token: token }, 5000);
    } catch (e) {}
    return true;
  },

  // Obtener resumen ligero de docentes (Solo Coordinación; sin descargar 18,702 registros)
  fetchAdminTeachersSummary: async function() {
    const token = this.getSessionToken();
    if (!token) return null;
    if (!this.isInitialized || !this.client) {
      await this.ensureConnected();
    }
    if (!this.isInitialized || !this.client) return null;

    try {
      const { data, error } = await this._rpcWithTimeout("get_admin_teachers_summary", { p_token: token }, 12000);
      if (error || !Array.isArray(data)) {
        if (error) console.error("Error al obtener resumen docente:", error);
        return null;
      }

      return data.map(row => ({
        id: row.id,
        nombre: row.nombre,
        usuario: row.usuario,
        correo: row.correo,
        departamento: row.departamento,
        role: row.role || "docente",
        avatar: row.avatar || "",
        updated_at: row.updated_at,
        coursesCount: Number(row.courses_count) || 0,
        studentsCount: Number(row.students_count) || 0,
        coursesPreview: Array.isArray(row.courses_preview) ? row.courses_preview : []
      }));
    } catch (e) {
      console.error("Error de red al consultar resumen docente:", e);
      return null;
    }
  },

  // Descarga quirúrgica de calificaciones de un docente (solo dueño o admin)
  fetchTeacherData: async function(teacherId) {
    const token = this.getSessionToken();
    if (!token || !teacherId) return null;
    if (!this.isInitialized || !this.client) {
      await this.ensureConnected();
    }
    if (!this.isInitialized || !this.client) return null;

    try {
      const { data, error } = await this._rpcWithTimeout("get_teacher_data", {
        p_token: token,
        p_teacher_id: teacherId
      }, 12000);

      if (error) {
        console.error("Error al obtener calificaciones del docente:", error);
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object" || !row.ok) return null;

      return {
        data: row.data || { courses: [], students: [] },
        updated_at: row.updated_at || null
      };
    } catch (e) {
      console.error("Error de red al consultar calificaciones del docente:", e);
      return null;
    }
  },

  // Guardar calificaciones autenticado con bloqueo optimista (anti-IDOR y anti-sobrescritura)
  saveTeacher: async function(teacher, expectedUpdatedAt = null) {
    if (!teacher || !teacher.id) return { ok: false, reason: "invalid_teacher" };
    const token = this.getSessionToken();

    if (!token) {
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("error", "Sin sesión activa en la nube");
      }
      return { ok: false, reason: "offline" };
    }

    if (!this.isInitialized || !this.client) {
      await this.ensureConnected();
    }
    if (!this.isInitialized || !this.client) {
      this.scheduleReconnect();
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("error", "Reconectando con la red Wi-Fi...");
      }
      return { ok: false, reason: "offline" };
    }

    try {
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saving");
      }

      const payloadData = teacher.data || { courses: [], students: [] };
      const { data, error } = await this._rpcWithTimeout("save_teacher_grades", {
        p_token: token,
        p_teacher_id: teacher.id,
        p_data: payloadData,
        p_expected_updated_at: expectedUpdatedAt || null
      }, 12000);

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object" || (typeof row.ok !== "boolean" && typeof row.conflict !== "boolean")) {
        throw new Error("Respuesta inválida de la red Wi-Fi (verifica tu conexión o portal cautivo)");
      }

      if (row.conflict) {
        return { ok: false, conflict: true, updated_at: row.updated_at, reason: "conflict" };
      }

      if (!row.ok) {
        const msg = row.reason === "unauthorized" ? "Sesión expirada. Vuelve a iniciar sesión." : (row.reason || "No autorizado");
        if (typeof App !== "undefined" && App.setCloudSaveStatus) {
          App.setCloudSaveStatus("error", msg);
        }
        return { ok: false, conflict: false, reason: row.reason };
      }

      this.status = "connected";
      this.stopReconnect();
      this.notifyStatusChange();
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saved");
      }
      return { ok: true, conflict: false, updated_at: row.updated_at };
    } catch (error) {
      console.error("Error al guardar calificaciones en Supabase:", error);
      this.status = (typeof navigator !== "undefined" && navigator.onLine) ? "error" : "offline";
      this.notifyStatusChange();
      this.scheduleReconnect();
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("error", error.message);
      }
      return { ok: false, conflict: false, reason: error.message };
    }
  },

  // Cambio de contraseña propia con bcrypt en servidor
  updatePassword: async function(oldPassword, newPassword) {
    this.lastError = null;
    const token = this.getSessionToken();
    if (!token || !this.isInitialized || !this.client || !newPassword) {
      this.lastError = "No hay sesión activa en el servidor.";
      return false;
    }

    try {
      const { data, error } = await this.client.rpc("change_teacher_password", {
        p_token: token,
        p_old_password: oldPassword || "",
        p_new_password: (newPassword || "").trim()
      });

      if (error) {
        this.lastError = error.message;
        return false;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.ok) {
        const map = {
          wrong_password: "La contraseña actual ingresada es incorrecta.",
          password_too_short: "La nueva contraseña debe tener al menos 6 caracteres.",
          default_password_forbidden: "No puedes volver a usar '123' como contraseña.",
          unauthorized: "Tu sesión expiró. Vuelve a iniciar sesión."
        };
        this.lastError = map[row?.reason] || "No se pudo actualizar la contraseña.";
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error al actualizar contraseña:", error);
      this.lastError = error.message;
      return false;
    }
  },

  // Restablecimiento de clave de un docente (solo Coordinación)
  adminResetTeacherPassword: async function(adminPassword, targetTeacherId, newPassword) {
    this.lastError = null;
    const token = this.getSessionToken();
    if (!token || !this.isInitialized || !this.client || !targetTeacherId || !newPassword || !adminPassword) {
      this.lastError = "Parámetros incompletos para restablecer la contraseña.";
      return false;
    }

    try {
      const { data, error } = await this.client.rpc("admin_reset_teacher_password", {
        p_token: token,
        p_admin_password: (adminPassword || "").trim(),
        p_target_teacher_id: (targetTeacherId || "").trim(),
        p_new_password: (newPassword || "").trim()
      });

      if (error) {
        this.lastError = error.message;
        return false;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.ok) {
        const map = {
          wrong_admin_password: "La contraseña de administrador es incorrecta.",
          forbidden: "Se requieren privilegios de Coordinación Académica.",
          target_not_found: "Docente no encontrado en la base de datos.",
          password_too_short: "La nueva contraseña debe tener al menos 3 caracteres."
        };
        this.lastError = map[row?.reason] || "No se pudo restablecer la contraseña.";
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error al restablecer contraseña por administrador:", error);
      this.lastError = "Error de conexión con la base de datos: " + (error.message || error);
      return false;
    }
  },

  // Alta de nuevo docente (solo Coordinación)
  createTeacher: async function(teacher) {
    this.lastError = null;
    const token = this.getSessionToken();
    if (!token || !this.isInitialized || !this.client || !teacher || !teacher.id) {
      this.lastError = "Sin autorización o datos incompletos.";
      return false;
    }

    try {
      const { data, error } = await this.client.rpc("admin_create_teacher", {
        p_token: token,
        p_id: teacher.id,
        p_nombre: teacher.nombre,
        p_usuario: teacher.usuario,
        p_correo: teacher.correo || "",
        p_password: teacher.password || "",
        p_departamento: teacher.departamento || "Facultad de Ingeniería Tampico",
        p_data: teacher.data || { courses: [], students: [] }
      });

      if (error) {
        this.lastError = error.message;
        return false;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.ok) {
        const map = {
          duplicate_teacher: "Ya existe un docente con ese usuario o correo.",
          forbidden: "Solo Coordinación Académica puede registrar nuevos docentes.",
          invalid_input: "Completa todos los campos (contraseña mínimo 4 caracteres)."
        };
        this.lastError = map[row?.reason] || "No se pudo registrar el docente.";
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error al registrar docente:", error);
      this.lastError = error.message;
      return false;
    }
  },

  // Respaldo global autenticado para Coordinación (sin contraseñas)
  exportAllTeachers: async function() {
    const token = this.getSessionToken();
    if (!token || !this.isInitialized || !this.client) return null;

    try {
      const { data, error } = await this.client.rpc("admin_export_all_teachers", { p_token: token });
      if (error) {
        console.error("Error al exportar respaldo global:", error);
        return null;
      }
      return data || [];
    } catch (e) {
      console.error("Error de red al exportar respaldo global:", e);
      return null;
    }
  },

  // Sondeo seguro en Modo Supervisión (sin abrir SELECT público para Realtime)
  listenToTeacher: function(teacherId, onUpdate, getLastUpdatedAt) {
    this.stopListening();
    if (!this.isInitialized || !this.client || !teacherId) return null;

    this._pollInterval = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await this.fetchTeacherData(teacherId);
      if (!res) return;
      const known = typeof getLastUpdatedAt === "function" ? getLastUpdatedAt() : null;
      if (res.updated_at && res.updated_at !== known && typeof onUpdate === "function") {
        onUpdate(res);
      }
    }, 12000);

    return this._pollInterval;
  },

  stopListening: function() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  },

  // Reconexión dinámica en segundo plano
  checkConnection: async function() {
    if (!this.client) return false;
    try {
      const probeResult = await this._rpcWithTimeout("ping_service", {}, 4000);
      const isOk = (!probeResult.error && probeResult.data === true) || (probeResult.error && probeResult.error.code === "PGRST202");
      if (isOk) {
        const wasOffline = !this.isInitialized || this.status !== "connected";
        this.isInitialized = true;
        this.status = "connected";
        this.stopReconnect();
        this.notifyStatusChange();
        if (wasOffline && typeof App !== "undefined" && App.onCloudReconnected) {
          App.onCloudReconnected();
        }
        return true;
      }
    } catch (e) {}
    this.status = "offline";
    this.notifyStatusChange();
    return false;
  }
};
