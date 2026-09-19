// supabase_service.js - Módulo de integración con Supabase (PostgreSQL + Realtime)
// Reemplaza a Firebase Firestore para la persistencia en la nube y supervisión en tiempo real

const SUPABASE_CONFIG = {
  // Configura aquí tus credenciales de Supabase (Settings -> API en supabase.com)
  // O puedes configurarlas dinámicamente desde el menú de la aplicación
  url: localStorage.getItem("supabase_url") || "https://your-project-id.supabase.co",
  anonKey: localStorage.getItem("supabase_anon_key") || "your-anon-key-here"
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

    const isPlaceholder = !SUPABASE_CONFIG.url || 
                          SUPABASE_CONFIG.url.includes("your-project-id") || 
                          !SUPABASE_CONFIG.anonKey || 
                          SUPABASE_CONFIG.anonKey.includes("your-anon-key");

    if (isPlaceholder) {
      console.warn("Supabase: Credenciales pendientes de configurar. Se usarán datos locales hasta que ingreses tu URL y Anon Key.");
      this.status = "offline";
      return false;
    }

    try {
      this.client = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
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

  // Obtener todos los profesores desde Supabase
  fetchTeachers: async function() {
    if (!this.isInitialized || !this.client) return null;

    try {
      const { data, error } = await this.client
        .from("teachers")
        .select("*")
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
        .upsert(payload, { onConflict: "id" });

      if (error) throw error;

      this.status = "connected";
      this.notifyStatusChange();

      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saved");
      }
      return true;
    } catch (error) {
      console.error("Error al guardar docente en Supabase:", error);
      this.status = navigator.onLine ? "error" : "offline";
      this.notifyStatusChange();

      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("error", error.message);
      }
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
    if (url) localStorage.setItem("supabase_url", url.trim());
    if (anonKey) localStorage.setItem("supabase_anon_key", anonKey.trim());
    SUPABASE_CONFIG.url = url ? url.trim() : SUPABASE_CONFIG.url;
    SUPABASE_CONFIG.anonKey = anonKey ? anonKey.trim() : SUPABASE_CONFIG.anonKey;
    return this.init();
  }
};

// Alias para compatibilidad total
const CloudService = SupabaseService;
const FirebaseService = SupabaseService;
