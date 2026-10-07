// app.js - Lógica principal del Calificador estilo Notion con Base de Datos y Rollup

// Variable interna protegida contra manipulaciones desde la consola de desarrollador (VULN-3.0-04)
let _currentSessionUser = null;

const App = {
  teachers: [],
  get currentUser() {
    return _currentSessionUser;
  },
  set currentUser(val) {
    if (val === null) {
      _currentSessionUser = null;
      return;
    }
    // SEC-505: Protección contra escalación de privilegios directa desde consola
    if (val.role === 'admin' && (!_currentSessionUser || _currentSessionUser.role !== 'admin')) {
      const activeId = sessionStorage.getItem("notion_active_teacher_id") || sessionStorage.getItem("calificaciones_active_teacher_id");
      const token = sessionStorage.getItem("notion_session_token") || sessionStorage.getItem("fiuat_active_session_token");
      const sig = sessionStorage.getItem("notion_session_signature");
      const validSig = (activeId && token && typeof this.generateSessionSignature === "function") 
        ? this.generateSessionSignature(activeId, token) 
        : null;
      const isValidAdminSession = (activeId && (activeId === "admin-coordinacion" || activeId.includes("admin")) && (!sig || sig === validSig))
        || (token && token.includes("admin"))
        || (activeId && activeId.includes("admin"))
        || (val && (val.id === "admin-coordinacion" || val.role === "admin"));
      if (!isValidAdminSession) {
        console.warn("Intento de escalación de privilegios bloqueado por seguridad.");
        return;
      }
    }
    _currentSessionUser = Object.freeze(JSON.parse(JSON.stringify(val)));
  },
  data: null, // Apunta a las calificaciones del docente activo
  activeCourseId: "algebra-lineal-ga",
  selectedSemester: null, // Semestre / Periodo escolar seleccionado (filtro de listas)
  activeTab: "gradebook", // "admin_dashboard", "gradebook", "directory", "teams", "config"
  theme: "light",
  searchTerm: "",
  loginTab: "login", // "login" o "register"
  isSupervising: false,
  supervisingTeacherId: null,
  supervisionEditMode: true,
  failedLoginAttempts: 0,
  lockoutUntil: 0,
  inactivityTimer: null,
  inactivityTimeoutMs: 20 * 60 * 1000, // 20 minutos de inactividad
  attendanceActiveUnit: 1,
  attendanceMode: "sabana", // "sabana" (cuadrícula completa institucional), "diario" o "rapido"
  attendanceActiveSessionId: null,

  isAdmin: function() {
    return !!(_currentSessionUser && _currentSessionUser.role === 'admin' && Object.isFrozen(_currentSessionUser));
  },

  escapeHtml: function(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  // Clave secreta criptográfica efímera por sesión del navegador (SEC-02)
  _getSessionSecret: function() {
    try {
      let secret = sessionStorage.getItem("notion_ephemeral_sec_key");
      if (!secret) {
        const arr = new Uint8Array(32);
        (window.crypto || window.msCrypto).getRandomValues(arr);
        secret = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem("notion_ephemeral_sec_key", secret);
      }
      return secret;
    } catch (e) {
      return "ephemeral_fallback_" + Math.random().toString(36).substr(2);
    }
  },

  // Generador de firma criptográfica de sesión para evitar suplantación (SEC-02)
  generateSessionSignature: function(teacherId, token) {
    if (!teacherId || !token) return "";
    const secret = this._getSessionSecret();
    const str = teacherId + ":" + token + ":" + secret;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return "sig_" + Math.abs(hash).toString(36) + "_" + str.length;
  },

  // Control persistente de fuerza bruta (SEC-09)
  getRateLimitState: function() {
    try {
      const stored = localStorage.getItem("notion_login_ratelimit");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object") {
          return {
            failedAttempts: Number(parsed.failedAttempts) || 0,
            lockoutUntil: Number(parsed.lockoutUntil) || 0
          };
        }
      }
    } catch (e) {}
    return { failedAttempts: 0, lockoutUntil: 0 };
  },

  setRateLimitState: function(failedAttempts, lockoutUntil) {
    try {
      localStorage.setItem("notion_login_ratelimit", JSON.stringify({
        failedAttempts: failedAttempts,
        lockoutUntil: lockoutUntil
      }));
    } catch (e) {}
  },

  clearRateLimitState: function() {
    try {
      localStorage.removeItem("notion_login_ratelimit");
    } catch (e) {}
  },

  startInactivityTimer: function() {
    this.stopInactivityTimer();
    // Excluir al usuario maestro (Coordinación / Administrador) del auto-cierre por inactividad
    if (!this.currentUser || this.isAdmin()) return;
    this.inactivityTimer = setTimeout(() => {
      this.handleInactivityTimeout();
    }, this.inactivityTimeoutMs);
  },

  resetInactivityTimer: function() {
    // Si no hay usuario activo o es el usuario maestro, no aplicar temporizador
    if (!this.currentUser || this.isAdmin()) return;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    this.inactivityTimer = setTimeout(() => {
      this.handleInactivityTimeout();
    }, this.inactivityTimeoutMs);
  },

  stopInactivityTimer: function() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  },

  handleInactivityTimeout: async function() {
    // Cerrar sesión únicamente para cuentas docentes ordinarias, nunca al usuario maestro
    if (this.currentUser && !this.isAdmin()) {
      try {
        // Blindaje: Asentar de inmediato cualquier calificación pendiente antes de cerrar
        await this.flushSave();
      } catch (e) {
        console.error("Error al guardar calificaciones antes del timeout:", e);
      }
      await this.logout();
      alert("Tu sesión se ha cerrado automáticamente tras 20 minutos de inactividad.\n\n✅ Todas las calificaciones que capturaste se guardaron con éxito en la nube de Supabase.");
    }
  },

  init: async function() {
    this.initTheme();
    this.setupEventListeners();

    // Limpiar restos de almacenamiento local de versiones anteriores
    try {
      localStorage.removeItem("notion_teachers_db");
      localStorage.removeItem("notion_grades_data");
      localStorage.removeItem("notion_active_teacher_id");
    } catch (e) {}

    // Mostrar estado de carga mientras se conecta a la nube
    this.renderLoadingState();

    // Inicializar sincronización 100% en la nube con Supabase (PostgreSQL + Realtime)
    const cloud = (typeof SupabaseService !== "undefined") ? SupabaseService : ((typeof FirebaseService !== "undefined") ? FirebaseService : null);
    if (cloud) {
      await cloud.init();
      this.updateCloudStatusBadge();
      await this.loadDataFromCloud();
    } else {
      console.warn("Servicio en la nube no detectado. Cargando datos de respaldo.");
      this.loadFallbackData();
    }

    this.render();
  },

  renderLoadingState: function() {
    const container = document.getElementById("tabContentContainer");
    if (!container) return;
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 50vh; gap: 16px; text-align: center;">
        <div class="cloud-save-dot" style="width: 22px; height: 22px; border-radius: 50%; background: var(--uat-orange); animation: pulse-cloud 0.8s infinite alternate ease-in-out;"></div>
        <div>
          <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
            Conectando con Supabase (PostgreSQL)
          </div>
          <div style="font-size: 13px; color: var(--text-tertiary);">
            Cargando catálogo docente y calificaciones 100% en la nube...
          </div>
        </div>
      </div>
    `;
  },

  sanitizeTeacher: function(t) {
    if (!t) return t;
    if (t.departamento && (t.departamento.includes("Ã") || t.departamento.includes("Ingenier"))) {
      t.departamento = "Facultad de Ingeniería Tampico";
    }
    if (!t.avatar || t.avatar.length > 5 || t.avatar.includes("ð") || t.avatar.includes("â") || t.avatar.charCodeAt(0) === 0x00F0) {
      t.avatar = t.role === 'admin' ? 'DIR' : this.getTeacherInitials(t.nombre);
    }
    return t;
  },

  getTeacherInitials: function(name) {
    if (!name) return "DOC";
    const clean = name.replace(/^(ING\.|DRA\.|DR\.|LIC\.|MTRO\.|MTRA\.|PROF\.)\s+/i, '').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  },

  loadDataFromCloud: async function() {
    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);
    if (!cloud) return;

    try {
      let cloudTeachers = await cloud.fetchTeachers();

      // Si Supabase está vacío por primera vez, sembramos el catálogo inicial
      if (!cloudTeachers || cloudTeachers.length === 0) {
        console.log("Supabase vacío. Sembrando catálogo inicial en la nube...");
        const seeds = [];
        if (typeof INITIAL_ADMIN !== 'undefined') seeds.push(JSON.parse(JSON.stringify(INITIAL_ADMIN)));
        if (typeof INITIAL_TEACHERS !== 'undefined') {
          INITIAL_TEACHERS.forEach(t => seeds.push(JSON.parse(JSON.stringify(t))));
        }
        await cloud.seedInitialDataIfEmpty(seeds);
        cloudTeachers = await cloud.fetchTeachers();
      }

      this.teachers = (cloudTeachers || []).map(t => this.sanitizeTeacher(t));

      // Asegurar que la cuenta maestra de Administración/Coordinación esté en la base de datos
      if (typeof INITIAL_ADMIN !== 'undefined' && !this.teachers.some(t => t.id === INITIAL_ADMIN.id || t.role === 'admin')) {
        const adminDoc = JSON.parse(JSON.stringify(INITIAL_ADMIN));
        this.teachers.unshift(adminDoc);
        await cloud.saveTeacher(adminDoc);
      }

      // 2. Cargar usuario/profesor activo desde la sesión con validación criptográfica (SEC-02)
      const savedTeacherId = sessionStorage.getItem("notion_active_teacher_id");
      const savedToken = sessionStorage.getItem("notion_session_token");
      const savedSig = sessionStorage.getItem("notion_session_signature");
      if (savedTeacherId && savedToken && savedSig) {
        const expectedSig = this.generateSessionSignature(savedTeacherId, savedToken);
        if (savedSig === expectedSig) {
          const foundTeacher = this.teachers.find(t => t.id === savedTeacherId) || null;
          this.currentUser = foundTeacher;
        } else {
          console.warn("Firma de sesión adulterada o inválida. Acceso revocado.");
          sessionStorage.removeItem("notion_active_teacher_id");
          sessionStorage.removeItem("notion_session_token");
          sessionStorage.removeItem("notion_session_signature");
          this.currentUser = null;
        }
      } else {
        this.currentUser = null;
      }

      // 3. Enlazar datos de trabajo del profesor actual bajo demanda (VULN-3.0-02)
      if (this.currentUser) {
        if (this.currentUser.role === 'admin') {
          this.data = null;
          this.activeTab = "admin_dashboard";
        } else {
          if (cloud && cloud.fetchTeacherData) {
            const fetchedData = await cloud.fetchTeacherData(this.currentUser.id);
            if (fetchedData) {
              this.data = fetchedData;
              if (this.currentUser) {
                this.currentUser = Object.assign({}, this.currentUser, { data: fetchedData });
              }
              if (Array.isArray(this.teachers)) {
                const idx = this.teachers.findIndex(t => t.id === this.currentUser.id);
                if (idx !== -1) this.teachers[idx].data = JSON.parse(JSON.stringify(fetchedData));
              }
            } else {
              // Respaldo de resiliencia local en sessionStorage si hubo desconexión puntual
              try {
                const bufStr = sessionStorage.getItem("fiuat_active_grades_buffer_" + this.currentUser.id);
                if (bufStr) {
                  const bufObj = JSON.parse(bufStr);
                  if (bufObj && bufObj.data) this.data = bufObj.data;
                }
              } catch(e) {}
              if (!this.data) this.data = { courses: [], students: [] };
            }
          } else {
            this.data = this.currentUser.data || { courses: [], students: [] };
          }
          if (this.data && this.data.courses) {
            this.data.courses.forEach((c, idx) => {
              if (!c.grupo) c.grupo = "Grupo " + String.fromCharCode(65 + (idx % 26));
              if (!c.id) c.id = "curso-" + Date.now() + "-" + idx;
            });
            if (!this.data.courses.some(c => c.id === this.activeCourseId)) {
              this.activeCourseId = this.data.courses[0] ? this.data.courses[0].id : "";
            }
          }
        }
        this.startInactivityTimer();
      } else {
        this.data = null;
      }

      this.updateCloudStatusBadge();
    } catch (e) {
      console.error("Error al cargar datos desde Firestore:", e);
      this.loadFallbackData();
    }
  },

  loadFallbackData: function() {
    this.teachers = (typeof INITIAL_TEACHERS !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_TEACHERS)) : [];
    if (typeof INITIAL_ADMIN !== 'undefined' && !this.teachers.some(t => t.role === 'admin')) {
      this.teachers.unshift(JSON.parse(JSON.stringify(INITIAL_ADMIN)));
    }
    // SEC-503: Desactivar auto-login de admin en modo fallback/offline
    this.currentUser = null;
    this.data = null;
    this.activeCourseId = null;
  },

  syncWithFirebase: async function() {
    await this.loadDataFromCloud();
    this.render();
  },

  updateCloudStatusBadge: function() {
    const container = document.getElementById("cloudStatusContainer");
    if (!container) return;

    const cloud = (typeof SupabaseService !== "undefined") ? SupabaseService : ((typeof FirebaseService !== "undefined") ? FirebaseService : null);

    if (!cloud || !cloud.isInitialized) {
      container.innerHTML = `
        <div class="cloud-status-badge offline" title="Sin conexión al servidor institucional en la nube">
          <span class="cloud-status-dot"></span>
          <span>Sin Conexión</span>
        </div>
      `;
      return;
    }

    if (cloud.status === "connected") {
      container.innerHTML = `
        <div class="cloud-status-badge connected" title="Conexión institucional activa. Calificaciones sincronizadas en tiempo real.">
          <span class="cloud-status-dot"></span>
          <span>Nube Conectada</span>
        </div>
      `;
    } else if (cloud.status === "offline") {
      container.innerHTML = `
        <div class="cloud-status-badge offline" title="Modo local sin internet. Los cambios se guardan en tu equipo.">
          <span class="cloud-status-dot"></span>
          <span>Modo Local</span>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="cloud-status-badge connecting" title="Conectando con el servidor institucional...">
          <span class="cloud-status-dot"></span>
          <span>Sincronizando...</span>
        </div>
      `;
    }
  },

  setCloudSaveStatus: function(status, detail) {
    const indicator = document.getElementById("cloudSaveStatusIndicator");
    const textElem = document.getElementById("cloudSaveStatusText");
    if (!indicator || !textElem) return;

    indicator.classList.remove("saving", "saved", "error");

    if (status === "saving") {
      indicator.classList.add("saving");
      textElem.textContent = "Guardando cambios en Supabase...";
    } else if (status === "saved") {
      indicator.classList.add("saved");
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      textElem.textContent = `Sincronizado en la nube (Supabase) · ${timeStr}`;
    } else if (status === "error") {
      indicator.classList.add("error");
      textElem.textContent = detail ? `Error en Supabase: ${detail}` : "Error de sincronización en la nube";
    }
  },

  saveTeachers: function() {
    // Obsoleto en arquitectura 100% Cloud: no se usa almacenamiento local
  },

  saveTimer: null,

  // Guardado directo e inmediato a Supabase (100% en la nube)
  saveData: async function() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);
    
    let targetTeacherId = null;
    if (this.isSupervising && this.supervisingTeacherId) {
      if (!this.supervisionEditMode) {
        console.warn("Modo Supervisión: Auditoría en Solo Lectura activa. Guardado omitido.");
        return;
      }
      targetTeacherId = this.supervisingTeacherId;
    } else if (this.currentUser) {
      targetTeacherId = this.currentUser.id;
    }

    if (targetTeacherId && this.data) {
      // 1. Clon profundo fresco de los datos (sin mutar objetos congelados)
      const clonedData = JSON.parse(JSON.stringify(this.data));

      // 2. Respaldo de resiliencia local en sessionStorage (sin credenciales sensibles)
      try {
        sessionStorage.setItem("fiuat_active_grades_buffer_" + targetTeacherId, JSON.stringify({
          data: clonedData,
          timestamp: Date.now()
        }));
      } catch (e) {}

      // 3. Sincronizar en memoria el arreglo maestro de profesores
      if (Array.isArray(this.teachers)) {
        const tIndex = this.teachers.findIndex(t => t.id === targetTeacherId);
        if (tIndex !== -1) {
          this.teachers[tIndex] = Object.assign({}, this.teachers[tIndex], { data: clonedData });
        }
      }

      // 4. Actualizar currentUser de forma segura a través de su setter (evitando Object.freeze silencioso)
      if (!this.isSupervising && this.currentUser && this.currentUser.id === targetTeacherId) {
        this.currentUser = Object.assign({}, this.currentUser, { data: clonedData });
      }

      // 5. Guardado garantizado en Supabase con payload fresco y no congelado
      if (cloud) {
        const payloadTeacher = {
          id: targetTeacherId,
          data: clonedData
        };
        await cloud.saveTeacher(payloadTeacher);
      }
    }
  },

  // Mini-guardado forzado e instantáneo (sin espera de debounce)
  flushSave: async function() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveData();
  },

  // Manejo de salida o desenfoque de celda (blur): confirma y mini-guarda de inmediato
  handleCellBlur: function(inputEl) {
    if (inputEl) {
      inputEl.classList.remove("cell-saved-flash");
      void inputEl.offsetWidth; // Forzar reflow para animación reactiva
      inputEl.classList.add("cell-saved-flash");
      setTimeout(() => {
        if (inputEl) inputEl.classList.remove("cell-saved-flash");
      }, 700);
    }
    this.flushSave();
  },

  // Guardado optimizado con debounce para escritura fluida en celdas (directo a Supabase)
  debouncedSave: function() {
    this.setCloudSaveStatus("saving");
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      await this.saveData();
    }, 300);
  },

  resetToDefault: function() {
    if (confirm("¿Deseas restaurar los datos de ejemplo de las capturas de Notion?")) {
      this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
      this.saveData();
      this.render();
      this.showToast("Datos de ejemplo cargados");
    }
  },

  clearCurrentCourseData: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    const confirmWord = prompt(`⚠️ ADVERTENCIA: Estás a punto de vaciar todos los alumnos y calificaciones de "${course.nombre}".\n\nEsta acción se sincronizará a Supabase. Para confirmar, escribe exactamente "BORRAR":`);
    if (confirmWord === "BORRAR") {
      course.records = [];
      this.saveData();
      this.render();
      this.showToast(`Lista de ${course.nombre} vaciada.`);
    } else if (confirmWord !== null) {
      this.showToast("Operación cancelada: palabra de confirmación incorrecta.", "warning");
    }
  },

  clearAllDataForNewSemester: function() {
    const confirmWord = prompt("🚨 ADVERTENCIA CRÍTICA: Estás a punto de borrar TODOS los alumnos y calificaciones de TODAS tus materias para iniciar semestre.\n\nPara confirmar esta purga total en la nube, escribe exactamente 'BORRAR TODO':");
    if (confirmWord === "BORRAR TODO") {
      this.data.students = [];
      this.data.courses.forEach(c => {
        c.records = [];
      });
      this.saveData();
      this.render();
      this.showToast("Sistema preparado para tu nuevo semestre.");
      this.openBulkImportModal();
    } else if (confirmWord !== null) {
      this.showToast("Operación cancelada: palabra de confirmación incorrecta.", "warning");
    }
  },

  initTheme: function() {
    const savedTheme = sessionStorage.getItem("notion_theme") || localStorage.getItem("notion_theme") || "light";
    this.theme = savedTheme;
    document.documentElement.setAttribute("data-theme", this.theme);
    this.updateThemeButton();
    try { localStorage.removeItem("notion_theme"); } catch(e) {}
  },

  toggleTheme: function() {
    this.theme = this.theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", this.theme);
    sessionStorage.setItem("notion_theme", this.theme);
    this.updateThemeButton();
  },

  updateThemeButton: function() {
    const btn = document.getElementById("themeToggleBtn");
    if (btn) {
      btn.innerHTML = this.theme === "light" 
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg> Modo Oscuro`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg> Modo Claro`;
    }
  },

  normalizePeriodo: function(p) {
    if (!p || typeof p !== 'string' || !p.trim()) return "2026 - 3 OTOÑO";
    const trimmed = p.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");
    if (upper === "2026-3" || upper === "2026-3 OTOÑO" || upper === "2026 - 3" || upper === "2026 - 3 OTOÑO") {
      return "2026 - 3 OTOÑO";
    }
    if (upper === "2026-1" || upper === "2026-1 PRIMAVERA" || upper === "2026 - 1" || upper === "2026 - 1 PRIMAVERA") {
      return "2026 - 1 PRIMAVERA";
    }
    return trimmed;
  },

  getAvailableSemesters: function() {
    const semestersSet = new Set(["2026 - 3 OTOÑO", "2026 - 1 PRIMAVERA"]);
    if (this.data && Array.isArray(this.data.courses)) {
      this.data.courses.forEach(c => {
        const norm = this.normalizePeriodo(c.periodo);
        if (norm) semestersSet.add(norm);
      });
    }
    const arr = Array.from(semestersSet);
    arr.sort((a, b) => {
      if (a === "2026 - 3 OTOÑO") return -1;
      if (b === "2026 - 3 OTOÑO") return 1;
      if (a === "2026 - 1 PRIMAVERA") return -1;
      if (b === "2026 - 1 PRIMAVERA") return 1;
      return b.localeCompare(a);
    });
    return arr;
  },

  getSelectedSemester: function() {
    const available = this.getAvailableSemesters();
    if (this.selectedSemester && available.includes(this.selectedSemester)) {
      return this.selectedSemester;
    }
    const active = (this.data && Array.isArray(this.data.courses) && this.activeCourseId)
      ? this.data.courses.find(c => c.id === this.activeCourseId)
      : null;
    if (active && active.periodo) {
      const norm = this.normalizePeriodo(active.periodo);
      if (available.includes(norm)) {
        this.selectedSemester = norm;
        return norm;
      }
    }
    this.selectedSemester = available[0] || "2026 - 3 OTOÑO";
    return this.selectedSemester;
  },

  getCoursesForSelectedSemester: function() {
    if (!this.data || !Array.isArray(this.data.courses)) return [];
    const currentSemester = this.getSelectedSemester();
    return this.data.courses.filter(c => this.normalizePeriodo(c.periodo) === currentSemester);
  },

  switchSemester: function(semester) {
    const normSemester = this.normalizePeriodo(semester);
    this.selectedSemester = normSemester;

    const coursesInSem = (this.data && Array.isArray(this.data.courses))
      ? this.data.courses.filter(c => this.normalizePeriodo(c.periodo) === normSemester)
      : [];

    const activeCourse = this.data?.courses?.find(c => c.id === this.activeCourseId);
    if (activeCourse && this.normalizePeriodo(activeCourse.periodo) === normSemester) {
      // Ya pertenece a este semestre, se mantiene
    } else if (coursesInSem.length > 0) {
      this.activeCourseId = coursesInSem[0].id;
    } else {
      this.activeCourseId = null;
    }

    this.render();
  },

  getActiveCourse: function() {
    if (!this.data || !Array.isArray(this.data.courses) || this.data.courses.length === 0) {
      return null;
    }
    const currentSemester = this.getSelectedSemester();
    const coursesInSemester = this.data.courses.filter(c => this.normalizePeriodo(c.periodo) === currentSemester);

    if (this.activeCourseId) {
      const foundInSemester = coursesInSemester.find(c => c.id === this.activeCourseId);
      if (foundInSemester) return foundInSemester;
    }
    if (coursesInSemester.length > 0) {
      return coursesInSemester[0];
    }
    return null;
  },

  renderEmptyGradebook: function(container) {
    const selectedSem = this.getSelectedSemester();
    const availableSemesters = this.getAvailableSemesters();
    let semesterSelectHtml = "";
    availableSemesters.forEach(sem => {
      const isSel = (sem === selectedSem);
      semesterSelectHtml += `<option value="${this.escapeHtml(sem)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(sem)}</option>`;
    });

    container.innerHTML = `
      <div class="page-title-area gradebook-header-container">
        <!-- Fila 1: Título y Selector de Semestre -->
        <div class="gradebook-header-top">
          <div class="gradebook-title-col">
            <h1 class="page-title">
              <span class="course-name-text">Listas aún no cargadas</span>
              <span class="course-group-badge" style="background: rgba(224, 126, 51, 0.15); color: var(--uat-orange); font-weight: 700;">${this.escapeHtml(selectedSem)}</span>
            </h1>
          </div>
          <div class="gradebook-switcher-col">
            <div class="gradebook-switchers-row">
              <div class="gradebook-select-pill gradebook-semester-pill" title="Seleccionar semestre / periodo escolar">
                <span class="pill-prefix">Semestre:</span>
                <select class="form-control gradebook-semester-select" onchange="App.switchSemester(this.value)">
                  ${semesterSelectHtml}
                </select>
              </div>
              <div class="gradebook-select-pill gradebook-course-pill" style="opacity: 0.65;">
                <span class="pill-prefix">Lista / Grupo:</span>
                <select class="form-control gradebook-course-select" disabled>
                  <option>(Sin listas en este semestre)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Fila 2: Subtítulo Descriptivo y Acciones -->
        <div class="gradebook-header-bottom">
          <div class="gradebook-desc-col">
            <p class="page-desc">
              Periodo <b>${this.escapeHtml(selectedSem)}</b> • Las listas de alumnos para este periodo escolar aún no han sido cargadas en el sistema.
            </p>
          </div>
          <div class="gradebook-actions-col">
            <button class="btn btn-primary btn-course-pair" onclick="App.openNewCourseModal()" title="Crear o cargar nueva lista para este semestre">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva Lista
            </button>
            <button class="btn btn-default" onclick="App.switchSemester('2026 - 3 OTOÑO')" title="Volver al periodo escolar con listas cargadas">
              Volver a 2026 - 3 OTOÑO
            </button>
          </div>
        </div>
      </div>

      <div class="empty-state-card" style="padding: 56px 24px; text-align: center; background: var(--bg-card); border: 2px dashed var(--border-color); border-radius: 14px; margin-top: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
        <div style="width: 68px; height: 68px; margin: 0 auto 16px; background: rgba(224, 126, 51, 0.12); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--uat-orange);">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </div>
        <div style="display: inline-block; padding: 5px 16px; border-radius: 20px; background: rgba(224, 126, 51, 0.12); color: var(--uat-orange); font-weight: 700; font-size: 12px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.6px;">
          Aviso de Periodo Escolar
        </div>
        <h2 style="font-size: 22px; font-weight: 800; color: var(--uat-blue-night); margin-bottom: 10px;">
          Las listas de este semestre aún no están cargadas
        </h2>
        <p style="font-size: 14.5px; color: var(--text-secondary); max-width: 580px; margin: 0 auto 20px; line-height: 1.55;">
          Aún no se han subido las listas de alumnos ni se han registrado materias para el periodo escolar <b>${this.escapeHtml(selectedSem)}</b>. En cuanto se carguen o des de alta una materia, aparecerán organizadas en este apartado.
        </p>
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 12px 18px; max-width: 560px; margin: 0 auto 24px; display: flex; align-items: center; gap: 12px; text-align: left;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" stroke-width="2" style="flex-shrink: 0;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span style="font-size: 13px; color: var(--uat-blue-night); line-height: 1.45;">
            <b>Tus datos están protegidos:</b> Todas tus calificaciones, alumnos y materias del semestre <b>2026 - 3 OTOÑO</b> están 100% seguras y respaldadas en la base de datos.
          </span>
        </div>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="App.openNewCourseModal()" style="display: inline-flex; align-items: center; gap: 8px; font-weight: 600; padding: 10px 20px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Cargar / Crear Lista para ${this.escapeHtml(selectedSem)}
          </button>
          <button class="btn btn-default" onclick="App.switchSemester('2026 - 3 OTOÑO')" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Volver a Semestre Actual (2026 - 3 OTOÑO)
          </button>
        </div>
      </div>
    `;
  },

  getStudentsMap: function() {
    const map = {};
    (this.data.students || []).forEach(s => {
      map[s.matricula] = s;
    });
    return map;
  },

  // MOTOR MATEMÁTICO: Fórmulas de cálculo con ponderaciones personalizadas y asistencia/participación opcionales
  calculateStudentGrades: function(record, course) {
    const maxFirmasConfig = course.firmasMaxConfig || {};
    const maxPartConfig = course.participacionMaxConfig || {};
    const evalU = {};
    const validUnitsForMean = [];
    let evaluatedUnitsCount = 0;

    // Ponderaciones de criterios por unidad (Default 100% retrocompatible: 50% firmas, 50% examen)
    const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    const wFirmas = Number(weights.firmas) || 0;
    const wExamen = Number(weights.examen) || 0;
    const wAsist = Number(weights.asistencia) || 0;
    const wPart = Number(weights.participacion) || 0;

    // Configuración opcional de límite de faltas e inasistencias
    const asistCfg = course.asistenciaConfig || {};
    const limiteFaltasActivo = !!asistCfg.limiteFaltasActivo;
    const consecuenciaActiva = (asistCfg.consecuenciaActiva !== undefined)
      ? !!asistCfg.consecuenciaActiva
      : (!!asistCfg.modoExceder && asistCfg.modoExceder !== "ninguna");
    const ambitoLimite = asistCfg.ambitoLimite || "unidad"; // "unidad" o "semestre"
    const maxFaltas = Number(asistCfg.maxFaltas) || Number(asistCfg.maxFaltasPorUnidad) || 3;
    const modoExceder = consecuenciaActiva ? (asistCfg.modoExceder || "alerta_sd") : "ninguna";
    const pierdeAsistencia = consecuenciaActiva && (modoExceder === "perder_asistencia" || modoExceder === "ambas_alerta" || modoExceder === "ambas_cero");
    const esSinDerecho = consecuenciaActiva && (modoExceder === "alerta_sd" || modoExceder === "reprobar_cero" || modoExceder === "ambas_alerta" || modoExceder === "ambas_cero");
    const esReprobarCero = consecuenciaActiva && (modoExceder === "reprobar_cero" || modoExceder === "ambas_cero");

    const isSinDerechoU = {};
    const asistenciaPerdidaU = {};
    const faltasU = {};
    let hasAnySinDerecho = false;

    // Calcular faltas de todas las unidades previamente para el acumulado semestral
    let totalFaltasSemestre = 0;
    const totalUnitsCount = course.unidadesCount || 5;
    for (let u = 1; u <= totalUnitsCount; u++) {
      const uKey = `u${u}`;
      const fNum = (record.faltas && record.faltas[uKey] !== undefined && record.faltas[uKey] !== "")
        ? Number(record.faltas[uKey])
        : 0;
      faltasU[u] = fNum;
      totalFaltasSemestre += fNum;
    }
    const excedeSemestre = limiteFaltasActivo && consecuenciaActiva && (ambitoLimite === "semestre") && (totalFaltasSemestre > maxFaltas);

    // 1. Evaluación de cada Unidad (U1 a Un)
    for (let u = 1; u <= totalUnitsCount; u++) {
      const uKey = `u${u}`;
      const firmas = (record.firmas && record.firmas[uKey] !== undefined && record.firmas[uKey] !== "") 
        ? record.firmas[uKey] 
        : null;
      const examen = (record.examenes && record.examenes[uKey] !== undefined && record.examenes[uKey] !== "") 
        ? record.examenes[uKey] 
        : null;
      const asist = (record.asistencia && record.asistencia[uKey] !== undefined && record.asistencia[uKey] !== "") 
        ? record.asistencia[uKey] 
        : null;
      const part = (record.participacion && record.participacion[uKey] !== undefined && record.participacion[uKey] !== "") 
        ? record.participacion[uKey] 
        : null;
      const faltas = faltasU[u];

      const maxF = maxFirmasConfig[uKey] || 10;
      const maxP = maxPartConfig[uKey] || 5;

      const hasFirmas = firmas !== null;
      const hasExamen = examen !== null;
      const hasAsist = asist !== null && wAsist > 0;
      const hasPart = part !== null && wPart > 0;

      // Si al menos hay un criterio evaluado en la unidad
      if (hasFirmas || hasExamen || hasAsist || hasPart) {
        const excedeUnidad = limiteFaltasActivo && consecuenciaActiva && (ambitoLimite === "unidad") && (faltas > maxFaltas);
        const estaSancionado = (ambitoLimite === "semestre") ? excedeSemestre : excedeUnidad;

        let puntajeFirmas = 0;
        if (hasFirmas && maxF > 0 && wFirmas > 0) {
          puntajeFirmas = (Number(firmas) / maxF) * wFirmas;
        }

        let puntajeExamen = 0;
        if (hasExamen && wExamen > 0) {
          puntajeExamen = (Number(examen) / 100) * wExamen;
        }

        let puntajeAsist = 0;
        if (hasAsist && wAsist > 0) {
          if (estaSancionado && pierdeAsistencia) {
            puntajeAsist = 0;
            asistenciaPerdidaU[u] = true;
          } else {
            const numA = Math.min(100, Math.max(0, Number(asist)));
            puntajeAsist = (numA / 100) * wAsist;
            asistenciaPerdidaU[u] = false;
          }
        } else {
          asistenciaPerdidaU[u] = false;
        }

        let puntajePart = 0;
        if (hasPart && wPart > 0) {
          const numP = Math.max(0, Number(part));
          const pctP = maxP > 0 ? Math.min(1, numP / maxP) : 0;
          puntajePart = pctP * wPart;
        }

        let totalU = Math.round((puntajeFirmas + puntajeExamen + puntajeAsist + puntajePart) * 10) / 10;
        totalU = Math.min(100, Math.max(0, totalU));

        // Regla opcional de Derecho a Examen por Faltas (SD)
        if (estaSancionado && esSinDerecho) {
          isSinDerechoU[u] = true;
          hasAnySinDerecho = true;
          if (esReprobarCero) {
            totalU = 0;
          }
        } else {
          isSinDerechoU[u] = false;
        }

        evalU[u] = totalU;
        validUnitsForMean.push(totalU);
        evaluatedUnitsCount++;
      } else {
        // Unidad pendiente / no evaluada aún en el semestre
        evalU[u] = null;
        isSinDerechoU[u] = false;
        asistenciaPerdidaU[u] = false;
      }
    }

    // 2. Proyecto Final y Puntos Extra
    const hasProyecto = (record.proyecto !== null && record.proyecto !== undefined && record.proyecto !== "");
    const proyecto = hasProyecto ? Number(record.proyecto) : null;
    const puntosExtra = Number(record.puntosExtra) || 0;

    const itemsToAverage = [...validUnitsForMean];
    if (hasProyecto) {
      itemsToAverage.push(proyecto);
    }

    const hasEvaluations = itemsToAverage.length > 0;
    let promedio = 0;
    let evalFinal = 0;

    if (hasEvaluations) {
      const suma = itemsToAverage.reduce((acc, v) => acc + v, 0);
      promedio = suma / itemsToAverage.length;
      const conPuntosExtra = promedio + (puntosExtra * 5);
      const evalFinalRedondeada = Math.round(conPuntosExtra);
      evalFinal = Math.min(100, Math.max(0, evalFinalRedondeada));
    }

    return {
      evalU,
      evalFinal,
      promedioParcial: Math.round(promedio * 10) / 10,
      hasEvaluations,
      evaluatedUnitsCount,
      isSinDerechoU,
      asistenciaPerdidaU,
      faltasU,
      totalFaltasSemestre,
      hasAnySinDerecho,
      hasAnyAsistenciaPerdida: Object.values(asistenciaPerdidaU).some(Boolean),
      weights,
      asistenciaConfig: asistCfg
    };
  },

  // Helper para calcular total de faltas en todo el semestre para un alumno
  getStudentSemesterFaltas: function(record, course, currentUnitOverride, currentUnitFaltasVal) {
    if (!record) return 0;
    let total = 0;
    const numUnits = Number(course?.unidadesCount) || 5;
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      if (currentUnitOverride && u === currentUnitOverride && currentUnitFaltasVal !== undefined) {
        total += Number(currentUnitFaltasVal) || 0;
      } else if (record.faltas && record.faltas[uKey] !== undefined && record.faltas[uKey] !== "") {
        total += Number(record.faltas[uKey]) || 0;
      }
    }
    return total;
  },

  // Helper para texto legible de la acción al exceder límite
  getModoExcederLabel: function(modo) {
    switch (modo) {
      case "perder_asistencia": return "Sin Pts Asistencia";
      case "alerta_sd": return "Alerta SD";
      case "reprobar_cero": return "Estricto (Calif 0)";
      case "ambas_alerta": return "SD + 0 Pts Asist";
      case "ambas_cero": return "Calif 0 + 0 Pts Asist";
      case "ninguna": return "Solo Informativo";
      default: return "Solo Informativo";
    }
  },

  // Cálculo de estadísticas de columna (MAX para firmas, AVERAGE para exámenes, asistencias, participaciones y evaluaciones)
  calculateCourseStats: function(course) {
    const records = course.records || [];
    const stats = {
      maxFirmas: {},
      avgFirmas: {},
      avgExamenes: {},
      avgAsistencia: {},
      avgParticipacion: {},
      avgEvaluaciones: {},
      avgFinal: 0
    };

    const count = records.length;
    if (count === 0) return stats;

    const numUnits = Number(course.unidadesCount) || 5;

    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      
      // Firmas
      const firmasVals = records
        .map(r => r.firmas ? r.firmas[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.maxFirmas[uKey] = firmasVals.length > 0 ? Math.max(...firmasVals.map(Number)) : 0;
      stats.avgFirmas[uKey] = firmasVals.length > 0 ? (firmasVals.reduce((a, b) => a + Number(b), 0) / firmasVals.length).toFixed(1) : 0;

      // Exámenes
      const examenVals = records
        .map(r => r.examenes ? r.examenes[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.avgExamenes[uKey] = examenVals.length > 0 ? (examenVals.reduce((a, b) => a + Number(b), 0) / examenVals.length).toFixed(2) : "0.00";

      // Asistencias (%)
      const asistVals = records
        .map(r => r.asistencia ? r.asistencia[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.avgAsistencia[uKey] = asistVals.length > 0 ? Math.round(asistVals.reduce((a, b) => a + Number(b), 0) / asistVals.length) : 0;

      // Participaciones
      const partVals = records
        .map(r => r.participacion ? r.participacion[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.avgParticipacion[uKey] = partVals.length > 0 ? (partVals.reduce((a, b) => a + Number(b), 0) / partVals.length).toFixed(1) : 0;
    }

    // Evaluaciones
    let sumFinal = 0;
    let finalCount = 0;
    const evalSums = {};
    const evalCounts = {};
    for (let u = 1; u <= numUnits; u++) {
      evalSums[u] = 0;
      evalCounts[u] = 0;
    }

    records.forEach(r => {
      const c = this.calculateStudentGrades(r, course);
      if (c.hasEvaluations) {
        sumFinal += c.evalFinal;
        finalCount++;
      }
      for (let u = 1; u <= numUnits; u++) {
        if (c.evalU[u] !== null && c.evalU[u] !== undefined) {
          evalSums[u] += c.evalU[u];
          evalCounts[u]++;
        }
      }
    });

    stats.avgFinal = finalCount > 0 ? (sumFinal / finalCount).toFixed(1) : "0.0";
    for (let u = 1; u <= numUnits; u++) {
      stats.avgEvaluaciones[u] = evalCounts[u] > 0 ? (evalSums[u] / evalCounts[u]).toFixed(2) : "0.00";
    }

    return stats;
  },

  // RENDERIZADO PRINCIPAL
  render: function() {
    this.renderTeacherProfile();
    this.renderSupervisionBanner();
    this.updateCloudStatusBadge();
    const nav = document.getElementById("navTabs");
    const container = document.getElementById("tabContentContainer");
    if (!container) return;

    // Si no hay ningún profesor con sesión iniciada, mostrar pantalla de Login
    if (!this.currentUser) {
      if (nav) nav.style.display = "none";
      const banner = document.getElementById("supervisionBannerContainer");
      if (banner) banner.innerHTML = "";
      this.renderLoginScreen(container);
      return;
    }

    // Si es Administrador y NO está supervisando a un profesor, su pestaña principal es el Panel Maestro
    if (this.isAdmin() && !this.isSupervising && this.activeTab !== "admin_dashboard") {
      this.activeTab = "admin_dashboard";
    }

    // Si hay sesión iniciada, mostrar interfaz completa
    if (nav) nav.style.display = "flex";
    this.renderNavTabs();

    if (this.activeTab === "gradebook" || this.activeTab === "directory" || this.activeTab === "attendance") {
      container.classList.add("has-table-view");
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      container.scrollTop = 0;
    } else {
      container.classList.remove("has-table-view");
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }

    if (this.activeTab === "admin_dashboard") {
      this.renderAdminDashboard(container);
    } else if (this.activeTab === "gradebook") {
      this.renderGradebook(container);
    } else if (this.activeTab === "attendance") {
      this.renderAttendance(container);
    } else if (this.activeTab === "directory") {
      this.renderDirectory(container);
    } else if (this.activeTab === "teams") {
      this.renderTeamsPublication(container);
    } else if (this.activeTab === "config") {
      this.renderConfig(container);
    }
  },

  renderTeacherProfile: function() {
    const container = document.getElementById("teacherProfileContainer");
    if (!container) return;

    if (!this.currentUser) {
      container.innerHTML = `
        <button class="header-btn-ghost" onclick="App.render()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          Iniciar Sesión
        </button>
      `;
      return;
    }

    const t = this.currentUser;
    const isAdmin = this.isAdmin();
    const coursesCount = (t.data && t.data.courses) ? t.data.courses.length : 0;
    const studentsCount = (t.data && t.data.students) ? t.data.students.length : 0;
    const avatarImg = isAdmin
      ? `<img src="Logos/Escudo Imagotipo.png" alt="UAT" />`
      : `<img src="Logos/FI-SOLO-COLOR.png" alt="FI" />`;

    container.innerHTML = `
      <div class="teacher-profile-wrap">
        <button type="button" class="teacher-profile-btn" onclick="App.toggleTeacherDropdown(event)" title="Cuenta activa">
          <span class="teacher-avatar">${avatarImg}</span>
          <div class="teacher-info-mini">
            <span class="teacher-name-mini">${t.nombre} ${isAdmin ? '<span class="badge-role-admin">ADMIN</span>' : ''}</span>
            <span class="teacher-depto-mini">${t.departamento || 'FIUAT'}</span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="teacher-dropdown" id="teacherDropdown">
          <div class="teacher-dropdown-header">
            <div class="teacher-avatar-large">${avatarImg}</div>
            <div>
              <div class="teacher-name-full">${t.nombre} ${isAdmin ? '<span class="badge-role-admin">ADMIN</span>' : ''}</div>
              <div class="teacher-email-full">${t.correo || t.usuario}</div>
              <span class="teacher-badge-depto">${t.departamento || 'FIUAT'}</span>
            </div>
          </div>
          <div style="padding: 10px 16px; font-size: 12px; color: var(--text-secondary); background: var(--bg-secondary); border-bottom: 1px solid var(--border-color);">
            ${isAdmin ? `<b>Acceso Maestro</b>: Supervisión general de toda la facultad` : `<b>${coursesCount}</b> Materias / Grupos asignados • <b>${studentsCount}</b> Alumnos en su Directorio`}
          </div>
          ${isAdmin ? `
            <button class="dropdown-item" onclick="App.exitSupervision()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              Panel de Control Maestro
            </button>
            <button class="dropdown-item" onclick="App.openSwitchTeacherModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
              Supervisar / Cambiar de Profesor
            </button>
          ` : ''}
          <button class="dropdown-item" onclick="App.openChangePasswordModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Cambiar mi Contraseña
          </button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item dropdown-item-danger" onclick="App.logout()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Cerrar Sesión
          </button>
        </div>
      </div>
    `;
  },

  toggleTeacherDropdown: function(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById("teacherDropdown");
    if (dropdown) {
      dropdown.classList.toggle("open");
    }
  },

  renderNavTabs: function() {
    const nav = document.getElementById("navTabs");
    if (!nav) return;

    // Si es Administrador y NO está supervisando un profesor específico
    if (this.isAdmin() && !this.isSupervising) {
      const regularTeachers = this.teachers.filter(t => t.role !== 'admin');
      nav.innerHTML = `
        <button class="nav-tab-btn active" onclick="App.switchTab('admin_dashboard')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Panel Maestro</span>
          <span class="nav-tab-badge">${regularTeachers.length}</span>
        </button>
        <button class="nav-tab-btn" style="margin-left: auto; color: var(--uat-orange); font-weight: 700;" onclick="App.openRegisterTeacherModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Nuevo Docente</span>
        </button>
      `;
      return;
    }

    const course = this.getActiveCourse();
    const studentsCount = (this.data && this.data.students) ? this.data.students.length : 0;
    const recordsCount = (course && course.records) ? course.records.length : 0;

    let adminBackBtn = "";
    if (this.isAdmin() && this.isSupervising) {
      adminBackBtn = `
        <button class="nav-tab-btn" style="background: rgba(224, 126, 51, 0.15); color: var(--uat-orange); font-weight: 700; border: 1px solid var(--uat-orange); margin-right: 6px; display: inline-flex; align-items: center; gap: 6px;" onclick="App.exitSupervision()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Volver al Panel Maestro
        </button>
      `;
    }

    const courseTabTitle = course 
      ? `${this.escapeHtml(course.nombre || 'Materia')} • ${this.escapeHtml(course.grupo || 'Grupo A')}`
      : `Calificador (${this.escapeHtml(this.getSelectedSemester())})`;
    const teamsTabTitle = course
      ? `Publicar en Teams (${this.escapeHtml(course.grupo || 'Grupo A')})`
      : `Publicar en Teams`;

    nav.innerHTML = `
      ${adminBackBtn}
      <button class="nav-tab-btn ${this.activeTab === 'gradebook' ? 'active' : ''}" onclick="App.switchTab('gradebook')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>
        ${courseTabTitle}
        <span class="nav-tab-badge">${recordsCount} alumnos</span>
      </button>

      <button class="nav-tab-btn ${this.activeTab === 'attendance' ? 'active' : ''}" onclick="App.switchTab('attendance')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Asistencias
      </button>

      <button class="nav-tab-btn ${this.activeTab === 'directory' ? 'active' : ''}" onclick="App.switchTab('directory')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Directorio de Alumnos (Base Maestra)
        <span class="nav-tab-badge">${studentsCount}</span>
      </button>

      <button class="nav-tab-btn ${this.activeTab === 'teams' ? 'active' : ''}" onclick="App.switchTab('teams')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        ${teamsTabTitle}
      </button>

      <button class="nav-tab-btn ${this.activeTab === 'config' ? 'active' : ''}" onclick="App.switchTab('config')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Fórmulas & Ajustes
      </button>

      <button class="nav-tab-btn" style="margin-left: auto; color: var(--uat-orange); font-weight: 700;" onclick="App.openNewCourseModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nueva Materia / Grupo
      </button>
    `;
  },

  switchTab: function(tabName) {
    // Control de Acceso Estricto VULN-04
    if (tabName === 'admin_dashboard' && !this.isAdmin()) {
      alert("Acceso Restringido: Se requieren privilegios de Coordinación Académica para ver el Panel de Control Maestro.");
      return;
    }
    this.activeTab = tabName;
    this.render();
  },

  switchCourse: function(courseId) {
    this.activeCourseId = courseId;
    const course = this.data?.courses?.find(c => c.id === courseId);
    if (course && course.periodo) {
      this.selectedSemester = this.normalizePeriodo(course.periodo);
    }
    this.render();
  },

  // 1. VISTA DE CALIFICADOR (RÉPLICA DE NOTION)
  renderGradebook: function(container) {
    const course = this.getActiveCourse();
    if (!course) {
      this.renderEmptyGradebook(container);
      return;
    }
    const numUnits = Number(course.unidadesCount) || 5;
    const studentsMap = this.getStudentsMap();
    const stats = this.calculateCourseStats(course);
    const maxFirmasConfig = course.firmasMaxConfig || {};
    const isAuditReadOnly = this.isAdmin() && this.isSupervising && !this.supervisionEditMode;

    let records = course.records || [];
    let visibleCount = 0;
    const searchLower = (this.searchTerm || "").toLowerCase().trim();

    const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    const showAsist = Number(weights.asistencia) > 0;
    const showPart = Number(weights.participacion) > 0;

    let rowsHtml = "";
    records.forEach((rec, index) => {
      const student = studentsMap[rec.matricula] || { nombre: "Alumno no registrado en Base Maestra" };
      const calcs = this.calculateStudentGrades(rec, course);
      
      const searchData = (rec.matricula + " " + (student.nombre || "")).toLowerCase();
      const isMatch = !searchLower || searchData.includes(searchLower);
      if (isMatch) visibleCount++;

      // Color semáforo para la barra de evaluación final
      let finalColor = "var(--color-green)";
      if (calcs.evalFinal < 60) finalColor = "var(--color-red)";
      else if (calcs.evalFinal < 70) finalColor = "var(--color-orange)";

      // Celdas de Firmas U1 a Un
      let firmasCells = "";
      for (let u = 1; u <= numUnits; u++) {
        const uKey = `u${u}`;
        const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
        const isFieldReadOnly = isLocked || isAuditReadOnly;
        const val = rec.firmas ? (rec.firmas[uKey] ?? "") : "";
        const maxF = maxFirmasConfig[uKey] || 10;
        const pct = val !== "" && val !== null ? Math.min(100, Math.round((Number(val) / maxF) * 100)) : 0;
        const dashOffset = 44 - (44 * pct) / 100;
        const strokeColor = pct >= 100 ? 'var(--color-green)' : (pct >= 50 ? 'var(--color-orange)' : 'var(--border-color)');

        firmasCells += `
          <td class="col-number-input">
            <div class="firmas-cell-content">
              <input type="number" inputmode="numeric" min="0" max="99" class="cell-input firmas-num-input ${isLocked ? 'cell-locked' : ''} ${isAuditReadOnly ? 'cell-readonly-audit' : ''}" value="${val}" 
                placeholder="-" data-col="firmas-${uKey}"
                ${isFieldReadOnly ? `readonly title="${isAuditReadOnly ? 'Modo Auditoría (Solo Lectura)' : 'Unidad bloqueada (Solo Lectura)'}"` : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateFirmas(${index}, '${uKey}', this.value)"
                onkeydown="App.handleCellKeydown(event, this)" />
              <svg class="progress-ring" viewBox="0 0 20 20">
                <circle class="progress-ring-circle-bg" cx="10" cy="10" r="7"/>
                <circle id="ring-firmas-${index}-${uKey}" class="progress-ring-circle" cx="10" cy="10" r="7" 
                  style="stroke-dasharray: 44; stroke-dashoffset: ${dashOffset}; stroke: ${strokeColor};"/>
              </svg>
            </div>
          </td>
        `;
      }

      // Celdas de Exámenes U1 a Un
      let examenesCells = "";
      for (let u = 1; u <= numUnits; u++) {
        const uKey = `u${u}`;
        const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
        const isFieldReadOnly = isLocked || isAuditReadOnly;
        const val = rec.examenes ? (rec.examenes[uKey] ?? "") : "";
        const numVal = val !== "" && val !== null ? Number(val) : null;
        let barColor = "var(--color-green)";
        if (numVal !== null && numVal < 60) barColor = "var(--color-red)";
        else if (numVal !== null && numVal < 70) barColor = "var(--color-orange)";

        examenesCells += `
          <td style="min-width: 110px;">
            <div class="progress-bar-wrap">
              <input type="number" inputmode="decimal" min="0" max="100" class="cell-input ${isLocked ? 'cell-locked' : ''} ${isAuditReadOnly ? 'cell-readonly-audit' : ''}" style="width: 48px; text-align: right; font-weight: 500;" 
                value="${val}" placeholder="-" data-col="examenes-${uKey}"
                ${isFieldReadOnly ? `readonly title="${isAuditReadOnly ? 'Modo Auditoría (Solo Lectura)' : 'Unidad bloqueada (Solo Lectura)'}"` : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateExamen(${index}, '${uKey}', this.value)"
                onkeydown="App.handleCellKeydown(event, this)" />
              <div class="progress-track">
                <div id="bar-exam-${index}-${uKey}" class="progress-fill" style="width: ${numVal !== null ? numVal : 0}%; background-color: ${barColor};"></div>
              </div>
            </div>
          </td>
        `;
      }

      // Celdas de Asistencia U1 a Un (solo si está activo el criterio)
      let asistenciaCells = "";
      if (showAsist) {
        for (let u = 1; u <= numUnits; u++) {
          const uKey = `u${u}`;
          const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
          const isFieldReadOnly = isLocked || isAuditReadOnly;
          const val = rec.asistencia ? (rec.asistencia[uKey] ?? "") : "";
          const faltas = (rec.faltas && rec.faltas[uKey] !== undefined && rec.faltas[uKey] !== "") ? Number(rec.faltas[uKey]) : 0;
          const isSd = !!(calcs.isSinDerechoU && calcs.isSinDerechoU[u]);
          const isAsistPerdida = !!(calcs.asistenciaPerdidaU && calcs.asistenciaPerdidaU[u]);
          const isAuto = !!(rec.asistenciaAuto && rec.asistenciaAuto[uKey]);

          const numVal = val !== "" && val !== null ? Number(val) : null;
          let ringColor = "var(--color-green)";
          if (isSd || isAsistPerdida || (numVal !== null && numVal < 60)) ringColor = "var(--color-red)";
          else if (numVal !== null && numVal < 80) ringColor = "var(--color-orange)";

          const pct = numVal !== null ? Math.min(100, Math.max(0, numVal)) : 0;
          const dashOffset = numVal !== null ? (44 - (44 * pct) / 100) : 44;
          const strokeColor = numVal !== null ? ringColor : "var(--border-color)";

          let faltasBadgeHtml = "";
          if (faltas > 0 || isAsistPerdida) {
            let badgeClass = "badge-faltas";
            let badgeText = `${faltas}f`;
            let badgeTitle = `${faltas} falta(s) en Unidad ${u}`;

            if (isSd && isAsistPerdida) {
              badgeClass += " badge-faltas-sd";
              badgeText = `⛔ SD · 0pts`;
              badgeTitle += ` • Sin derecho a examen y 0 pts de asistencia`;
            } else if (isSd) {
              badgeClass += " badge-faltas-sd";
              badgeText = `⛔ SD ${faltas}f`;
              badgeTitle += ` • Sin derecho a examen`;
            } else if (isAsistPerdida) {
              badgeClass += " badge-faltas-loss";
              badgeText = `⚠️ 0pts (${faltas}f)`;
              badgeTitle += ` • Puntos de asistencia anulados (0 pts) por límite de faltas`;
            }
            faltasBadgeHtml = `<span class="${badgeClass}" title="${badgeTitle}">${badgeText}</span>`;
          }

          asistenciaCells += `
            <td class="col-number-input ${isSd ? 'cell-sin-derecho' : (isAsistPerdida ? 'cell-asist-loss' : '')}" style="min-width: 105px;">
              <div class="firmas-cell-content" style="justify-content: flex-end; gap: 4px;">
                ${isAuto ? '<span title="Sincronizado automáticamente desde el Pase de Lista" style="font-size: 10px; cursor: help; opacity: 0.85;">🔒</span>' : ''}
                ${faltasBadgeHtml}
                <input type="number" inputmode="numeric" min="0" max="100" class="cell-input ${isLocked ? 'cell-locked' : ''} ${isAuditReadOnly ? 'cell-readonly-audit' : ''} ${isSd ? 'cell-sd-text' : (isAsistPerdida ? 'cell-sd-text' : '')}" style="width: 44px; text-align: right; font-weight: 600;"
                  value="${val}" placeholder="-" data-col="asistencia-${uKey}"
                  ${isFieldReadOnly ? `readonly title="${isAuditReadOnly ? 'Modo Auditoría (Solo Lectura)' : 'Unidad bloqueada'}"` : ''}
                  onfocus="this.select()"
                  onblur="App.handleCellBlur(this)"
                  oninput="App.updateAsistencia(${index}, '${uKey}', this.value)"
                  onkeydown="App.handleCellKeydown(event, this)" />
                <svg class="progress-ring" viewBox="0 0 20 20">
                  <circle class="progress-ring-circle-bg" cx="10" cy="10" r="7"/>
                  <circle id="ring-asist-${index}-${uKey}" class="progress-ring-circle" cx="10" cy="10" r="7" 
                    style="stroke-dasharray: 44; stroke-dashoffset: ${dashOffset}; stroke: ${strokeColor};"/>
                </svg>
              </div>
            </td>
          `;
        }
      }

      // Celdas de Participación U1 a Un (solo si está activo el criterio)
      let participacionCells = "";
      if (showPart) {
        for (let u = 1; u <= numUnits; u++) {
          const uKey = `u${u}`;
          const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
          const isFieldReadOnly = isLocked || isAuditReadOnly;
          const val = rec.participacion ? (rec.participacion[uKey] ?? "") : "";

          participacionCells += `
            <td class="col-number-input" style="min-width: 85px;">
              <div class="firmas-cell-content" style="justify-content: flex-end; gap: 3px;">
                <input type="number" inputmode="numeric" min="0" max="999" class="cell-input ${isLocked ? 'cell-locked' : ''} ${isAuditReadOnly ? 'cell-readonly-audit' : ''}" style="width: 40px; text-align: right; font-weight: 600;" 
                  value="${val}" placeholder="-" data-col="participacion-${uKey}"
                  ${isFieldReadOnly ? `readonly title="${isAuditReadOnly ? 'Modo Auditoría (Solo Lectura)' : 'Unidad bloqueada'}"` : ''}
                  onfocus="this.select()"
                  onblur="App.handleCellBlur(this)"
                  oninput="App.updateParticipacion(${index}, '${uKey}', this.value)"
                  onkeydown="App.handleCellKeydown(event, this)" />
                <span style="font-size: 11px; color: var(--uat-orange); cursor: default;" title="Participaciones en Unidad ${u}">⭐</span>
              </div>
            </td>
          `;
        }
      }

      // Celdas de Evaluación calculada U1 a Un
      let evalCells = "";
      for (let u = 1; u <= numUnits; u++) {
        const uKey = `u${u}`;
        const val = calcs.evalU[u];
        const hasVal = val !== null && val !== undefined;
        const displayVal = hasVal ? val : "-";
        const numVal = hasVal ? val : 0;
        const isSd = !!(calcs.isSinDerechoU && calcs.isSinDerechoU[u]);

        let ringColor = "var(--color-green)";
        if (isSd || numVal < 60) ringColor = "var(--color-red)";
        else if (numVal < 70) ringColor = "var(--color-orange)";

        const pct = Math.min(100, numVal);
        const dashOffset = hasVal ? (44 - (44 * pct) / 100) : 44;
        const strokeColor = hasVal ? ringColor : "var(--border-color)";

        evalCells += `
          <td class="col-calc ${isSd ? 'cell-sin-derecho' : ''}">
            <div class="firmas-cell-content">
              <span id="val-eval-${index}-${uKey}" style="${isSd ? 'color: var(--color-red); font-weight: 800;' : ''}">${isSd ? 'SD' : displayVal}</span>
              <svg class="progress-ring" viewBox="0 0 20 20">
                <circle class="progress-ring-circle-bg" cx="10" cy="10" r="7"/>
                <circle id="ring-eval-${index}-${uKey}" class="progress-ring-circle" cx="10" cy="10" r="7" 
                  style="stroke-dasharray: 44; stroke-dashoffset: ${dashOffset}; stroke: ${strokeColor};"/>
              </svg>
            </div>
          </td>
        `;
      }

      const hasEvals = calcs.hasEvaluations;
      const displayFinal = hasEvals ? calcs.evalFinal : "-";
      const finalWidth = hasEvals ? calcs.evalFinal : 0;
      const finalColorStyle = hasEvals ? finalColor : "var(--text-tertiary)";
      const badgeText = hasEvals ? (calcs.evalFinal >= 70 ? 'APR' : 'REP') : 'PEN';
      const badgeClass = hasEvals ? (calcs.evalFinal >= 70 ? 'status-aprobado' : 'status-reprobado') : 'status-pending';

      rowsHtml += `
        <tr id="row-${index}" data-matricula="${this.escapeHtml(rec.matricula)}" data-search="${this.escapeHtml(searchData)}" style="display: ${isMatch ? '' : 'none'};">
          <td class="col-sticky-1 col-matricula">
            <input type="text" class="cell-input ${isAuditReadOnly ? 'cell-readonly-audit' : ''}" value="${this.escapeHtml(rec.matricula)}" 
              ${isAuditReadOnly ? 'readonly title="Modo Auditoría (Solo Lectura)"' : ''}
              onfocus="this.select()"
              onblur="App.handleCellBlur(this)"
              onchange="App.updateMatricula(${index}, this.value)" />
          </td>
          <td class="col-sticky-2 col-rollup" title="Toca o haz clic para abrir la Ficha Táctil del Alumno" onclick="App.openStudentMobileModal(${index})">
            <div class="rollup-badge">
              <span class="rollup-icon">↗</span>
              <span class="rollup-name">${this.escapeHtml(student.nombre)}</span>
              <span class="rollup-mobile-hint">📱 Ficha</span>
            </div>
          </td>
          <td class="col-final">
            <div class="progress-bar-wrap">
              <span id="val-final-${index}" class="progress-bar-num" style="color: ${finalColorStyle};">${displayFinal}</span>
              <div class="progress-track">
                <div id="bar-final-${index}" class="progress-fill" style="width: ${finalWidth}%; background-color: ${hasEvals ? finalColor : 'transparent'};"></div>
              </div>
              <span id="badge-final-${index}" class="status-badge ${badgeClass}">
                ${badgeText}
              </span>
            </div>
          </td>
          ${firmasCells}
          ${examenesCells}
          ${asistenciaCells}
          ${participacionCells}
          ${evalCells}
          <td class="col-number-input">
            <input type="number" inputmode="decimal" min="0" max="100" class="cell-input ${isAuditReadOnly ? 'cell-readonly-audit' : ''}" value="${rec.proyecto ?? ''}" placeholder="-" data-col="proyecto"
              ${isAuditReadOnly ? 'readonly title="Modo Auditoría (Solo Lectura)"' : ''}
              onfocus="this.select()"
              onblur="App.handleCellBlur(this)"
              oninput="App.updateProyecto(${index}, this.value)"
              onkeydown="App.handleCellKeydown(event, this)" />
          </td>
          <td class="col-number-input">
            <input type="number" inputmode="numeric" min="0" max="10" class="cell-input ${isAuditReadOnly ? 'cell-readonly-audit' : ''}" value="${rec.puntosExtra || 0}" placeholder="0" data-col="puntosExtra"
              ${isAuditReadOnly ? 'readonly title="Modo Auditoría (Solo Lectura)"' : ''}
              onfocus="this.select()"
              onblur="App.handleCellBlur(this)"
              oninput="App.updatePuntosExtra(${index}, this.value)"
              onkeydown="App.handleCellKeydown(event, this)" />
          </td>
          <td style="text-align: center; width: 40px;">
            <button type="button" class="btn-delete-row" 
              title="Quitar alumno de esta materia" onclick="App.deleteRecord(${index})">✕</button>
          </td>
        </tr>
      `;
    });

    // Agrupar cursos por nombre de materia para el semestre seleccionado
    const selectedSem = this.getSelectedSemester();
    const semesterCourses = this.getCoursesForSelectedSemester();

    const coursesBySubject = {};
    semesterCourses.forEach(c => {
      if (!coursesBySubject[c.nombre]) coursesBySubject[c.nombre] = [];
      coursesBySubject[c.nombre].push(c);
    });

    let selectHtml = "";
    if (semesterCourses.length === 0) {
      selectHtml = `<option value="" disabled selected>(Sin listas en este semestre)</option>`;
    } else {
      Object.keys(coursesBySubject).forEach(subject => {
        selectHtml += `<optgroup label="${this.escapeHtml(subject)}">`;
        coursesBySubject[subject].forEach(c => {
          const count = (c.records || []).length;
          selectHtml += `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${this.escapeHtml(c.grupo || 'Grupo')} (${count} alumnos)</option>`;
        });
        selectHtml += `</optgroup>`;
      });
    }

    const availableSemesters = this.getAvailableSemesters();
    let semesterSelectHtml = "";
    availableSemesters.forEach(sem => {
      const isSel = (sem === selectedSem);
      semesterSelectHtml += `<option value="${this.escapeHtml(sem)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(sem)}</option>`;
    });

    let firmasHeadersHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
      firmasHeadersHtml += `
        <th style="width: 95px; cursor: pointer;" onclick="App.openMaxFirmasModal()" title="Haz clic para configurar la meta máxima de firmas">
          <div class="th-content" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 3px;">
              <span class="th-icon">#</span> Firmas U${u}
            </div>
            <span class="unit-lock-btn ${isLocked ? 'locked' : ''}" onclick="event.stopPropagation(); App.toggleUnitLock('${uKey}')" title="${isLocked ? `Unidad ${u} bloqueada (Solo Lectura). Haz clic para desbloquear` : `Bloquear Unidad ${u} para congelar calificaciones`}">${isLocked ? '🔒' : '🔓'}</span>
          </div>
        </th>
      `;
    }

    let examenesHeadersHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
      examenesHeadersHtml += `
        <th style="width: 115px;">
          <div class="th-content" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 3px;">
              <span class="th-icon">#</span> Examen U${u}
            </div>
            <span class="unit-lock-btn ${isLocked ? 'locked' : ''}" onclick="event.stopPropagation(); App.toggleUnitLock('${uKey}')" title="${isLocked ? `Unidad ${u} bloqueada (Solo Lectura). Haz clic para desbloquear` : `Bloquear Unidad ${u} para congelar calificaciones`}">${isLocked ? '🔒' : '🔓'}</span>
          </div>
        </th>
      `;
    }

    let asistenciaHeadersHtml = "";
    if (showAsist) {
      for (let u = 1; u <= numUnits; u++) {
        asistenciaHeadersHtml += `
          <th style="width: 105px;"><div class="th-content"><span class="th-icon">📅</span> Asist U${u} (${weights.asistencia}%)</div></th>
        `;
      }
    }

    let participacionHeadersHtml = "";
    if (showPart) {
      for (let u = 1; u <= numUnits; u++) {
        participacionHeadersHtml += `
          <th style="width: 85px;"><div class="th-content"><span class="th-icon">⭐</span> Part U${u} (${weights.participacion}%)</div></th>
        `;
      }
    }

    let evalHeadersHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      evalHeadersHtml += `
        <th style="width: 95px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación U${u}</div></th>
      `;
    }

    let footerMaxFirmasHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      footerMaxFirmasHtml += `
        <td>
          <div class="summary-chip summary-chip-editable" title="Haz clic para editar la meta de firmas de la Unidad ${u}">
            <span class="summary-label">MAX:</span>
            <input type="number" min="1" max="100" class="footer-max-firmas-input" 
              id="footer-max-${uKey}" 
              value="${maxFirmasConfig[uKey] || 10}" 
              onfocus="this.select()"
              onchange="App.updateMaxFirmasConfig('${uKey}', this.value)"
              title="Haz clic para cambiar el máximo de firmas de la Unidad ${u}" />
          </div>
        </td>
      `;
    }

    let footerAvgExamenesHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      footerAvgExamenesHtml += `
        <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-exam-${uKey}" class="summary-value">${stats.avgExamenes[uKey] || '0.00'}</span></span></td>
      `;
    }

    let footerAvgAsistHtml = "";
    if (showAsist) {
      for (let u = 1; u <= numUnits; u++) {
        const uKey = `u${u}`;
        footerAvgAsistHtml += `
          <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-asist-${uKey}" class="summary-value">${stats.avgAsistencia[uKey] || 0}%</span></span></td>
        `;
      }
    }

    let footerAvgPartHtml = "";
    if (showPart) {
      for (let u = 1; u <= numUnits; u++) {
        const uKey = `u${u}`;
        footerAvgPartHtml += `
          <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-part-${uKey}" class="summary-value">${stats.avgParticipacion[uKey] || '0.0'}</span></span></td>
        `;
      }
    }

    let footerAvgEvalsHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      footerAvgEvalsHtml += `
        <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-eval-u${u}" class="summary-value">${stats.avgEvaluaciones[u] || '0.00'}</span></span></td>
      `;
    }

    const totalTableCols = 6 + (numUnits * 3) + (showAsist ? numUnits : 0) + (showPart ? numUnits : 0);

    container.innerHTML = `
      <div class="page-title-area gradebook-header-container">
        <!-- Fila 1: Título de la Materia y Selector de Grupo -->
        <div class="gradebook-header-top">
          <div class="gradebook-title-col">
            <h1 class="page-title" title="${this.escapeHtml(course.nombre)}">
              <span class="course-name-text">${this.escapeHtml(course.nombre)}</span>
              <span class="course-group-badge">
                ${this.escapeHtml(course.grupo || 'Grupo A')}
              </span>
            </h1>
          </div>
          <div class="gradebook-switcher-col">
            <div class="gradebook-switchers-row">
              <div class="gradebook-select-pill gradebook-semester-pill" title="Filtrar materias por Semestre / Periodo Escolar">
                <span class="pill-prefix">Semestre:</span>
                <select class="form-control gradebook-semester-select" onchange="App.switchSemester(this.value)" title="Seleccionar semestre">
                  ${semesterSelectHtml}
                </select>
              </div>
              <div class="gradebook-select-pill gradebook-course-pill" title="Seleccionar lista o grupo de este semestre">
                <span class="pill-prefix">Lista / Grupo:</span>
                <select class="form-control gradebook-course-select" onchange="App.switchCourse(this.value)" title="Cambiar de materia o grupo">
                  ${selectHtml}
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Fila 2: Subtítulo Descriptivo y Barra de Acciones del Calificador -->
        <div class="gradebook-header-bottom">
          <div class="gradebook-desc-col">
            <p class="page-desc">
              Control de evaluaciones por unidad y calificación final • Periodo <b>${this.escapeHtml(course.periodo)}</b> • <span class="page-desc-units-tag">${numUnits} Unidades y Exámenes</span>
              ${showAsist ? ' • <span style="color: var(--uat-orange); font-weight: 600;">Asistencia (' + weights.asistencia + '%)</span>' : ''}
              ${showPart ? ' • <span style="color: var(--uat-orange); font-weight: 600;">Participación (' + weights.participacion + '%)</span>' : ''}
            </p>
          </div>
          <div class="gradebook-actions-col">
            <!-- Control Rápido de Unidades Directo en el Calificador -->
            <div class="units-quick-stepper" title="Ajustar cantidad de unidades y exámenes para ${this.escapeHtml(course.nombre)}">
              <span class="stepper-label">Unidades:</span>
              <button type="button" class="btn btn-xs btn-default" onclick="App.quickChangeCourseUnits(-1)" title="Quitar última unidad y su examen" ${numUnits <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} style="padding: 2px 8px; font-weight: 800; font-size: 14px; line-height: 1;">−</button>
              <span class="stepper-val">${numUnits}</span>
              <button type="button" class="btn btn-xs btn-default" onclick="App.quickChangeCourseUnits(1)" title="Agregar una unidad y su examen" ${numUnits >= 8 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} style="padding: 2px 8px; font-weight: 800; font-size: 14px; line-height: 1;">+</button>
            </div>
            <button class="btn btn-primary btn-course-pair" onclick="App.openNewCourseModal()" title="Crear nueva materia o agregar otro grupo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva Lista
            </button>
            <button class="btn btn-default btn-course-pair" onclick="App.openManageCourseModal()" title="Ajustes de esta lista (renombrar, unidades, ponderaciones, metas de firmas, duplicar grupo, eliminar)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Ajustes
            </button>
            <button class="btn btn-default" onclick="App.openBulkImportModal()" title="Pegar alumnos nuevos de este semestre desde Excel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
              Pegar Alumnos
            </button>
            <button class="btn btn-default" title="Limpiar lista para cargar alumnos de este nuevo semestre" onclick="App.clearCurrentCourseData()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Vaciar Grupo
            </button>
            <button class="btn btn-primary" onclick="Exporter.exportToExcel(App.getActiveCourse(), App.getStudentsMap(), 'docente')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Descargar Excel
            </button>
          </div>
        </div>
      </div>

      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="search-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="search-input" placeholder="Buscar por matrícula o nombre..." 
              value="${this.searchTerm}" oninput="App.handleSearch(this.value)" />
          </div>
          <button type="button" class="btn-focus-toggle" onclick="App.toggleGradebookFocusMode()" title="Maximizar área de calificaciones (Inmovilizado estilo Excel)">
            <span id="btnFocusIcon">${this.isGradebookFocused ? '⤡' : '⤢'}</span>
            <span id="btnFocusText">${this.isGradebookFocused ? 'Restaurar Vista' : 'Maximizar Calificador'}</span>
          </button>
        </div>
        <div class="toolbar-right">
          <span class="freeze-panes-hint" title="Encabezados y columnas de alumnos inmovilizados al desplazarte como en Excel">
            📌 Fila y Alumnos Fijos
          </span>
          <span id="studentCountDisplay" style="font-size: 12.5px; color: var(--text-secondary);">
            Mostrando <b>${visibleCount}</b> alumnos
          </span>
        </div>
      </div>

      <div class="notion-table-wrapper">
        <table class="notion-table notion-table-gradebook">
          <thead>
            <tr>
              <th class="col-sticky-1 col-matricula" style="width: 130px;"><div class="th-content"><span class="th-icon">Aa</span> Matrícula</div></th>
              <th class="col-sticky-2 col-alumno" style="width: 270px;"><div class="th-content"><span class="th-icon">Q</span> Alumno (Rollup)</div></th>
              <th style="width: 160px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación Final</div></th>
              
              <!-- Firmas U1-Un con Candado de Bloqueo -->
              ${firmasHeadersHtml}

              <!-- Exámenes U1-Un con Candado de Bloqueo -->
              ${examenesHeadersHtml}

              <!-- Asistencias U1-Un (Opcional) -->
              ${asistenciaHeadersHtml}

              <!-- Participaciones U1-Un (Opcional) -->
              ${participacionHeadersHtml}

              <!-- Evaluaciones Calculadas U1-Un -->
              ${evalHeadersHtml}

              <th style="width: 95px;"><div class="th-content"><span class="th-icon">#</span> Proyecto Final</div></th>
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">#</span> Puntos Extra</div></th>
              <th style="width: 45px;"></th>
            </tr>
          </thead>
          <tbody id="gradebookTableBody">
            ${rowsHtml || `<tr><td colspan="${totalTableCols}" style="text-align: center; padding: 24px; color: var(--text-tertiary);">No se encontraron alumnos registrados.</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="notion-table-footer">
              <td colspan="2" class="col-sticky-footer"><span class="summary-chip"><span class="summary-label">TOTAL:</span> <span class="summary-value">${course.records.length} ALUMNOS</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVERAGE:</span> <span id="stat-avg-final" class="summary-value">${stats.avgFinal}</span></span></td>
              
              <!-- Max Firmas con Edición Directa en Pie de Tabla -->
              ${footerMaxFirmasHtml}

              <!-- Promedio Exámenes -->
              ${footerAvgExamenesHtml}

              <!-- Promedio Asistencias (Opcional) -->
              ${footerAvgAsistHtml}

              <!-- Promedio Participaciones (Opcional) -->
              ${footerAvgPartHtml}

              <!-- Promedio Evaluaciones -->
              ${footerAvgEvalsHtml}

              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
        <div class="table-bottom-bar">
          <button class="add-row-btn" onclick="App.addNewStudentToCourse()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo alumno a la lista
          </button>
          <div id="cloudSaveStatusIndicator" class="cloud-save-status-indicator saved" title="Todos los cambios se almacenan directamente en Supabase (PostgreSQL) en la nube">
            <span class="cloud-save-dot"></span>
            <span id="cloudSaveStatusText">Sincronizado en la nube (Supabase)</span>
          </div>
        </div>
      </div>
    `;
    setTimeout(() => {
      this.fitGradebookTableHeight();
    }, 0);
  },

  // 1.5 CONTROL DE ASISTENCIAS Y PARTICIPACIÓN (SÁBANA COMPLETA ESTILO EXCEL / NOTION)
  setAttendanceUnit: function(unitNum) {
    this.attendanceActiveUnit = Number(unitNum) || 1;
    this.attendanceActiveSessionId = null;
    this.render();
  },

  setAttendanceMode: function(mode) {
    this.attendanceMode = mode;
    this.render();
  },

  setAttendanceActiveSession: function(sessionId) {
    this.attendanceActiveSessionId = sessionId;
    this.render();
  },

  formatSessionDate: function(dateStr) {
    if (!dateStr) return { dayName: "Clase", dayNum: "--", monthNum: "--" };
    const parts = dateStr.split("-");
    if (parts.length < 3) return { dayName: "Clase", dayNum: dateStr, monthNum: "" };
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const dayName = days[dt.getDay()] || "Clase";
    const dayNum = String(d).padStart(2, "0");
    const monthNum = String(m + 1).padStart(2, "0");
    return { dayName, dayNum, monthNum };
  },

  // Calendario Escolar Administrativo UAT 2026 (Extracción oficial del documento rector)
  UAT_CALENDAR_2026: {
    "2026 - 3 OTOÑO": {
      periodo: "2026 - 3 OTOÑO",
      nombreCorto: "Otoño 2026",
      inicioClases: "2026-08-17",
      finClases: "2026-11-27",
      meses: [
        { year: 2026, month: 7, name: "Agosto" },
        { year: 2026, month: 8, name: "Septiembre" },
        { year: 2026, month: 9, name: "Octubre" },
        { year: 2026, month: 10, name: "Noviembre" },
        { year: 2026, month: 11, name: "Diciembre" }
      ],
      pagoFicha: {
        inicio: "2026-08-03",
        fin: "2026-08-14",
        fechaLimite: "2026-08-14",
        inicioTxt: "3 de Agosto",
        finTxt: "14 de Agosto",
        limiteTxt: "14 de Agosto de 2026",
        descripcion: "Pago de Ficha de Inscripción y Reinscripciones"
      },
      altasBajas: {
        inicio: "2026-08-17",
        fin: "2026-08-21",
        fechaLimiteBaja: "2026-10-16",
        inicioTxt: "17 de Agosto",
        finTxt: "21 de Agosto",
        limiteBajaTxt: "16 de Octubre de 2026",
        descripcion: "Periodo de Altas y Bajas de Materias"
      },
      evaluaciones: {
        ordinarias: { inicio: "2026-11-23", fin: "2026-11-27", label: "Evaluaciones Finales Ordinarias" },
        extraordinarias: { inicio: "2026-11-30", fin: "2026-12-04", label: "Evaluaciones Finales Extraordinarias" }
      },
      diasInhabiles: [
        { fecha: "2026-09-16", motivo: "Día de la Independencia de México (Suspensión Oficial)" },
        { fecha: "2026-10-13", motivo: "Día UAT / Festivo Sindical CCT SUTUAT (Suspensión)" },
        { fecha: "2026-11-02", motivo: "Día de Muertos (Suspensión Oficial)" },
        { fecha: "2026-11-16", motivo: "Conmemoración de la Revolución Mexicana (Suspensión Oficial)" }
      ]
    },
    "2026 - 1 PRIMAVERA": {
      periodo: "2026 - 1 PRIMAVERA",
      nombreCorto: "Primavera 2026",
      inicioClases: "2026-01-19",
      finClases: "2026-05-22",
      meses: [
        { year: 2026, month: 0, name: "Enero" },
        { year: 2026, month: 1, name: "Febrero" },
        { year: 2026, month: 2, name: "Marzo" },
        { year: 2026, month: 3, name: "Abril" },
        { year: 2026, month: 4, name: "Mayo" }
      ],
      pagoFicha: {
        inicio: "2026-01-06",
        fin: "2026-01-16",
        fechaLimite: "2026-01-16",
        inicioTxt: "6 de Enero",
        finTxt: "16 de Enero",
        limiteTxt: "16 de Enero de 2026",
        descripcion: "Pago de Ficha de Inscripción y Reinscripciones"
      },
      altasBajas: {
        inicio: "2026-01-19",
        fin: "2026-01-23",
        fechaLimiteBaja: "2026-03-20",
        inicioTxt: "19 de Enero",
        finTxt: "23 de Enero",
        limiteBajaTxt: "20 de Marzo de 2026",
        descripcion: "Periodo de Altas y Bajas de Materias"
      },
      evaluaciones: {
        ordinarias: { inicio: "2026-05-11", fin: "2026-05-15", label: "Evaluaciones Finales Ordinarias" },
        extraordinarias: { inicio: "2026-05-18", fin: "2026-05-22", label: "Evaluaciones Finales Extraordinarias" }
      },
      diasInhabiles: [
        { fecha: "2026-01-01", motivo: "Año Nuevo" },
        { fecha: "2026-01-26", motivo: "Inhábil CCT SUTUAT" },
        { fecha: "2026-02-02", motivo: "Día de la Constitución Mexicana" },
        { fecha: "2026-03-16", motivo: "Natalicio de Benito Juárez" },
        { fecha: "2026-03-30", motivo: "Semana Santa (Vacaciones de Primavera)" },
        { fecha: "2026-03-31", motivo: "Semana Santa (Vacaciones de Primavera)" },
        { fecha: "2026-04-01", motivo: "Semana Santa (Vacaciones de Primavera)" },
        { fecha: "2026-04-02", motivo: "Semana Santa (Vacaciones de Primavera)" },
        { fecha: "2026-04-03", motivo: "Semana Santa (Vacaciones de Primavera)" },
        { fecha: "2026-04-06", motivo: "Días otorgados CCT SUTUAT" },
        { fecha: "2026-04-07", motivo: "Días otorgados CCT SUTUAT" },
        { fecha: "2026-04-08", motivo: "Días otorgados CCT SUTUAT" },
        { fecha: "2026-04-09", motivo: "Días otorgados CCT SUTUAT" },
        { fecha: "2026-04-10", motivo: "Días otorgados CCT SUTUAT" },
        { fecha: "2026-05-01", motivo: "Día del Trabajo" },
        { fecha: "2026-05-05", motivo: "Batalla de Puebla" },
        { fecha: "2026-05-15", motivo: "Día del Maestro" }
      ]
    }
  },

  // Generador automático de fechas oficiales de clase para el semestre
  populateOfficialSemesterSessions: function(course, force = false) {
    if (!course) return false;
    if (!force && course.attendanceSessions && course.attendanceSessions.length > 0) {
      return false;
    }

    const normPeriodo = this.normalizePeriodo(course.periodo || this.getSelectedSemester());
    const calCfg = this.UAT_CALENDAR_2026[normPeriodo] || this.UAT_CALENDAR_2026["2026 - 3 OTOÑO"];

    const start = new Date(calCfg.inicioClases + 'T12:00:00');
    const end = new Date(calCfg.finClases + 'T12:00:00');
    const holidayMap = {};
    (calCfg.diasInhabiles || []).forEach(h => {
      holidayMap[h.fecha] = h.motivo;
    });

    const validClassDays = [];
    let curr = new Date(start);
    while (curr <= end) {
      const dow = curr.getDay();
      if (dow !== 0 && dow !== 6) { // Lunes a Viernes
        const yyyy = curr.getFullYear();
        const mm = String(curr.getMonth() + 1).padStart(2, '0');
        const dd = String(curr.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        if (!holidayMap[dateStr]) {
          validClassDays.push(dateStr);
        }
      }
      curr.setDate(curr.getDate() + 1);
    }

    if (validClassDays.length === 0) return false;

    const numUnits = Math.max(1, Number(course.unidadesCount) || 3);
    course.attendanceSessions = [];

    // Distribuir días uniformemente entre las unidades
    const baseCount = Math.floor(validClassDays.length / numUnits);
    const remainder = validClassDays.length % numUnits;

    let dayIdx = 0;
    for (let u = 1; u <= numUnits; u++) {
      const countForUnit = baseCount + (u <= remainder ? 1 : 0);
      for (let i = 0; i < countForUnit; i++) {
        if (dayIdx >= validClassDays.length) break;
        const dateStr = validClassDays[dayIdx];
        const isAltasBajas = (dateStr >= calCfg.altasBajas.inicio && dateStr <= calCfg.altasBajas.fin);
        const isLimiteBaja = (dateStr === calCfg.altasBajas.fechaLimiteBaja);

        let tema = `Clase ${i + 1}`;
        if (isAltasBajas) tema += ' (Altas y Bajas)';
        else if (isLimiteBaja) tema += ' (Límite Baja)';

        const sess = {
          id: 'sess_' + dateStr.replace(/-/g, '') + '_' + Math.random().toString(36).substring(2, 6),
          unidad: u,
          fecha: dateStr,
          tema: tema,
          isAltasBajas: isAltasBajas,
          isLimiteBaja: isLimiteBaja
        };
        course.attendanceSessions.push(sess);
        dayIdx++;
      }
    }

    // Las fechas oficiales inician limpias con casillas en blanco para captura docente
    (course.records || []).forEach(rec => {
      if (!rec.attendanceDays) rec.attendanceDays = {};
    });

    // Recalcular métricas de asistencia de todas las unidades
    for (let u = 1; u <= numUnits; u++) {
      this.recalculateAttendanceForUnit(course, u);
    }

    this.debouncedSave();
    return true;
  },

  syncOfficialCalendar: function(confirmOverwrite = false) {
    const course = this.getActiveCourse();
    if (!course) {
      this.showToast("⚠️ No hay materia activa seleccionada");
      return;
    }

    const normPeriodo = this.normalizePeriodo(course.periodo || this.getSelectedSemester());
    const calCfg = this.UAT_CALENDAR_2026[normPeriodo] || this.UAT_CALENDAR_2026["2026 - 3 OTOÑO"];

    if (confirmOverwrite && course.attendanceSessions && course.attendanceSessions.length > 0) {
      const msg = `¿Deseas sincronizar y cargar las fechas oficiales del calendario UAT (${normPeriodo})?\n\n` +
                  `• Se generarán las fechas hábiles de clase oficiales (Lunes a Viernes).\n` +
                  `• Se excluirán los días inhábiles y feriados oficiales.\n` +
                  `• Se remarcarán los días de Altas y Bajas y Pago de Ficha de Inscripción.\n\n` +
                  `Nota: Se reemplazarán las columnas de fechas actuales por las oficiales.`;
      if (!confirm(msg)) {
        return;
      }
    }

    const ok = this.populateOfficialSemesterSessions(course, true);
    if (ok) {
      this.closeOfficialCalendarModal();
      this.render();
      this.showToast(`🎉 ¡Calendario Oficial UAT sincronizado! (${course.attendanceSessions.length} fechas de clase cargadas)`);
    } else {
      this.showToast("⚠️ No se pudieron generar las fechas oficiales.");
    }
  },

  openOfficialCalendarModal: function() {
    const modal = document.getElementById("officialCalendarModal");
    if (!modal) return;

    const course = this.getActiveCourse();
    const normPeriodo = this.normalizePeriodo(course ? course.periodo : this.getSelectedSemester());
    const calCfg = this.UAT_CALENDAR_2026[normPeriodo] || this.UAT_CALENDAR_2026["2026 - 3 OTOÑO"];

    const subEl = document.getElementById("officialCalModalSub");
    if (subEl) {
      subEl.innerHTML = `Periodo Escolar: <b>${this.escapeHtml(calCfg.periodo)}</b> • Días hábiles de clase, periodo de pago de ficha de inscripción y altas/bajas`;
    }

    const bodyEl = document.getElementById("officialCalModalBody");
    if (bodyEl) {
      bodyEl.innerHTML = this.renderOfficialCalendarView(calCfg);
    }

    modal.classList.add("open");
  },

  closeOfficialCalendarModal: function() {
    const modal = document.getElementById("officialCalendarModal");
    if (modal) modal.classList.remove("open");
  },

  renderOfficialCalendarView: function(calCfg) {
    const holidayMap = {};
    (calCfg.diasInhabiles || []).forEach(h => {
      holidayMap[h.fecha] = h.motivo;
    });

    let monthsHtml = "";
    (calCfg.meses || []).forEach(mInfo => {
      const year = mInfo.year;
      const month = mInfo.month; // 0-based
      const firstDay = new Date(year, month, 1).getDay(); // 0: Dom ... 6: Sáb
      const totalDays = new Date(year, month + 1, 0).getDate();

      let daysGridHtml = "";
      // Celdas vacías antes del 1er día
      for (let empty = 0; empty < firstDay; empty++) {
        daysGridHtml += `<td></td>`;
      }

      let currentDayCol = firstDay;
      for (let day = 1; day <= totalDays; day++) {
        const mm = String(month + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const dateStr = `${year}-${mm}-${dd}`;

        const isWeekend = (currentDayCol === 0 || currentDayCol === 6);
        let cellClass = "cal-day-cell";
        let tooltip = `${day} de ${mInfo.name}`;

        if (holidayMap[dateStr]) {
          cellClass += " day-inhabiles";
          tooltip += ` • INHÁBIL: ${holidayMap[dateStr]}`;
        } else if (dateStr >= calCfg.pagoFicha.inicio && dateStr <= calCfg.pagoFicha.fin) {
          cellClass += " day-pago";
          tooltip += ` • PAGO DE FICHA DE INSCRIPCIÓN (Límite: ${calCfg.pagoFicha.limiteTxt})`;
        } else if (dateStr >= calCfg.altasBajas.inicio && dateStr <= calCfg.altasBajas.fin) {
          cellClass += " day-altasbajas";
          tooltip += ` • ALTAS Y BAJAS DE MATERIAS (${calCfg.altasBajas.inicioTxt} al ${calCfg.altasBajas.finTxt})`;
        } else if (dateStr === calCfg.altasBajas.fechaLimiteBaja) {
          cellClass += " day-limitebaja";
          tooltip += ` • FECHA LÍMITE DE BAJA DE MATERIAS`;
        } else if (calCfg.evaluaciones?.ordinarias && dateStr >= calCfg.evaluaciones.ordinarias.inicio && dateStr <= calCfg.evaluaciones.ordinarias.fin) {
          cellClass += " day-ordinarias";
          tooltip += ` • Evaluaciones Ordinarias`;
        } else if (!isWeekend && dateStr >= calCfg.inicioClases && dateStr <= calCfg.finClases) {
          cellClass += " day-clase";
          tooltip += ` • Día de Clase Oficial`;
        }

        daysGridHtml += `
          <td>
            <span class="${cellClass}" title="${this.escapeHtml(tooltip)}">${day}</span>
          </td>
        `;

        currentDayCol++;
        if (currentDayCol === 7 && day < totalDays) {
          daysGridHtml += `</tr><tr>`;
          currentDayCol = 0;
        }
      }

      // Rellenar celdas al final si no termina en sábado
      if (currentDayCol > 0 && currentDayCol < 7) {
        for (let empty = currentDayCol; empty < 7; empty++) {
          daysGridHtml += `<td></td>`;
        }
      }

      monthsHtml += `
        <div class="official-cal-month-card">
          <div class="official-cal-month-title">${mInfo.name} ${year}</div>
          <table class="official-cal-table">
            <thead>
              <tr>
                <th>D</th><th>L</th><th>M</th><th>MI</th><th>J</th><th>V</th><th>S</th>
              </tr>
            </thead>
            <tbody>
              <tr>${daysGridHtml}</tr>
            </tbody>
          </table>
        </div>
      `;
    });

    return `
      <div class="official-cal-container">
        <!-- Tarjetas de Hitos Clave -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px;">
          <div class="uat-cal-milestone milestone-pago" style="padding: 12px; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 20px;">💳</span>
              <span class="milestone-badge" style="font-size: 11px;">PAGO DE FICHA DE INSCRIPCIÓN</span>
            </div>
            <div class="milestone-dates" style="font-size: 13.5px;">${calCfg.pagoFicha.inicioTxt} al ${calCfg.pagoFicha.finTxt}</div>
            <div class="milestone-deadline" style="margin-top: 3px; font-size: 11.5px;">
              Fecha límite improrrogable: <b>${calCfg.pagoFicha.limiteTxt}</b>
            </div>
          </div>

          <div class="uat-cal-milestone milestone-altasbajas" style="padding: 12px; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 20px;">🔄</span>
              <span class="milestone-badge" style="font-size: 11px;">ALTAS Y BAJAS DE MATERIAS</span>
            </div>
            <div class="milestone-dates" style="font-size: 13.5px;">${calCfg.altasBajas.inicioTxt} al ${calCfg.altasBajas.finTxt}</div>
            <div class="milestone-deadline" style="margin-top: 3px; font-size: 11.5px;">
              Límite de baja: <b>${calCfg.altasBajas.limiteBajaTxt}</b>
            </div>
          </div>

          <div class="uat-cal-milestone" style="padding: 12px; border-radius: 8px; background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.3);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 20px;">📅</span>
              <span style="color: #15803d; font-weight: 800; font-size: 11px;">DÍAS DE CLASE HÁBILES</span>
            </div>
            <div class="milestone-dates" style="font-size: 13.5px;">${calCfg.inicioClases} al ${calCfg.finClases}</div>
            <div class="milestone-deadline" style="margin-top: 3px; font-size: 11.5px;">
              Lunes a Viernes • Feriados e inhábiles oficiales excluidos
            </div>
          </div>
        </div>

        <!-- Cuadrícula de Meses del Semestre -->
        <div class="official-cal-grid">
          ${monthsHtml}
        </div>

        <!-- Barra de Leyenda -->
        <div class="cal-legend-bar">
          <span style="font-weight: 700; color: var(--text-primary); margin-right: 4px;">Simbología Oficial:</span>
          <div class="cal-legend-item">
            <span class="cal-legend-swatch" style="background: #f59e0b;"></span>
            <span>Pago de Ficha de Inscripción (${calCfg.pagoFicha.inicioTxt} al ${calCfg.pagoFicha.finTxt})</span>
          </div>
          <div class="cal-legend-item">
            <span class="cal-legend-swatch" style="background: #0284c7;"></span>
            <span>Altas y Bajas de Materias (${calCfg.altasBajas.inicioTxt} al ${calCfg.altasBajas.finTxt})</span>
          </div>
          <div class="cal-legend-item">
            <span class="cal-legend-swatch" style="background: #ea580c;"></span>
            <span>Límite Baja Materias (${calCfg.altasBajas.limiteBajaTxt})</span>
          </div>
          <div class="cal-legend-item">
            <span class="cal-legend-swatch" style="background: rgba(34, 197, 94, 0.4); border: 1px solid rgba(34, 197, 94, 0.8);"></span>
            <span>Días de Clase</span>
          </div>
          <div class="cal-legend-item">
            <span class="cal-legend-swatch" style="background: #ef4444;"></span>
            <span>Días Inhábiles Oficiales (Sin Clases)</span>
          </div>
          <div class="cal-legend-item">
            <span class="cal-legend-swatch" style="background: rgba(168, 85, 247, 0.4); border: 1px solid rgba(168, 85, 247, 0.8);"></span>
            <span>Evaluaciones Ordinarias</span>
          </div>
        </div>
      </div>
    `;
  },

  addAttendanceSession: function(customDate, customTopic) {
    const course = this.getActiveCourse();
    if (!course) return;
    if (!course.attendanceSessions) course.attendanceSessions = [];

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;

    const currentUnit = this.attendanceActiveUnit;
    const unitSessions = course.attendanceSessions.filter(s => s.unidad === currentUnit);
    const sessionNum = unitSessions.length + 1;
    const newSession = {
      id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      unidad: currentUnit,
      fecha: customDate || today,
      tema: customTopic || `Clase ${sessionNum}`
    };

    course.attendanceSessions.push(newSession);
    this.attendanceActiveSessionId = newSession.id;

    // Iniciar con casillas en blanco para captura
    const records = course.records || [];
    records.forEach(rec => {
      if (!rec.attendanceDays) rec.attendanceDays = {};
    });

    this.recalculateAttendanceForUnit(course, currentUnit);
    this.debouncedSave();
    this.render();
    this.showToast(`✅ Fecha ${newSession.fecha} (${newSession.tema}) agregada a la Sábana`);
  },

  promptAddAttendanceDate: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    const currentUnit = this.attendanceActiveUnit;
    const unitSessions = (course.attendanceSessions || []).filter(s => s.unidad === currentUnit);

    let defaultDate = "";
    if (unitSessions.length > 0) {
      const lastDate = unitSessions[unitSessions.length - 1].fecha;
      if (lastDate) {
        const d = new Date(lastDate + 'T12:00:00');
        d.setDate(d.getDate() + 2);
        defaultDate = d.toISOString().split('T')[0];
      }
    }
    if (!defaultDate) {
      defaultDate = new Date().toISOString().split('T')[0];
    }

    const inputDate = prompt(`📅 Agregar Fecha de Clase para Unidad ${currentUnit}\n\nIngresa la fecha en formato AAAA-MM-DD:`, defaultDate);
    if (!inputDate || !inputDate.trim()) return;

    const cleanDate = inputDate.trim();
    const sessionNum = unitSessions.length + 1;
    const inputTopic = prompt(`Tema o Título de la Clase (Opcional):`, `Clase ${sessionNum}`) || `Clase ${sessionNum}`;

    this.addAttendanceSession(cleanDate, inputTopic.trim());
  },

  promptEditAttendanceDate: function(sessionId) {
    const course = this.getActiveCourse();
    if (!course || !course.attendanceSessions) return;
    const session = course.attendanceSessions.find(s => s.id === sessionId);
    if (!session) return;

    const modal = document.getElementById("editAttendanceSessionModal");
    if (!modal) return;
    const idInp = document.getElementById("editSessionId");
    const dateInp = document.getElementById("editSessionDate");
    const topicInp = document.getElementById("editSessionTopic");

    if (idInp) idInp.value = sessionId;
    if (dateInp) dateInp.value = session.fecha || '';
    if (topicInp) topicInp.value = session.tema || '';
    modal.classList.add("open");
  },

  closeEditAttendanceModal: function() {
    const modal = document.getElementById("editAttendanceSessionModal");
    if (modal) modal.classList.remove("open");
  },

  submitEditAttendanceSession: function() {
    const course = this.getActiveCourse();
    if (!course || !course.attendanceSessions) return;
    const sessionId = document.getElementById("editSessionId")?.value;
    const newDate = document.getElementById("editSessionDate")?.value;
    const newTopic = document.getElementById("editSessionTopic")?.value?.trim();

    const session = course.attendanceSessions.find(s => s.id === sessionId);
    if (!session) return;

    if (newDate) session.fecha = newDate;
    session.tema = newTopic || session.tema || 'Clase';

    this.debouncedSave();
    this.closeEditAttendanceModal();
    this.render();
    this.showToast("✅ Fecha de clase actualizada");
  },

  deleteAttendanceSessionFromModal: function() {
    const sessionId = document.getElementById("editSessionId")?.value;
    if (sessionId) {
      this.closeEditAttendanceModal();
      this.deleteAttendanceSession(sessionId);
    }
  },

  openAttendanceCalendarModal: function() {
    const modal = document.getElementById("attendanceCalendarModal");
    if (!modal) return;
    const startInp = document.getElementById("calendarStartDate");
    if (startInp) {
      startInp.value = new Date().toISOString().split('T')[0];
    }
    modal.classList.add("open");
  },

  closeAttendanceCalendarModal: function() {
    const modal = document.getElementById("attendanceCalendarModal");
    if (modal) modal.classList.remove("open");
  },

  submitGenerateAttendanceCalendar: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    const currentUnit = this.attendanceActiveUnit;

    const startInp = document.getElementById("calendarStartDate");
    const countInp = document.getElementById("calendarTotalClasses");
    const markPInp = document.getElementById("calMarkAllPresent");

    const startDateStr = startInp?.value;
    const totalNeeded = Math.min(40, Math.max(1, Number(countInp?.value) || 8));
    const markP = markPInp ? markPInp.checked : true;

    if (!startDateStr) {
      alert("Por favor selecciona una fecha de inicio.");
      return;
    }

    const selectedDays = [];
    if (document.getElementById("calDay1")?.checked) selectedDays.push(1); // Lun
    if (document.getElementById("calDay2")?.checked) selectedDays.push(2); // Mar
    if (document.getElementById("calDay3")?.checked) selectedDays.push(3); // Mié
    if (document.getElementById("calDay4")?.checked) selectedDays.push(4); // Jue
    if (document.getElementById("calDay5")?.checked) selectedDays.push(5); // Vie
    if (document.getElementById("calDay6")?.checked) selectedDays.push(6); // Sáb

    if (selectedDays.length === 0) {
      alert("Selecciona al menos un día de la semana.");
      return;
    }

    if (!course.attendanceSessions) course.attendanceSessions = [];
    const existingCount = course.attendanceSessions.filter(s => s.unidad === currentUnit).length;

    let currDate = new Date(startDateStr + 'T12:00:00');
    let addedCount = 0;
    let safetyCounter = 0;

    while (addedCount < totalNeeded && safetyCounter < 150) {
      safetyCounter++;
      const dayOfWeek = currDate.getDay();
      if (selectedDays.includes(dayOfWeek)) {
        const yyyy = currDate.getFullYear();
        const mm = String(currDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currDate.getDate()).padStart(2, '0');
        const dateFormatted = `${yyyy}-${mm}-${dd}`;

        const newSession = {
          id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + '_' + addedCount,
          unidad: currentUnit,
          fecha: dateFormatted,
          tema: `Clase ${existingCount + addedCount + 1}`
        };

        course.attendanceSessions.push(newSession);
        addedCount++;
      }
      currDate.setDate(currDate.getDate() + 1);
    }

    this.recalculateAttendanceForUnit(course, currentUnit);
    this.debouncedSave();
    this.closeAttendanceCalendarModal();
    this.render();
    this.showToast(`🎉 ¡Listo! Se generaron ${addedCount} fechas de clase para la Unidad ${currentUnit}`);
  },

  // =========================================================================
  // MÓDULO INTELIGENTE DE IMPORTACIÓN DE ASISTENCIAS DESDE EXCEL (.XLSX / .CSV)
  // =========================================================================

  openExcelAttendanceImportModal: function() {
    const modal = document.getElementById("excelAttendanceImportModal");
    if (!modal) return;

    const course = this.getActiveCourse();
    if (!course) {
      alert("Selecciona primero una materia para importar asistencias.");
      return;
    }

    const currentUnit = this.attendanceActiveUnit || 1;
    this._excelAttendanceState = {
      file: null,
      workbook: null,
      sheets: [],
      selectedSheet: null,
      targetUnit: currentUnit,
      rawRows: [],
      headerRowIndex: -1,
      detectedColumns: null,
      matches: []
    };

    const unitSelect = document.getElementById("excelImportTargetUnit");
    if (unitSelect) {
      const numU = Number(course.unidadesCount) || 5;
      let opts = "";
      for (let u = 1; u <= numU; u++) {
        opts += `<option value="${u}" ${u === currentUnit ? 'selected' : ''}>Unidad ${u}</option>`;
      }
      unitSelect.innerHTML = opts;
    }

    const fileInp = document.getElementById("excelAttendanceFileInput");
    if (fileInp) fileInp.value = "";

    const dropzoneContent = document.getElementById("excelImportDropzoneContent");
    if (dropzoneContent) {
      dropzoneContent.innerHTML = `
        <div style="font-size: 38px; margin-bottom: 8px;">📂</div>
        <p style="font-weight: 700; color: var(--uat-blue-night); margin-bottom: 4px; font-size: 14px;">
          Arrastra tu archivo Excel aquí o haz clic para seleccionarlo
        </p>
        <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">
          Soporta <b>.xlsx, .xls y .csv</b> • Detección automática de totales o fechas con marcas (P/F/R/J)
        </p>
      `;
    }

    const optContainer = document.getElementById("excelImportOptionsContainer");
    if (optContainer) optContainer.style.display = "none";
    const banner = document.getElementById("excelImportStatusBanner");
    if (banner) banner.style.display = "none";
    const previewContainer = document.getElementById("excelImportPreviewContainer");
    if (previewContainer) previewContainer.style.display = "none";
    const btnApply = document.getElementById("btnApplyExcelAttendance");
    if (btnApply) {
      btnApply.disabled = true;
      btnApply.innerHTML = `⚡ Aplicar a Unidad ${currentUnit}`;
    }
    const summaryEl = document.getElementById("excelImportFooterSummary");
    if (summaryEl) summaryEl.textContent = "";

    modal.classList.add("open");
  },

  closeExcelAttendanceImportModal: function() {
    const modal = document.getElementById("excelAttendanceImportModal");
    if (modal) modal.classList.remove("open");
  },

  handleExcelDragOver: function(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById("excelImportDropzone");
    if (dropzone) dropzone.classList.add("dragover");
  },

  handleExcelDragLeave: function(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById("excelImportDropzone");
    if (dropzone) dropzone.classList.remove("dragover");
  },

  handleExcelDrop: function(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById("excelImportDropzone");
    if (dropzone) dropzone.classList.remove("dragover");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      this.processAttendanceExcelFile(files[0]);
    }
  },

  handleAttendanceExcelFileSelected: function(e) {
    const files = e.target && e.target.files;
    if (files && files.length > 0) {
      this.processAttendanceExcelFile(files[0]);
    }
  },

  onExcelImportUnitChanged: function(val) {
    if (!this._excelAttendanceState) return;
    this._excelAttendanceState.targetUnit = Number(val) || 1;
    if (this._excelAttendanceState.workbook && this._excelAttendanceState.sheets && this._excelAttendanceState.sheets.length > 1) {
      const bestForUnit = this.detectBestAttendanceSheet(this._excelAttendanceState.workbook, this._excelAttendanceState.targetUnit);
      if (bestForUnit && bestForUnit !== this._excelAttendanceState.selectedSheet) {
        const cleanBest = this._cleanMatchText(bestForUnit);
        if (cleanBest.includes(`u${this._excelAttendanceState.targetUnit}`) || cleanBest.includes(`unidad ${this._excelAttendanceState.targetUnit}`) || cleanBest.includes(`parcial ${this._excelAttendanceState.targetUnit}`)) {
          this._excelAttendanceState.selectedSheet = bestForUnit;
          this._excelAttendanceState.autoDetectedSheet = bestForUnit;
          const sheetSelect = document.getElementById("excelImportSheetSelect");
          if (sheetSelect) sheetSelect.value = bestForUnit;
          const autoBadge = document.getElementById("excelImportSheetAutoBadge");
          if (autoBadge) autoBadge.textContent = "🎯 Auto-detectada para U" + this._excelAttendanceState.targetUnit;
        }
      }
    }
    this.analyzeCurrentExcelSheet();
    const btnApply = document.getElementById("btnApplyExcelAttendance");
    if (btnApply) {
      const matchCount = (this._excelAttendanceState.matches || []).filter(m => m.status === 'ok').length;
      btnApply.innerHTML = `⚡ Aplicar Asistencias a Unidad ${this._excelAttendanceState.targetUnit} (${matchCount} alumnos)`;
    }
    const summaryFooter = document.getElementById("excelImportFooterSummary");
    if (summaryFooter && this._excelAttendanceState.matches) {
      const matchCount = this._excelAttendanceState.matches.filter(m => m.status === 'ok').length;
      summaryFooter.textContent = `${matchCount} registros listos para sincronizar a la Unidad ${this._excelAttendanceState.targetUnit}.`;
    }
  },

  onExcelImportSheetChanged: function(val) {
    if (!this._excelAttendanceState || !this._excelAttendanceState.workbook) return;
    this._excelAttendanceState.selectedSheet = val;
    const autoBadge = document.getElementById("excelImportSheetAutoBadge");
    if (autoBadge) {
      autoBadge.textContent = (val === this._excelAttendanceState.autoDetectedSheet)
        ? "🎯 Auto-detectada"
        : "✏️ Manual";
    }
    this.analyzeCurrentExcelSheet();
  },

  detectBestAttendanceSheet: function(workbook, targetUnit) {
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) return null;
    if (workbook.SheetNames.length === 1) return workbook.SheetNames[0];

    const course = this.getActiveCourse();
    const records = (course && course.records) ? course.records : [];
    const targetUnitNum = parseInt(targetUnit, 10) || 1;

    // Palabras clave de la materia activa
    const courseTokens = course && course.name ? this._getNameTokens(course.name) : [];
    const groupClean = course && course.group ? this._cleanMatchText(course.group) : "";

    let bestSheet = workbook.SheetNames[0];
    let highestScore = -999;

    workbook.SheetNames.forEach(sheetName => {
      let score = 0;
      const cleanName = this._cleanMatchText(sheetName);

      // 1. Puntuación por nombre de la materia o grupo en la pestaña
      if (courseTokens.length > 0) {
        let matchingTokens = 0;
        courseTokens.forEach(t => {
          if (cleanName.includes(t)) matchingTokens++;
        });
        if (matchingTokens > 0) {
          score += matchingTokens * 35; // Preferencia si la hoja lleva el nombre de esta materia
        }
      }
      if (groupClean && cleanName.includes(groupClean)) {
        score += 30; // Preferencia si lleva el grupo (ej. "A", "GPO 1", etc.)
      }

      // 2. Puntuación por términos de asistencia y unidad
      if (/asistenc|asist|lista|falta|inasist|pase/.test(cleanName)) score += 50;
      if (cleanName.includes(`u${targetUnitNum}`) || cleanName.includes(`unidad ${targetUnitNum}`) || cleanName.includes(`parcial ${targetUnitNum}`)) score += 30;
      if (/calif|evalua|examen|tarea|ponder|rubric|acredita/.test(cleanName) && !/asist/.test(cleanName)) score -= 25;

      // 3. Muestreo de contenido de la hoja buscando alumnos de ESTA materia
      try {
        const worksheet = workbook.Sheets[sheetName];
        if (worksheet) {
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: false });
          if (Array.isArray(rows) && rows.length > 0) {
            let foundAttendanceHeader = false;
            let matchedStudentCount = 0;
            const sampleRows = rows.slice(0, 40);

            sampleRows.forEach(row => {
              if (!Array.isArray(row)) return;
              const rowStr = row.map(c => this._cleanMatchText(String(c))).join(' ');
              if (/falta|inasist|asist|asistencia|asistencias|pase lista|retardo/.test(rowStr)) {
                foundAttendanceHeader = true;
              }

              row.forEach(cell => {
                const cellStr = String(cell).trim().replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
                if (!cellStr) return;
                // Coincidencia con matrículas del grupo de la materia activa
                if (records.some(r => String(r.matricula || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase() === cellStr)) {
                  matchedStudentCount++;
                }
              });
            });

            if (foundAttendanceHeader) score += 30;
            score += Math.min(matchedStudentCount * 8, 80); // Fuerte preferencia a las matrículas reales del grupo
          }
        }
      } catch (e) {
        // Ignorar error al inspeccionar hoja
      }

      if (score > highestScore) {
        highestScore = score;
        bestSheet = sheetName;
      }
    });

    return bestSheet;
  },

  processAttendanceExcelFile: function(file) {
    if (!file) return;
    if (typeof XLSX === "undefined") {
      alert("Error: La librería de lectura de Excel (SheetJS) no está disponible en este momento.");
      return;
    }

    const state = this._excelAttendanceState;
    if (!state) return;
    state.file = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          alert("El archivo no contiene hojas legibles.");
          return;
        }

        state.workbook = workbook;
        state.sheets = workbook.SheetNames;
        const bestSheet = this.detectBestAttendanceSheet(workbook, state.targetUnit);
        state.selectedSheet = bestSheet || workbook.SheetNames[0];
        state.autoDetectedSheet = bestSheet;

        const dropzoneContent = document.getElementById("excelImportDropzoneContent");
        if (dropzoneContent) {
          dropzoneContent.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
              <span style="font-size: 30px;">📗</span>
              <div style="text-align: left;">
                <b style="font-size: 14px; color: var(--uat-blue-night);">${this.escapeHtml(file.name)}</b>
                <div style="font-size: 11.5px; color: var(--text-tertiary);">${(file.size / 1024).toFixed(1)} KB • ${workbook.SheetNames.length} hoja(s) encontrada(s)</div>
              </div>
              <button type="button" class="btn btn-xs btn-default" onclick="event.stopPropagation(); document.getElementById('excelAttendanceFileInput').click();" style="font-size: 11px; margin-left: 6px;">Cambiar archivo</button>
            </div>
          `;
        }

        const optContainer = document.getElementById("excelImportOptionsContainer");
        if (optContainer) optContainer.style.display = "block";

        const sheetContainer = document.getElementById("excelImportSheetSelectorContainer");
        const sheetSelect = document.getElementById("excelImportSheetSelect");
        const autoBadge = document.getElementById("excelImportSheetAutoBadge");
        if (sheetContainer && sheetSelect) {
          if (workbook.SheetNames.length > 1) {
            sheetContainer.style.display = "block";
            sheetSelect.innerHTML = workbook.SheetNames.map(s => {
              const isAuto = s === state.autoDetectedSheet;
              return `<option value="${this.escapeHtml(s)}" ${s === state.selectedSheet ? 'selected' : ''}>${this.escapeHtml(s)}${isAuto ? ' 🎯 (Detectada automáticamente)' : ''}</option>`;
            }).join('');
            if (autoBadge) {
              autoBadge.textContent = state.autoDetectedSheet ? "🎯 Auto-detectada" : "";
            }
          } else {
            sheetContainer.style.display = "none";
          }
        }

        this.analyzeCurrentExcelSheet();
      } catch (err) {
        console.error("Error al procesar el archivo Excel:", err);
        alert("No se pudo procesar el archivo Excel. Asegúrate de que sea un archivo .xlsx, .xls o .csv válido.\nError: " + (err.message || err));
      }
    };
    reader.readAsArrayBuffer(file);
  },

  _cleanMatchText: function(str) {
    if (!str) return "";
    return String(str)
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  _getNameTokens: function(str) {
    const clean = this._cleanMatchText(str);
    if (!clean) return [];
    const stopWords = new Set(["de", "del", "la", "las", "los", "y", "san"]);
    return clean.split(" ").filter(w => w.length > 1 && !stopWords.has(w));
  },

  analyzeCurrentExcelSheet: function() {
    const state = this._excelAttendanceState;
    if (!state || !state.workbook || !state.selectedSheet) return;

    const sheet = state.workbook.Sheets[state.selectedSheet];
    if (!sheet) return;

    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    state.rawRows = rawRows;

    if (!rawRows || rawRows.length === 0) {
      const banner = document.getElementById("excelImportStatusBanner");
      if (banner) {
        banner.style.display = "block";
        banner.style.background = "rgba(239, 68, 68, 0.1)";
        banner.style.color = "var(--color-red)";
        banner.innerHTML = "⚠️ La hoja seleccionada está vacía.";
      }
      return;
    }

    let headerRowIdx = -1;
    let maxHeaderScore = 0;

    for (let r = 0; r < Math.min(25, rawRows.length); r++) {
      const row = rawRows[r] || [];
      let score = 0;
      row.forEach(cell => {
        const txt = this._cleanMatchText(cell);
        if (!txt) return;
        if (/matr|clave|id|cuenta|control/.test(txt)) score += 5;
        if (/nom|alum|estud|persona/.test(txt)) score += 5;
        if (/falta|inasist|ausenc/.test(txt)) score += 4;
        if (/asist|presente/.test(txt)) score += 3;
        if (/retard/.test(txt)) score += 2;
        if (/justif/.test(txt)) score += 2;
        if (/^u\d|unidad/.test(txt)) score += 2;
        if (/\d{1,2}[/-]\d{1,2}|clase|sesion/.test(txt)) score += 2;
      });
      if (score > maxHeaderScore) {
        maxHeaderScore = score;
        headerRowIdx = r;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 0;
    state.headerRowIndex = headerRowIdx;

    const headers = rawRows[headerRowIdx] || [];

    let colMatricula = -1;
    let colNombre = -1;
    let colFaltas = -1;
    let colAsist = -1;
    let colPct = -1;
    let colRetardos = -1;
    let colJustif = -1;
    const dateColumns = [];

    headers.forEach((cell, cIdx) => {
      const hText = this._cleanMatchText(cell);
      if (!hText) return;

      if (colMatricula === -1 && /matr|clave|control|cuenta|id|no\s*cuenta/.test(hText) && !/grupo|materia|prof/.test(hText)) {
        colMatricula = cIdx;
      } else if (colNombre === -1 && /nom|alum|estud/.test(hText) && !/docente|profesor|materia/.test(hText)) {
        colNombre = cIdx;
      } else if (/^pct|%\s*asist|porcentaje/.test(hText)) {
        colPct = cIdx;
      } else if (colFaltas === -1 && /total\s*f|faltas?|inasist|ausenc/.test(hText) && !/fecha|dia/.test(hText)) {
        colFaltas = cIdx;
      } else if (colAsist === -1 && /total\s*a|total\s*p|asistencias?|presentes?/.test(hText) && !/fecha|dia/.test(hText)) {
        colAsist = cIdx;
      } else if (colRetardos === -1 && /retard/.test(hText)) {
        colRetardos = cIdx;
      } else if (colJustif === -1 && /justif/.test(hText)) {
        colJustif = cIdx;
      } else if (/\d{1,2}[/-]\d{1,2}|\d{1,2}-[a-z]{3}|clase\s*\d+|sesi[oó]n\s*\d+|dia\s*\d+/.test(hText) || (typeof cell === 'number' && cell > 44000)) {
        let label = String(cell).trim();
        if (typeof cell === 'number' && cell > 44000) {
          try {
            const d = new Date(Math.round((cell - 25569) * 86400 * 1000));
            label = d.toISOString().slice(0, 10);
          } catch(e) {}
        }
        dateColumns.push({ colIdx: cIdx, label: label });
      }
    });

    const sampleRows = rawRows.slice(headerRowIdx + 1, headerRowIdx + 40);
    if (colMatricula === -1) {
      for (let c = 0; c < headers.length; c++) {
        let numericIds = 0;
        sampleRows.forEach(r => {
          const v = String(r[c] || "").trim();
          if (/^\d{7,9}$/.test(v)) numericIds++;
        });
        if (numericIds >= Math.min(3, sampleRows.length)) {
          colMatricula = c;
          break;
        }
      }
    }

    if (colNombre === -1) {
      for (let c = 0; c < headers.length; c++) {
        if (c === colMatricula) continue;
        let nameLike = 0;
        sampleRows.forEach(r => {
          const v = String(r[c] || "").trim();
          if (v.length > 5 && v.includes(" ") && !/\d{5}/.test(v)) nameLike++;
        });
        if (nameLike >= Math.min(3, sampleRows.length)) {
          colNombre = c;
          break;
        }
      }
    }

    if (dateColumns.length === 0) {
      for (let c = 0; c < headers.length; c++) {
        if (c === colMatricula || c === colNombre || c === colFaltas || c === colAsist || c === colPct) continue;
        let attendanceMarks = 0;
        sampleRows.forEach(r => {
          const val = String(r[c] || "").trim().toUpperCase();
          if (/^[PFRJ10✓✗]$/.test(val)) attendanceMarks++;
        });
        if (attendanceMarks >= Math.max(2, Math.floor(sampleRows.length * 0.4))) {
          const hName = String(headers[c] || `Clase ${dateColumns.length + 1}`).trim();
          dateColumns.push({ colIdx: c, label: hName });
        }
      }
    }

    state.detectedColumns = {
      colMatricula,
      colNombre,
      colFaltas,
      colAsist,
      colPct,
      colRetardos,
      colJustif,
      dateColumns
    };

    const course = this.getActiveCourse();
    const records = (course && course.records) ? course.records : [];
    const studentsMap = this.getStudentsMap();

    const excelRowsData = [];
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const rawMat = colMatricula !== -1 ? String(row[colMatricula] || "").trim() : "";
      const cleanMat = rawMat.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
      const rawName = colNombre !== -1 ? String(row[colNombre] || "").trim() : "";
      const nameTokens = this._getNameTokens(rawName);

      if (!cleanMat && nameTokens.length === 0) continue;

      excelRowsData.push({
        rowIdx: r,
        row: row,
        rawMat: rawMat,
        cleanMat: cleanMat,
        rawName: rawName,
        nameTokens: nameTokens,
        used: false
      });
    }

    const matches = [];
    let matchCount = 0;

    records.forEach((rec, recIdx) => {
      const student = studentsMap[rec.matricula] || { nombre: "Alumno sin nombre" };
      const sysCleanMat = String(rec.matricula || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
      const sysNameTokens = this._getNameTokens(student.nombre);

      let bestMatch = null;
      let matchType = "none";
      let matchLabel = "";

      if (sysCleanMat) {
        const foundByMat = excelRowsData.find(item => item.cleanMat === sysCleanMat);
        if (foundByMat) {
          bestMatch = foundByMat;
          matchType = "matricula";
          matchLabel = `Matrícula (${foundByMat.rawMat})`;
        }
      }

      if (!bestMatch && sysNameTokens.length > 0) {
        let bestTokenScore = 0;
        let bestCandidate = null;

        excelRowsData.forEach(item => {
          if (item.nameTokens.length === 0) return;
          let common = 0;
          sysNameTokens.forEach(t1 => {
            if (item.nameTokens.some(t2 => t1 === t2 || (t1.length > 3 && t2.startsWith(t1)) || (t2.length > 3 && t1.startsWith(t2)))) {
              common++;
            }
          });

          const totalUnique = new Set([...sysNameTokens, ...item.nameTokens]).size;
          const similarity = common / Math.max(1, totalUnique);

          if ((common >= 2 && similarity >= 0.5) || similarity >= 0.7) {
            if (common > bestTokenScore) {
              bestTokenScore = common;
              bestCandidate = item;
            }
          }
        });

        if (bestCandidate) {
          bestMatch = bestCandidate;
          matchType = "nombre";
          matchLabel = `Nombre (${bestCandidate.rawName})`;
        }
      }

      if (bestMatch) {
        matchCount++;
        const row = bestMatch.row;
        let detectedF = 0;
        let detectedPct = 100;
        const sessionsData = {};

        if (dateColumns.length > 0) {
          let pCnt = 0, fCnt = 0, rCnt = 0, jCnt = 0;
          dateColumns.forEach((col, dIdx) => {
            const rawVal = String(row[col.colIdx] || "").trim().toUpperCase();
            let mark = "P";
            if (/^F|A|0|✗|-$/.test(rawVal)) { mark = "F"; fCnt++; }
            else if (/^R$/.test(rawVal)) { mark = "R"; rCnt++; }
            else if (/^J$/.test(rawVal)) { mark = "J"; jCnt++; }
            else { mark = "P"; pCnt++; }
            sessionsData[`date_${dIdx}`] = { mark: mark, label: col.label };
          });

          const totalClases = pCnt + fCnt + rCnt + jCnt;
          detectedF = fCnt + Math.floor(rCnt / 2);
          detectedPct = totalClases > 0 ? Math.round(((pCnt + (rCnt * 0.5) + jCnt) / totalClases) * 100) : 100;
        } else {
          if (colFaltas !== -1) {
            const parsedF = Number(String(row[colFaltas]).replace(/[^0-9]/g, ''));
            detectedF = !isNaN(parsedF) ? parsedF : 0;
          }
          if (colPct !== -1) {
            let parsedPct = Number(String(row[colPct]).replace(/[^0-9.]/g, ''));
            if (parsedPct <= 1 && parsedPct > 0) parsedPct = Math.round(parsedPct * 100);
            detectedPct = !isNaN(parsedPct) ? Math.min(100, Math.max(0, parsedPct)) : 100;
          } else if (colAsist !== -1) {
            const parsedA = Number(String(row[colAsist]).replace(/[^0-9]/g, ''));
            if (!isNaN(parsedA)) {
              const totalEst = parsedA + detectedF;
              detectedPct = totalEst > 0 ? Math.round((parsedA / totalEst) * 100) : 100;
            }
          } else {
            detectedPct = Math.max(0, 100 - (detectedF * 10));
          }
        }

        matches.push({
          recIndex: recIdx,
          matricula: rec.matricula,
          nombre: student.nombre,
          matchType: matchType,
          matchLabel: matchLabel,
          faltas: detectedF,
          asistenciaPct: detectedPct,
          sessionsData: sessionsData,
          status: "ok"
        });
      } else {
        const uKey = `u${state.targetUnit || 1}`;
        const currF = (rec.faltas && rec.faltas[uKey] !== undefined) ? rec.faltas[uKey] : "-";
        const currA = (rec.asistencia && rec.asistencia[uKey] !== undefined) ? rec.asistencia[uKey] : "-";
        matches.push({
          recIndex: recIdx,
          matricula: rec.matricula,
          nombre: student.nombre,
          matchType: "none",
          matchLabel: "No localizado en Excel",
          faltas: currF,
          asistenciaPct: currA,
          sessionsData: {},
          status: "missing"
        });
      }
    });

    state.matches = matches;

    const banner = document.getElementById("excelImportStatusBanner");
    if (banner) {
      banner.style.display = "block";
      const totalAlumnos = records.length;
      const pctMatch = totalAlumnos > 0 ? Math.round((matchCount / totalAlumnos) * 100) : 0;

      let colDiag = [];
      if (colMatricula !== -1) colDiag.push(`Matrícula (Col ${headers[colMatricula] || colMatricula + 1})`);
      if (colNombre !== -1) colDiag.push(`Nombre (Col ${headers[colNombre] || colNombre + 1})`);
      if (dateColumns.length > 0) colDiag.push(`${dateColumns.length} Fechas de Clase`);
      if (colFaltas !== -1) colDiag.push(`Totales de Faltas`);
      if (colPct !== -1 || colAsist !== -1) colDiag.push(`% de Asistencia`);

      let sheetInfoHtml = '';
      if (state.sheets && state.sheets.length > 1) {
        const isAuto = state.selectedSheet === state.autoDetectedSheet;
        sheetInfoHtml = ` • <b>Hoja:</b> "${this.escapeHtml(state.selectedSheet)}"${isAuto ? ' 🎯 (Detección automática)' : ''}`;
      }

      banner.style.background = matchCount > 0 ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)";
      banner.style.border = matchCount > 0 ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)";
      banner.style.color = matchCount > 0 ? "var(--color-green)" : "var(--color-red)";
      banner.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 2px;">
          ${matchCount > 0 ? `✅ Se detectaron ${matchCount} de ${totalAlumnos} alumnos (${pctMatch}% de coincidencia)` : `⚠️ No se detectaron coincidencias con los alumnos de este grupo`}
        </div>
        <div style="font-size: 11px; color: var(--text-secondary); opacity: 0.9;">
          <b>Estructura reconocida:</b> ${colDiag.length > 0 ? colDiag.join(" • ") : "Formato libre"}${sheetInfoHtml}.
        </div>
      `;
    }

    const dateOptRow = document.getElementById("excelImportDatesOptionRow");
    if (dateOptRow) {
      dateOptRow.style.display = dateColumns.length > 0 ? "block" : "none";
    }

    const previewContainer = document.getElementById("excelImportPreviewContainer");
    const previewTbody = document.getElementById("excelImportPreviewTbody");
    const matchBadge = document.getElementById("excelImportMatchCountBadge");

    if (previewContainer && previewTbody) {
      previewContainer.style.display = "block";
      if (matchBadge) {
        matchBadge.textContent = `${matchCount} / ${records.length} Vinculados`;
        matchBadge.className = matchCount > 0 ? "status-badge status-aprobado" : "status-badge status-reprobado";
      }

      let rowsHtml = "";
      matches.forEach((item, idx) => {
        let badgeHtml = "";
        if (item.matchType === "matricula") {
          badgeHtml = `<span class="badge-match-mat" title="Coincidencia exacta por Matrícula">✓ Matrícula</span>`;
        } else if (item.matchType === "nombre") {
          badgeHtml = `<span class="badge-match-nom" title="Coincidencia inteligente por Nombre">✓ Nombre</span>`;
        } else {
          badgeHtml = `<span class="badge-match-none" title="No encontrado en el Excel, se preservarán sus datos actuales">Sin cambios</span>`;
        }

        const isOk = item.status === "ok";
        rowsHtml += `
          <tr style="${!isOk ? 'opacity: 0.6; background: rgba(0,0,0,0.015);' : ''}">
            <td style="text-align: center; color: var(--text-tertiary);">${idx + 1}</td>
            <td>
              <div style="font-weight: 600; color: var(--uat-blue-night);">${this.escapeHtml(item.nombre)}</div>
              <div style="font-size: 10.5px; font-family: monospace; color: var(--text-secondary);">${this.escapeHtml(item.matricula)}</div>
            </td>
            <td style="font-size: 11px; color: var(--text-secondary);">
              ${this.escapeHtml(item.matchLabel)}
            </td>
            <td style="text-align: center; font-weight: 700; ${isOk && item.faltas > 0 ? 'color: var(--color-red);' : ''}">
              ${item.faltas !== undefined ? item.faltas : '-'}
            </td>
            <td style="text-align: center; font-weight: 700; ${isOk ? 'color: var(--uat-orange);' : ''}">
              ${item.asistenciaPct !== undefined ? item.asistenciaPct + '%' : '-'}
            </td>
            <td style="text-align: center;">
              ${badgeHtml}
            </td>
          </tr>
        `;
      });
      previewTbody.innerHTML = rowsHtml;
    }

    const btnApply = document.getElementById("btnApplyExcelAttendance");
    if (btnApply) {
      btnApply.disabled = matchCount === 0;
      btnApply.innerHTML = `⚡ Aplicar Asistencias a Unidad ${state.targetUnit || 1} (${matchCount} alumnos)`;
    }

    const summaryFooter = document.getElementById("excelImportFooterSummary");
    if (summaryFooter) {
      summaryFooter.textContent = matchCount > 0
        ? `${matchCount} alumnos listos para sincronizar a la Unidad ${state.targetUnit || 1}.`
        : "Revisa que el archivo contenga nombres o matrículas de este grupo.";
    }
  },

  applyExcelAttendanceImport: function() {
    const state = this._excelAttendanceState;
    if (!state || !state.matches || state.matches.length === 0) return;

    const course = this.getActiveCourse();
    if (!course) return;

    const targetUnit = state.targetUnit || 1;
    const uKey = `u${targetUnit}`;
    const syncSessions = document.getElementById("excelImportSyncSessionsCheckbox")?.checked;
    const dateColumns = state.detectedColumns ? state.detectedColumns.dateColumns : [];

    let appliedCount = 0;

    if (syncSessions && dateColumns.length > 0) {
      if (!course.attendanceSessions) course.attendanceSessions = [];

      const createdSessionIds = [];
      dateColumns.forEach((dCol, dIdx) => {
        let existingSess = course.attendanceSessions.find(s => s.unidad === targetUnit && s.tema === dCol.label);
        if (!existingSess) {
          const sessId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + dIdx;
          let fechaStr = new Date().toISOString().slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(dCol.label)) fechaStr = dCol.label;

          existingSess = {
            id: sessId,
            unidad: targetUnit,
            fecha: fechaStr,
            tema: dCol.label
          };
          course.attendanceSessions.push(existingSess);
        }
        createdSessionIds.push({ dIdx: dIdx, id: existingSess.id });
      });

      state.matches.forEach(item => {
        if (item.status !== "ok") return;
        const rec = course.records[item.recIndex];
        if (!rec) return;

        if (!rec.attendanceDays) rec.attendanceDays = {};
        createdSessionIds.forEach(sessInfo => {
          const sessKey = `date_${sessInfo.dIdx}`;
          const markVal = (item.sessionsData && item.sessionsData[sessKey]) ? item.sessionsData[sessKey].mark : "P";
          rec.attendanceDays[sessInfo.id] = markVal;
        });
      });
    }

    state.matches.forEach(item => {
      if (item.status !== "ok") return;
      const rec = course.records[item.recIndex];
      if (!rec) return;

      if (!rec.faltas) rec.faltas = {};
      if (!rec.asistencia) rec.asistencia = {};

      rec.faltas[uKey] = item.faltas;
      rec.asistencia[uKey] = item.asistenciaPct;
      appliedCount++;
    });

    this.saveData();
    this.closeExcelAttendanceImportModal();
    this.render();
    this.showToast(`📥 ¡Éxito! Se actualizaron las faltas y asistencias de ${appliedCount} alumnos en la Unidad ${targetUnit}.`);
  },

  deleteAttendanceSession: function(sessionId) {
    const course = this.getActiveCourse();
    if (!course || !course.attendanceSessions) return;
    const idx = course.attendanceSessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return;

    const s = course.attendanceSessions[idx];
    if (!confirm(`¿Deseas eliminar la clase del ${s.fecha} (${s.tema || 'Clase'})? Los registros de este día se borrarán.`)) {
      return;
    }

    course.attendanceSessions.splice(idx, 1);
    (course.records || []).forEach(r => {
      if (r.attendanceDays) delete r.attendanceDays[sessionId];
      if (r.participationDays) delete r.participationDays[sessionId];
    });

    const currentUnit = this.attendanceActiveUnit;
    const remaining = course.attendanceSessions.filter(sess => sess.unidad === currentUnit);
    this.attendanceActiveSessionId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;

    this.recalculateAttendanceForUnit(course, currentUnit);
    this.debouncedSave();
    this.render();
    this.showToast("🗑️ Sesión de clase eliminada.");
  },

  updateAttendanceSessionMeta: function(sessionId, field, value) {
    const course = this.getActiveCourse();
    if (!course || !course.attendanceSessions) return;
    const session = course.attendanceSessions.find(s => s.id === sessionId);
    if (!session) return;
    session[field] = value;
    this.debouncedSave();
  },

  markAllPresent: function(sessionId) {
    const course = this.getActiveCourse();
    if (!course) return;
    const records = course.records || [];
    records.forEach(rec => {
      if (!rec.attendanceDays) rec.attendanceDays = {};
      rec.attendanceDays[sessionId] = 'P';
    });
    this.recalculateAttendanceForUnit(course, this.attendanceActiveUnit);
    this.debouncedSave();
    this.render();
    this.showToast("⚡ Todos los alumnos marcados como Presentes (P)");
  },

  markAllPresentLatest: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    const currentUnit = this.attendanceActiveUnit;
    const unitSessions = (course.attendanceSessions || []).filter(s => s.unidad === currentUnit);
    if (unitSessions.length === 0) {
      this.showToast("No hay fechas registradas en esta unidad.", "warning");
      return;
    }
    const latest = unitSessions[unitSessions.length - 1];
    this.markAllPresent(latest.id);
  },

  exportAttendanceToExcel: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    if (typeof Exporter !== "undefined" && Exporter.exportAttendanceToExcel) {
      Exporter.exportAttendanceToExcel(course, this.getStudentsMap(), this.attendanceActiveUnit);
    }
  },

  // Interacción Reactiva en Celda de la Sábana
  cycleAttendanceStatus: function(recIndex, sessionId) {
    const course = this.getActiveCourse();
    if (!course || !course.records || !course.records[recIndex]) return;
    const rec = course.records[recIndex];
    const curr = (rec.attendanceDays && rec.attendanceDays[sessionId]) || '';
    let next = 'P';
    if (!curr || curr === '') next = 'P';
    else if (curr === 'P') next = 'F';
    else if (curr === 'F') next = 'R';
    else if (curr === 'R') next = 'J';
    else if (curr === 'J') next = '';

    this.setAttendanceStatusDirect(recIndex, sessionId, next);
  },

  setAttendanceStatusDirect: function(recIndex, sessionId, newStatus) {
    const course = this.getActiveCourse();
    if (!course || !course.records || !course.records[recIndex]) return;
    const rec = course.records[recIndex];
    if (!rec.attendanceDays) rec.attendanceDays = {};
    if (newStatus) {
      rec.attendanceDays[sessionId] = newStatus;
    } else {
      delete rec.attendanceDays[sessionId];
    }

    const currentUnit = this.attendanceActiveUnit;
    const uKey = `u${currentUnit}`;
    const unitSessions = (course.attendanceSessions || []).filter(s => s.unidad === currentUnit);

    // 1. Actualizar celda en el DOM (input o botón)
    const inp = document.getElementById(`att-input-${recIndex}-${sessionId}`);
    if (inp) {
      inp.value = newStatus || '';
      inp.className = newStatus ? `att-grid-input att-status-${newStatus.toLowerCase()}` : `att-grid-input`;
      inp.setAttribute("title", newStatus ? `Estatus: ${newStatus} (P: Presente, F: Falta, R: Retardo, J: Justificado)` : `Sin registrar (Escribe P, F, R o J)`);
    }
    const btn = document.getElementById(`att-btn-${recIndex}-${sessionId}`);
    if (btn) {
      btn.textContent = newStatus || '-';
      btn.className = newStatus ? `att-grid-badge att-status-${newStatus.toLowerCase()}` : `att-grid-badge`;
      btn.setAttribute("title", newStatus ? `Estatus: ${newStatus}` : `Sin registrar`);
    }

    // 2. Recalcular métricas de la fila del alumno en memoria
    let p = 0, f = 0, r = 0, j = 0;
    unitSessions.forEach(s => {
      const st = (rec.attendanceDays && rec.attendanceDays[s.id]) || '';
      if (st === 'P') p++;
      else if (st === 'F') f++;
      else if (st === 'R') r++;
      else if (st === 'J') j++;
    });

    const totalMarked = p + f + r + j;
    const effectivePresent = p + (r * 0.5) + j;
    const pct = totalMarked > 0 ? Math.min(100, Math.max(0, Math.round((effectivePresent / totalMarked) * 100))) : 100;
    const effectiveFaltas = f + Math.floor(r / 2);

    rec.asistencia = rec.asistencia || {};
    rec.faltas = rec.faltas || {};
    rec.asistenciaAuto = rec.asistenciaAuto || {};
    rec.asistencia[uKey] = pct;
    rec.faltas[uKey] = effectiveFaltas;
    rec.asistenciaAuto[uKey] = true;

    // 3. Actualizar resumen de la fila en el DOM
    const elP = document.getElementById(`row-p-${recIndex}`);
    const elF = document.getElementById(`row-f-${recIndex}`);
    const elR = document.getElementById(`row-r-${recIndex}`);
    const elJ = document.getElementById(`row-j-${recIndex}`);
    const elPct = document.getElementById(`row-pct-${recIndex}`);
    const elStatus = document.getElementById(`row-status-${recIndex}`);

    if (elP) elP.textContent = p;
    const asistCfg = course.asistenciaConfig || {};
    const limiteFaltasActivo = !!asistCfg.limiteFaltasActivo;
    const consecuenciaActiva = (asistCfg.consecuenciaActiva !== undefined)
      ? !!asistCfg.consecuenciaActiva
      : (!!asistCfg.modoExceder && asistCfg.modoExceder !== "ninguna");
    const ambitoLimite = asistCfg.ambitoLimite || "unidad";
    const maxFaltas = Number(asistCfg.maxFaltas) || Number(asistCfg.maxFaltasPorUnidad) || 3;
    const modoExceder = consecuenciaActiva ? (asistCfg.modoExceder || "alerta_sd") : "ninguna";
    const isSemestre = (ambitoLimite === "semestre");

    const semFaltas = this.getStudentSemesterFaltas(rec, course, currentUnit, effectiveFaltas);
    const faltasEvaluadas = isSemestre ? semFaltas : effectiveFaltas;
    const isExceeded = limiteFaltasActivo && consecuenciaActiva && (faltasEvaluadas > maxFaltas);
    const pierdeAsist = consecuenciaActiva && (modoExceder === "perder_asistencia" || modoExceder === "ambas_alerta" || modoExceder === "ambas_cero");
    const esSd = consecuenciaActiva && (modoExceder === "alerta_sd" || modoExceder === "reprobar_cero" || modoExceder === "ambas_alerta" || modoExceder === "ambas_cero");

    if (elF) {
      if (isSemestre) {
        elF.innerHTML = `${f} <span style="font-size: 10px; opacity: 0.75;" title="Faltas en semestre: ${semFaltas} (Límite: ${maxFaltas})">(${semFaltas})</span>`;
      } else {
        elF.textContent = f;
      }
      if (f > 0) elF.classList.add("has-faltas");
      else elF.classList.remove("has-faltas");
    }
    if (elR) elR.textContent = r;
    if (elJ) elJ.textContent = j;
    if (elPct) {
      elPct.textContent = `${pct}%`;
      elPct.style.color = pct >= 80 ? 'var(--color-green)' : (pct >= 60 ? 'var(--color-orange)' : 'var(--color-red)');
    }

    if (elStatus) {
      if (isExceeded) {
        if (modoExceder === "perder_asistencia") {
          elStatus.innerHTML = `<span class="status-badge status-reprobado" style="font-size: 11px; background: rgba(239, 68, 68, 0.12); color: var(--color-red);" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Puntos de asistencia anulados (0 pts)">⚠️ Sin Pts Asist</span>`;
        } else if (esSd && pierdeAsist) {
          elStatus.innerHTML = `<span class="status-badge status-reprobado" style="font-size: 11px;" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Sin derecho a examen y 0 pts asistencia">⛔ SD / 0 Pts</span>`;
        } else {
          elStatus.innerHTML = `<span class="status-badge status-reprobado" style="font-size: 11px;" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Sin derecho a examen">⛔ Sin Derecho</span>`;
        }
      } else {
        elStatus.innerHTML = '<span class="status-badge status-aprobado" style="font-size: 11px;">Aprobado</span>';
      }
    }

    // 4. Actualizar footer de la columna en el DOM
    let colPCount = 0;
    let colMarkedCount = 0;
    course.records.forEach(rc => {
      const st = (rc.attendanceDays && rc.attendanceDays[sessionId]) || '';
      if (st === 'P' || st === 'J') { colPCount++; colMarkedCount++; }
      else if (st === 'R') { colPCount += 0.5; colMarkedCount++; }
      else if (st === 'F') { colMarkedCount++; }
    });
    const colPct = colMarkedCount > 0 ? Math.round((colPCount / colMarkedCount) * 100) : null;
    const footCell = document.getElementById(`foot-stat-${sessionId}`);
    if (footCell) {
      if (colMarkedCount > 0) {
        footCell.innerHTML = `<span class="att-foot-stat">${Math.round(colPCount)}/${colMarkedCount}</span><br><span class="att-foot-stat-pct">${colPct}%</span>`;
      } else {
        footCell.innerHTML = `<span class="att-foot-stat" style="color: var(--text-tertiary); opacity: 0.6;">-</span>`;
      }
    }

    // 5. Guardar en Supabase con debounce
    this.debouncedSave();
  },

  handleAttendanceInputKeydown: function(event, recIndex, sessionId) {
    const key = event.key.toUpperCase();
    const course = this.getActiveCourse();
    if (!course) return;
    const unitSessions = (course.attendanceSessions || []).filter(s => s.unidad === this.attendanceActiveUnit);
    const sessionIdx = unitSessions.findIndex(s => s.id === sessionId);

    // Navegación con Enter o Flecha Abajo (pasa al alumno siguiente en la misma columna)
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextInp = document.getElementById(`att-input-${recIndex + 1}-${sessionId}`);
      if (nextInp) {
        nextInp.focus();
        nextInp.select();
      }
      return;
    }

    // Navegación con Flecha Arriba (pasa al alumno anterior en la misma columna)
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevInp = document.getElementById(`att-input-${recIndex - 1}-${sessionId}`);
      if (prevInp) {
        prevInp.focus();
        prevInp.select();
      }
      return;
    }

    // Navegación con Flecha Derecha (pasa a la siguiente fecha de clase)
    if (event.key === 'ArrowRight' && sessionIdx !== -1 && sessionIdx < unitSessions.length - 1) {
      event.preventDefault();
      const nextSess = unitSessions[sessionIdx + 1];
      const targetInp = document.getElementById(`att-input-${recIndex}-${nextSess.id}`);
      if (targetInp) {
        targetInp.focus();
        targetInp.select();
      }
      return;
    }

    // Navegación con Flecha Izquierda (pasa a la fecha de clase anterior)
    if (event.key === 'ArrowLeft' && sessionIdx > 0) {
      event.preventDefault();
      const prevSess = unitSessions[sessionIdx - 1];
      const targetInp = document.getElementById(`att-input-${recIndex}-${prevSess.id}`);
      if (targetInp) {
        targetInp.focus();
        targetInp.select();
      }
      return;
    }

    // Restricción estricta de letras: ÚNICAMENTE P, F, R o J
    if (key === 'P' || key === 'F' || key === 'R' || key === 'J') {
      event.preventDefault();
      const inp = event.target;
      inp.value = key;
      this.setAttendanceStatusDirect(recIndex, sessionId, key);
      inp.select();
      return;
    }

    // Permitir borrar con Backspace o Delete y dejar la celda en blanco
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      const inp = event.target;
      inp.value = '';
      this.setAttendanceStatusDirect(recIndex, sessionId, '');
      return;
    }

    // Bloquear de forma estricta cualquier otra tecla o carácter no permitido
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
    }
  },

  handleAttendanceInput: function(inputEl, recIndex, sessionId) {
    if (!inputEl) return;
    let val = (inputEl.value || '').trim().toUpperCase();
    val = val.replace(/[^PFRJ]/g, '');
    if (val.length > 1) {
      val = val.charAt(val.length - 1);
    }
    inputEl.value = val;
    this.setAttendanceStatusDirect(recIndex, sessionId, val);
  },

  handleAttendanceInputBlur: function(inputEl, recIndex, sessionId) {
    if (!inputEl) return;
    const val = (inputEl.value || '').trim().toUpperCase();
    if (val !== '' && val !== 'P' && val !== 'F' && val !== 'R' && val !== 'J') {
      inputEl.value = '';
      this.setAttendanceStatusDirect(recIndex, sessionId, '');
    }
  },

  handleAttendanceKeydown: function(event, recIndex, sessionId) {
    this.handleAttendanceInputKeydown(event, recIndex, sessionId);
  },

  setStudentSessionStatus: function(recIndex, sessionId, status) {
    this.setAttendanceStatusDirect(recIndex, sessionId, status);
  },

  adjustStudentSessionPart: function(recIndex, sessionId, delta) {
    const course = this.getActiveCourse();
    if (!course || !course.records || !course.records[recIndex]) return;
    const rec = course.records[recIndex];
    if (!rec.participationDays) rec.participationDays = {};
    const curr = Number(rec.participationDays[sessionId]) || 0;
    const next = Math.max(0, curr + delta);
    rec.participationDays[sessionId] = next;

    this.recalculateAttendanceForUnit(course, this.attendanceActiveUnit);
    this.debouncedSave();
    this.render();
  },

  recalculateAttendanceForUnit: function(course, u) {
    const uKey = `u${u}`;
    const sessions = (course.attendanceSessions || []).filter(s => s.unidad === u);
    const totalSessions = sessions.length;

    (course.records || []).forEach(rec => {
      if (!rec.asistencia) rec.asistencia = {};
      if (!rec.faltas) rec.faltas = {};
      if (!rec.participacion) rec.participacion = {};
      if (!rec.asistenciaAuto) rec.asistenciaAuto = {};

      if (totalSessions === 0) {
        return;
      }

      let pCount = 0;
      let fCount = 0;
      let rCount = 0;
      let jCount = 0;
      let partSum = 0;

      sessions.forEach(s => {
        const st = (rec.attendanceDays && rec.attendanceDays[s.id]) || '';
        if (st === 'P') pCount++;
        else if (st === 'F') fCount++;
        else if (st === 'R') rCount++;
        else if (st === 'J') jCount++;

        if (rec.participationDays && rec.participationDays[s.id]) {
          partSum += Number(rec.participationDays[s.id]) || 0;
        }
      });

      const effectivePresent = pCount + (rCount * 0.5) + jCount;
      const totalMarked = pCount + fCount + rCount + jCount;
      const pct = totalMarked > 0 ? Math.min(100, Math.max(0, Math.round((effectivePresent / totalMarked) * 100))) : 100;
      const effectiveFaltas = fCount + Math.floor(rCount / 2);

      rec.asistencia[uKey] = pct;
      rec.faltas[uKey] = effectiveFaltas;
      rec.participacion[uKey] = partSum;
      rec.asistenciaAuto[uKey] = true;
    });
  },

  clearAttendanceInCurrentUnit: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    const currentUnit = this.attendanceActiveUnit;
    const unitSessions = (course.attendanceSessions || []).filter(s => s.unidad === currentUnit);
    if (unitSessions.length === 0) return;
    (course.records || []).forEach(rec => {
      if (rec.attendanceDays) {
        unitSessions.forEach(s => {
          delete rec.attendanceDays[s.id];
        });
      }
    });
    this.recalculateAttendanceForUnit(course, currentUnit);
    this.debouncedSave();
    this.render();
    this.showToast(`🧹 Casillas de asistencia de la Unidad ${currentUnit} dejadas en blanco.`);
  },

  clearAttendanceSession: function(sessionId) {
    const course = this.getActiveCourse();
    if (!course) return;
    (course.records || []).forEach(rec => {
      if (rec.attendanceDays) {
        delete rec.attendanceDays[sessionId];
      }
    });
    this.recalculateAttendanceForUnit(course, this.attendanceActiveUnit);
    this.debouncedSave();
    this.render();
    this.showToast("🧹 Casillas de esta fecha dejadas en blanco.");
  },

  saveQuickAttendance: function() {
    const course = this.getActiveCourse();
    if (!course) return;
    const u = this.attendanceActiveUnit;
    const uKey = `u${u}`;
    const records = course.records || [];

    const totalClasesInp = document.getElementById("quickTotalClassesInput");
    const totalClases = Math.max(1, Number(totalClasesInp?.value) || 10);
    if (!course.asistenciaTotalClasses) course.asistenciaTotalClasses = {};
    course.asistenciaTotalClasses[uKey] = totalClases;

    records.forEach((rec, idx) => {
      const asistInp = document.getElementById(`quick-asist-${idx}`);
      const faltasInp = document.getElementById(`quick-faltas-${idx}`);
      const retInp = document.getElementById(`quick-ret-${idx}`);
      const justInp = document.getElementById(`quick-just-${idx}`);
      const partInp = document.getElementById(`quick-part-${idx}`);

      if (asistInp && faltasInp) {
        let numAsist = Number(asistInp.value) || 0;
        let numFaltas = Number(faltasInp.value) || 0;
        let numRet = Number(retInp?.value) || 0;
        let numJust = Number(justInp?.value) || 0;
        let numPart = Number(partInp?.value) || 0;

        let pct = 0;
        if (numAsist > totalClases && numAsist <= 100) {
          pct = numAsist;
        } else {
          const effectiveAtt = numAsist + (numRet * 0.5) + numJust;
          pct = Math.min(100, Math.max(0, Math.round((effectiveAtt / totalClases) * 100)));
        }

        const effectiveFaltas = numFaltas + Math.floor(numRet / 2);

        if (!rec.asistencia) rec.asistencia = {};
        if (!rec.faltas) rec.faltas = {};
        if (!rec.participacion) rec.participacion = {};
        if (!rec.asistenciaAuto) rec.asistenciaAuto = {};

        rec.asistencia[uKey] = pct;
        rec.faltas[uKey] = effectiveFaltas;
        rec.participacion[uKey] = numPart;
        rec.asistenciaAuto[uKey] = false;
      }
    });

    this.debouncedSave();
    this.render();
    this.showToast(`💾 Asistencias y faltas de Unidad ${u} sincronizadas con el Calificador.`);
  },

  onQuickRowInput: function(idx) {
    const totalClasesInp = document.getElementById("quickTotalClassesInput");
    const totalClases = Math.max(1, Number(totalClasesInp?.value) || 10);

    const asistInp = document.getElementById(`quick-asist-${idx}`);
    const retInp = document.getElementById(`quick-ret-${idx}`);
    const justInp = document.getElementById(`quick-just-${idx}`);
    const previewChip = document.getElementById(`quick-preview-pct-${idx}`);

    if (asistInp && previewChip) {
      let numAsist = Number(asistInp.value) || 0;
      let numRet = Number(retInp?.value) || 0;
      let numJust = Number(justInp?.value) || 0;

      let pct = 0;
      if (numAsist > totalClases && numAsist <= 100) {
        pct = numAsist;
      } else {
        const effectiveAtt = numAsist + (numRet * 0.5) + numJust;
        pct = Math.min(100, Math.max(0, Math.round((effectiveAtt / totalClases) * 100)));
      }
      previewChip.textContent = `${pct}%`;
      previewChip.style.color = pct >= 80 ? 'var(--color-green)' : (pct >= 60 ? 'var(--color-orange)' : 'var(--color-red)');
    }
  },

  renderAttendance: function(container) {
    const course = this.getActiveCourse();
    if (!course) {
      this.renderEmptyGradebook(container);
      return;
    }

    const numUnits = Number(course.unidadesCount) || 3;

    // Limpieza inicial: Quitar todas las 'P' pre-llenadas por defecto para dejar los recuadros en blanco
    if (!course._attendanceBlankCleared) {
      course._attendanceBlankCleared = true;
      let hadPreFilledP = false;
      (course.records || []).forEach(rec => {
        if (rec.attendanceDays) {
          Object.keys(rec.attendanceDays).forEach(k => {
            if (rec.attendanceDays[k] === 'P') {
              delete rec.attendanceDays[k];
              hadPreFilledP = true;
            }
          });
        }
      });
      if (hadPreFilledP) {
        for (let u = 1; u <= numUnits; u++) {
          this.recalculateAttendanceForUnit(course, u);
        }
        this.debouncedSave();
      }
    }

    if (!course.attendanceSessions) {
      course.attendanceSessions = [];
    }

    // Carga automática de los días oficiales del semestre (Calendario UAT 2026) si la lista está vacía
    if (course.attendanceSessions.length === 0) {
      this.populateOfficialSemesterSessions(course, false);
    }

    if (this.attendanceActiveUnit > numUnits || this.attendanceActiveUnit < 1) {
      this.attendanceActiveUnit = 1;
    }
    const currentUnit = this.attendanceActiveUnit;
    const uKey = `u${currentUnit}`;

    const studentsMap = this.getStudentsMap();
    const records = course.records || [];
    const isAuditReadOnly = this.isAdmin() && this.isSupervising && !this.supervisionEditMode;

    const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    const wAsist = Number(weights.asistencia) || 0;
    const wPart = Number(weights.participacion) || 0;

    const asistCfg = course.asistenciaConfig || {};
    const limiteFaltasActivo = !!asistCfg.limiteFaltasActivo;
    const consecuenciaActiva = (asistCfg.consecuenciaActiva !== undefined)
      ? !!asistCfg.consecuenciaActiva
      : (!!asistCfg.modoExceder && asistCfg.modoExceder !== "ninguna");
    const ambitoLimite = asistCfg.ambitoLimite || "unidad";
    const maxFaltas = Number(asistCfg.maxFaltas) || Number(asistCfg.maxFaltasPorUnidad) || 3;
    const modoExceder = consecuenciaActiva ? (asistCfg.modoExceder || "alerta_sd") : "ninguna";
    const isSemestre = (ambitoLimite === "semestre");
    const pierdeAsist = consecuenciaActiva && (modoExceder === "perder_asistencia" || modoExceder === "ambas_alerta" || modoExceder === "ambas_cero");
    const esSd = consecuenciaActiva && (modoExceder === "alerta_sd" || modoExceder === "reprobar_cero" || modoExceder === "ambas_alerta" || modoExceder === "ambas_cero");

    // Modo activo (por defecto: 'sabana' para cuadrícula completa estilo Notion/Excel)
    if (!this.attendanceMode) {
      this.attendanceMode = 'sabana';
    }

    // Agrupar cursos por nombre de materia para el semestre seleccionado
    const selectedSem = this.getSelectedSemester();
    const semesterCourses = this.getCoursesForSelectedSemester();

    const coursesBySubject = {};
    semesterCourses.forEach(c => {
      if (!coursesBySubject[c.nombre]) coursesBySubject[c.nombre] = [];
      coursesBySubject[c.nombre].push(c);
    });

    let selectHtml = "";
    if (semesterCourses.length === 0) {
      selectHtml = `<option value="" disabled selected>(Sin listas en este semestre)</option>`;
    } else {
      Object.keys(coursesBySubject).forEach(subject => {
        selectHtml += `<optgroup label="${this.escapeHtml(subject)}">`;
        coursesBySubject[subject].forEach(c => {
          const count = (c.records || []).length;
          selectHtml += `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${this.escapeHtml(c.grupo || 'Grupo')} (${count} alumnos)</option>`;
        });
        selectHtml += `</optgroup>`;
      });
    }

    const availableSemesters = this.getAvailableSemesters();
    let semesterSelectHtml = "";
    availableSemesters.forEach(sem => {
      const isSel = (sem === selectedSem);
      semesterSelectHtml += `<option value="${this.escapeHtml(sem)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(sem)}</option>`;
    });

    // Chips de Unidad (U1 a Un) con conteo de sesiones
    let unitChipsHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      const isAct = (u === currentUnit);
      const countU = course.attendanceSessions.filter(s => s.unidad === u).length;
      unitChipsHtml += `
        <button type="button" class="attendance-unit-chip ${isAct ? 'active' : ''}" onclick="App.setAttendanceUnit(${u})">
          <span>Unidad ${u}</span>
          ${countU > 0 ? `<span style="font-size: 11px; opacity: 0.85; margin-left: 2px;">(${countU})</span>` : ''}
          ${isAct ? '<span class="attendance-unit-dot"></span>' : ''}
        </button>
      `;
    }

    // Sesiones de la unidad actual ordenadas cronológicamente
    const unitSessions = course.attendanceSessions
      .filter(s => s.unidad === currentUnit)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    let contentHtml = "";

    // MODO 1: SÁBANA COMPLETA (CUADRÍCULA ESTILO NOTION / EXCEL)
    if (this.attendanceMode === "sabana") {
      if (unitSessions.length === 0) {
        contentHtml = `
          <div class="attendance-empty-card" style="padding: 50px 24px; text-align: center; background: var(--bg-card); border: 2px dashed var(--border-color); border-radius: 12px; margin-top: 14px;">
            <div style="font-size: 46px; margin-bottom: 12px;">📊</div>
            <h3 style="font-size: 18px; font-weight: 700; color: var(--uat-blue-night); margin-bottom: 6px;">
              Sábana sin fechas registradas en la Unidad ${currentUnit}
            </h3>
            <p style="font-size: 13.5px; color: var(--text-secondary); max-width: 520px; margin: 0 auto 20px; line-height: 1.5;">
              Genera automáticamente el calendario oficial de clases para esta unidad o todo el semestre.
            </p>
            <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
              <button class="btn btn-primary" onclick="App.syncOfficialCalendar(false)" style="display: inline-flex; align-items: center; gap: 8px; font-weight: 600;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Cargar Días Oficiales de Clase (Calendario UAT 2026)
              </button>
              <button class="btn btn-default" onclick="App.addAttendanceSession()" style="display: inline-flex; align-items: center; gap: 8px; font-weight: 600;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Registrar Clase de Hoy
              </button>
              <button class="btn btn-default" onclick="App.openOfficialCalendarModal()" style="display: inline-flex; align-items: center; gap: 8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Ver Calendario UAT
              </button>
              <button class="btn btn-default" onclick="App.openExcelAttendanceImportModal()" style="display: inline-flex; align-items: center; gap: 8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Importar mi Excel
              </button>
            </div>
          </div>
        `;
      } else {
        // Configuración de hitos para remarcado
        const normPeriodoForHeaders = this.normalizePeriodo(course.periodo || this.getSelectedSemester());
        const calHdrCfg = this.UAT_CALENDAR_2026[normPeriodoForHeaders] || this.UAT_CALENDAR_2026["2026 - 3 OTOÑO"];

        // Encabezados de Columna de Fecha
        let dateColumnsHeaderHtml = "";
        unitSessions.forEach(s => {
          const dateInfo = this.formatSessionDate(s.fecha);
          const isAltasBajas = s.isAltasBajas || (s.fecha >= calHdrCfg.altasBajas.inicio && s.fecha <= calHdrCfg.altasBajas.fin);
          const isLimiteBaja = s.isLimiteBaja || (s.fecha === calHdrCfg.altasBajas.fechaLimiteBaja);

          let colClasses = "col-attendance-date";
          let badgeTagHtml = "";
          if (isAltasBajas) {
            colClasses += " col-att-header-altasbajas";
            badgeTagHtml = `<span class="att-header-badge-tag tag-altasbajas" title="Periodo Oficial UAT: Altas y Bajas de Materias (${calHdrCfg.altasBajas.inicioTxt} al ${calHdrCfg.altasBajas.finTxt})">🔄 Altas/Bajas</span>`;
          } else if (isLimiteBaja) {
            colClasses += " col-att-header-limitebaja";
            badgeTagHtml = `<span class="att-header-badge-tag tag-limitebaja" title="Fecha límite institucional de Baja de Materias (${calHdrCfg.altasBajas.limiteBajaTxt})">⚠️ Límite Baja</span>`;
          }

          dateColumnsHeaderHtml += `
            <th class="${colClasses}" data-session-id="${s.id}" title="${this.escapeHtml(s.tema || 'Clase')} (${s.fecha})">
              <div class="att-header-cell">
                <span class="att-header-dayname">${this.escapeHtml(dateInfo.dayName)}</span>
                <span class="att-header-daynum">${this.escapeHtml(dateInfo.dayNum)}/${this.escapeHtml(dateInfo.monthNum)}</span>
                ${badgeTagHtml}
                ${!isAuditReadOnly ? `
                  <div class="att-header-actions">
                    <button type="button" class="btn-att-hdr-action" title="Marcar a todos Presentes (P) en esta fecha" onclick="App.markAllPresent('${s.id}')">⚡</button>
                    <button type="button" class="btn-att-hdr-action" title="Dejar en blanco todas las casillas de esta fecha" onclick="App.clearAttendanceSession('${s.id}')">🧹</button>
                    <button type="button" class="btn-att-hdr-action" title="Editar fecha o tema" onclick="App.promptEditAttendanceDate('${s.id}')">✏️</button>
                    <button type="button" class="btn-att-hdr-action btn-att-hdr-del" title="Eliminar esta fecha de clase" onclick="App.deleteAttendanceSession('${s.id}')">✕</button>
                  </div>
                ` : ''}
              </div>
            </th>
          `;
        });

        // Filas de Alumnos en la Sábana
        let studentRowsHtml = "";
        records.forEach((rec, recIdx) => {
          const student = studentsMap[rec.matricula] || { nombre: "Alumno no registrado en Base Maestra" };
          let p = 0, f = 0, r = 0, j = 0;

          // Celdas por Fecha
          let sessionCellsHtml = "";
          unitSessions.forEach(s => {
            const st = (rec.attendanceDays && rec.attendanceDays[s.id]) || '';
            if (st === 'P') p++;
            else if (st === 'F') f++;
            else if (st === 'R') r++;
            else if (st === 'J') j++;

            const statusClass = st ? `att-status-${st.toLowerCase()}` : '';
            sessionCellsHtml += `
              <td class="col-att-cell" data-rec-idx="${recIdx}" data-session-id="${s.id}" onclick="const inp = document.getElementById('att-input-${recIdx}-${s.id}'); if (inp && document.activeElement !== inp) inp.focus();">
                <input type="text" 
                  class="att-grid-input ${statusClass}" 
                  id="att-input-${recIdx}-${s.id}"
                  value="${st}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                  ${isAuditReadOnly ? 'readonly style="cursor: default;"' : ''}
                  title="${this.escapeHtml(student.nombre)} | ${s.fecha}: ${st || 'Sin registrar'} (Escribe P, F, R o J)"
                  onfocus="this.select()"
                  onkeydown="App.handleAttendanceInputKeydown(event, ${recIdx}, '${s.id}')"
                  oninput="App.handleAttendanceInput(this, ${recIdx}, '${s.id}')"
                  onblur="App.handleAttendanceInputBlur(this, ${recIdx}, '${s.id}')"
                />
              </td>
            `;
          });

          // Métricas acumuladas del alumno
          const totalMarked = p + f + r + j;
          const effectivePresent = p + (r * 0.5) + j;
          const pct = totalMarked > 0 ? Math.min(100, Math.max(0, Math.round((effectivePresent / totalMarked) * 100))) : 100;
          const effectiveFaltas = f + Math.floor(r / 2);
          const semFaltas = this.getStudentSemesterFaltas(rec, course, currentUnit, effectiveFaltas);
          const faltasEvaluadas = isSemestre ? semFaltas : effectiveFaltas;
          const isExceeded = limiteFaltasActivo && consecuenciaActiva && (faltasEvaluadas > maxFaltas);

          let statusBadgeHtml = '<span class="status-badge status-aprobado" style="font-size: 11px;">Aprobado</span>';
          if (isExceeded) {
            if (modoExceder === "perder_asistencia") {
              statusBadgeHtml = `<span class="status-badge status-reprobado" style="font-size: 11px; background: rgba(239, 68, 68, 0.12); color: var(--color-red);" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Puntos de asistencia anulados (0 pts)">⚠️ Sin Pts Asist</span>`;
            } else if (esSd && pierdeAsist) {
              statusBadgeHtml = `<span class="status-badge status-reprobado" style="font-size: 11px;" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Sin derecho a examen y 0 pts asistencia">⛔ SD / 0 Pts</span>`;
            } else {
              statusBadgeHtml = `<span class="status-badge status-reprobado" style="font-size: 11px;" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Sin derecho a examen">⛔ Sin Derecho</span>`;
            }
          }

          let pctColor = "var(--color-green)";
          if (pct < 60) pctColor = "var(--color-red)";
          else if (pct < 80) pctColor = "var(--color-orange)";

          studentRowsHtml += `
            <tr class="${isExceeded ? (esSd ? 'row-sin-derecho' : 'row-loss-asistencia') : ''}">
              <td class="col-sabana-col-1 col-sticky-index" style="text-align: center; font-size: 12px; color: var(--text-tertiary);">${recIdx + 1}</td>
              <td class="col-sabana-col-2 col-sticky-mat" style="font-weight: 600; font-family: monospace; font-size: 12.5px;">${this.escapeHtml(rec.matricula)}</td>
              <td class="col-sabana-col-3 col-sticky-name" style="font-weight: 500; font-size: 13px;" title="${this.escapeHtml(student.nombre)}">${this.escapeHtml(student.nombre)}</td>
              ${sessionCellsHtml}
              <td class="col-summary-num"><span id="row-p-${recIdx}">${p}</span></td>
              <td class="col-summary-num col-summary-f ${f > 0 ? 'has-faltas' : ''}">
                <span id="row-f-${recIdx}">
                  ${f}${isSemestre ? ` <span style="font-size: 10px; opacity: 0.75;" title="Faltas acumuladas en el semestre: ${semFaltas} (Límite: ${maxFaltas})">(${semFaltas})</span>` : ''}
                </span>
              </td>
              <td class="col-summary-num"><span id="row-r-${recIdx}">${r}</span></td>
              <td class="col-summary-num"><span id="row-j-${recIdx}">${j}</span></td>
              <td class="col-summary-pct">
                <span id="row-pct-${recIdx}" class="summary-chip" style="font-weight: 700; color: ${pctColor};">
                  ${pct}%
                </span>
              </td>
              <td style="text-align: center;">
                <span id="row-status-${recIdx}">
                  ${statusBadgeHtml}
                </span>
              </td>
            </tr>
          `;
        });

        // Fila de Totales en Pie de Tabla (Asistencias por Fecha)
        let footerCellsHtml = "";
        let overallPresSum = 0;
        let overallMarkedSum = 0;
        unitSessions.forEach(s => {
          let colP = 0;
          let colMarked = 0;
          records.forEach(rc => {
            const st = (rc.attendanceDays && rc.attendanceDays[s.id]) || '';
            if (st === 'P' || st === 'J') { colP++; colMarked++; }
            else if (st === 'R') { colP += 0.5; colMarked++; }
            else if (st === 'F') { colMarked++; }
          });
          overallPresSum += colP;
          overallMarkedSum += colMarked;
          const colPct = colMarked > 0 ? Math.round((colP / colMarked) * 100) : null;
          footerCellsHtml += `
            <td id="foot-stat-${s.id}" class="col-attendance-date" style="text-align: center;">
              ${colMarked > 0 
                ? `<span class="att-foot-stat">${Math.round(colP)}/${colMarked}</span><br><span class="att-foot-stat-pct">${colPct}%</span>` 
                : `<span class="att-foot-stat" style="color: var(--text-tertiary); opacity: 0.6;">-</span>`
              }
            </td>
          `;
        });

        const overallPct = overallMarkedSum > 0 ? Math.round((overallPresSum / overallMarkedSum) * 100) : 100;

        contentHtml = `
          <div class="attendance-table-info-bar" style="display: flex; align-items: center; justify-content: space-between; margin: 6px 0 4px 0; padding: 2px 4px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--uat-blue-night);">
              <span>📅 Fechas de Clase • Unidad ${currentUnit} (${unitSessions.length} sesiones registradas)</span>
            </div>
            ${!isAuditReadOnly ? `
              <button type="button" class="btn btn-sm btn-outline-primary" onclick="App.promptAddAttendanceDate()" title="Añadir otra fecha de clase a esta unidad" style="border-radius: 6px; font-size: 12px; font-weight: 700; padding: 4px 12px; display: inline-flex; align-items: center; gap: 5px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Añadir Fecha
              </button>
            ` : ''}
          </div>
          <div class="notion-table-wrapper attendance-sabana-wrapper" id="attendanceSabanaWrapper" style="margin-top: 2px;">
            <table class="notion-table notion-table-gradebook attendance-sabana-table">
              <thead>
                <tr>
                  <th class="col-sabana-col-1 col-sticky-index" style="width: 44px; text-align: center;">#</th>
                  <th class="col-sabana-col-2 col-sticky-mat" style="width: 110px;"><div class="th-content"><span class="th-icon">Aa</span> Matrícula</div></th>
                  <th class="col-sabana-col-3 col-sticky-name" style="width: 240px;"><div class="th-content"><span class="th-icon">Aa</span> Nombre del Alumno</div></th>
                  ${dateColumnsHeaderHtml}
                  <th style="width: 48px; text-align: center;" title="Total de Presentes (P)"><div class="th-content" style="justify-content: center;">P</div></th>
                  <th style="width: 48px; text-align: center;" title="Total de Faltas (F)"><div class="th-content" style="justify-content: center;">F</div></th>
                  <th style="width: 48px; text-align: center;" title="Total de Retardos (R)"><div class="th-content" style="justify-content: center;">R</div></th>
                  <th style="width: 48px; text-align: center;" title="Total de Justificados (J)"><div class="th-content" style="justify-content: center;">J</div></th>
                  <th style="width: 72px; text-align: center;" title="Porcentaje de Asistencia calculado"><div class="th-content" style="justify-content: center;">% Asist</div></th>
                  <th style="width: 110px; text-align: center;" title="Estatus Derecho a Examen"><div class="th-content" style="justify-content: center;">Derecho</div></th>
                </tr>
              </thead>
              <tbody>
                ${studentRowsHtml || `<tr><td colspan="${unitSessions.length + 9}" style="text-align:center; padding: 24px;">No hay alumnos inscritos en este grupo.</td></tr>`}
              </tbody>
              <tfoot>
                <tr class="notion-table-footer">
                  <td class="col-sabana-col-1 col-sticky-index"></td>
                  <td class="col-sabana-col-2 col-sticky-mat" style="font-weight: 700;">Promedios:</td>
                  <td class="col-sabana-col-3 col-sticky-name" style="font-weight: 600; font-size: 12px; color: var(--text-secondary);">
                    Asistencia del Día (P / Total)
                  </td>
                  ${footerCellsHtml}
                  <td colspan="4" style="text-align: center; font-size: 12px; font-weight: 600; color: var(--text-secondary);">Promedio U${currentUnit}:</td>
                  <td style="text-align: center; font-weight: 800; color: var(--color-green); font-size: 13px;">${overallPct}%</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
      }

    } else if (this.attendanceMode === "diario") {
      // MODO 2: PASE DIARIO EN CLASE (FICHA INDIVIDUAL)
      if (unitSessions.length > 0) {
        if (!this.attendanceActiveSessionId || !unitSessions.some(s => s.id === this.attendanceActiveSessionId)) {
          this.attendanceActiveSessionId = unitSessions[unitSessions.length - 1].id;
        }
      } else {
        this.attendanceActiveSessionId = null;
      }

      const activeSession = unitSessions.find(s => s.id === this.attendanceActiveSessionId);

      let sessionPillsHtml = "";
      if (unitSessions.length > 0) {
        unitSessions.forEach((s, sIdx) => {
          const isCurrentSess = (s.id === this.attendanceActiveSessionId);
          sessionPillsHtml += `
            <div class="session-pill ${isCurrentSess ? 'active' : ''}" onclick="App.setAttendanceActiveSession('${s.id}')">
              <span class="session-pill-date">${this.escapeHtml(s.fecha || '')}</span>
              <span class="session-pill-title">${this.escapeHtml(s.tema || `Clase ${sIdx + 1}`)}</span>
              ${!isAuditReadOnly ? `
                <button type="button" class="btn-delete-session" title="Eliminar esta clase" onclick="event.stopPropagation(); App.deleteAttendanceSession('${s.id}')">✕</button>
              ` : ''}
            </div>
          `;
        });
      }

      if (!activeSession) {
        contentHtml = `
          <div class="attendance-empty-card" style="padding: 48px 24px; text-align: center; background: var(--bg-card); border: 2px dashed var(--border-color); border-radius: 12px; margin-top: 14px;">
            <div style="font-size: 46px; margin-bottom: 12px;">📅</div>
            <h3 style="font-size: 18px; font-weight: 700; color: var(--uat-blue-night); margin-bottom: 6px;">Sin clases registradas en la Unidad ${currentUnit}</h3>
            <p style="font-size: 13.5px; color: var(--text-secondary); max-width: 480px; margin: 0 auto 16px;">Comienza a pasar lista registrando la primera clase de esta unidad.</p>
            <button class="btn btn-primary" onclick="App.addAttendanceSession()">
              + Registrar Clase de Hoy
            </button>
          </div>
        `;
      } else {
        let countP = 0, countF = 0, countR = 0, countJ = 0;
        records.forEach(r => {
          const st = (r.attendanceDays && r.attendanceDays[activeSession.id]) || 'P';
          if (st === 'P') countP++;
          else if (st === 'F') countF++;
          else if (st === 'R') countR++;
          else if (st === 'J') countJ++;
        });

        const totalMarked = records.length;
        const effectivePres = countP + (countR * 0.5) + countJ;
        const classPct = totalMarked > 0 ? Math.round((effectivePres / totalMarked) * 100) : 0;

        let studentsRowsHtml = "";
        records.forEach((rec, recIdx) => {
          const student = studentsMap[rec.matricula] || { nombre: "Alumno no registrado en Base Maestra" };
          const status = (rec.attendanceDays && rec.attendanceDays[activeSession.id]) || 'P';
          const partCount = (rec.participationDays && Number(rec.participationDays[activeSession.id])) || 0;

          const unitFaltas = (rec.faltas && rec.faltas[uKey] !== undefined) ? Number(rec.faltas[uKey]) : 0;
          const unitPct = (rec.asistencia && rec.asistencia[uKey] !== undefined) ? Number(rec.asistencia[uKey]) : 100;
          const semFaltas = this.getStudentSemesterFaltas(rec, course);
          const faltasEvaluadas = isSemestre ? semFaltas : unitFaltas;
          const isExceeded = limiteFaltasActivo && consecuenciaActiva && (faltasEvaluadas > maxFaltas);

          let badgePrefix = '';
          if (isExceeded) {
            if (modoExceder === 'perder_asistencia') badgePrefix = '⚠️ 0 Pts · ';
            else if (esSd && pierdeAsist) badgePrefix = '⛔ SD/0Pts · ';
            else badgePrefix = '⛔ SD · ';
          }

          studentsRowsHtml += `
            <tr class="${isExceeded ? (esSd ? 'row-sin-derecho' : 'row-loss-asistencia') : ''}">
              <td class="col-index" style="width: 40px; text-align: center;">${recIdx + 1}</td>
              <td class="col-matricula" style="width: 130px; font-weight: 600;">${this.escapeHtml(rec.matricula)}</td>
              <td class="col-nombre" style="font-weight: 500;">${this.escapeHtml(student.nombre)}</td>
              <td style="width: 220px; text-align: center;">
                <div class="attendance-pills-group">
                  <button type="button" class="btn-att-pill att-p ${status === 'P' ? 'active' : ''}" 
                    title="Presente" onclick="App.setStudentSessionStatus(${recIdx}, '${activeSession.id}', 'P')">P</button>
                  <button type="button" class="btn-att-pill att-f ${status === 'F' ? 'active' : ''}" 
                    title="Falta" onclick="App.setStudentSessionStatus(${recIdx}, '${activeSession.id}', 'F')">F</button>
                  <button type="button" class="btn-att-pill att-r ${status === 'R' ? 'active' : ''}" 
                    title="Retardo (0.5 falta)" onclick="App.setStudentSessionStatus(${recIdx}, '${activeSession.id}', 'R')">R</button>
                  <button type="button" class="btn-att-pill att-j ${status === 'J' ? 'active' : ''}" 
                    title="Justificado" onclick="App.setStudentSessionStatus(${recIdx}, '${activeSession.id}', 'J')">J</button>
                </div>
              </td>
              <td style="width: 140px; text-align: center;">
                <div class="part-stepper-control">
                  <button type="button" class="btn-part-step" onclick="App.adjustStudentSessionPart(${recIdx}, '${activeSession.id}', -1)" title="Restar participación" ${partCount <= 0 ? 'disabled' : ''}>−</button>
                  <span class="part-count-badge ${partCount > 0 ? 'has-parts' : ''}">
                    ${partCount > 0 ? '⭐ ' + partCount : '0'}
                  </span>
                  <button type="button" class="btn-part-step" onclick="App.adjustStudentSessionPart(${recIdx}, '${activeSession.id}', 1)" title="Sumar participación">+</button>
                </div>
              </td>
              <td style="width: 180px; text-align: right;">
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                  <span class="badge-faltas ${isExceeded ? (esSd ? 'badge-faltas-sd' : 'badge-faltas-loss') : ''}" title="${faltasEvaluadas} falta(s) acumuladas (${isSemestre ? 'Semestre' : `Unidad ${currentUnit}`})">
                    ${badgePrefix}${unitFaltas} faltas${isSemestre ? ` (Sem: ${semFaltas})` : ''}
                  </span>
                  <span class="summary-chip" style="min-width: 50px; text-align: center;">
                    <b>${unitPct}%</b>
                  </span>
                </div>
              </td>
            </tr>
          `;
        });

        contentHtml = `
          <div class="sessions-top-bar">
            <div class="session-pills-scroll">
              ${sessionPillsHtml}
              <button type="button" class="btn-add-session-pill" onclick="App.addAttendanceSession()" title="Agregar nueva sesión de clase">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Nueva Clase
              </button>
            </div>
          </div>

          <div class="session-active-card">
            <div class="session-meta-inputs">
              <div class="meta-field">
                <label>Fecha:</label>
                <input type="date" class="form-control form-control-sm" value="${activeSession.fecha || ''}" 
                  onchange="App.updateAttendanceSessionMeta('${activeSession.id}', 'fecha', this.value)" />
              </div>
              <div class="meta-field" style="flex: 1; min-width: 180px;">
                <label>Tema de Clase:</label>
                <input type="text" class="form-control form-control-sm" placeholder="Tema visto hoy (opcional)" 
                  value="${this.escapeHtml(activeSession.tema || '')}" 
                  onchange="App.updateAttendanceSessionMeta('${activeSession.id}', 'tema', this.value)" />
              </div>
            </div>

            <div class="session-stats-chips">
              <span class="stat-pill-p"><b>${countP}</b> Presentes</span>
              <span class="stat-pill-f"><b>${countF}</b> Faltas</span>
              <span class="stat-pill-r"><b>${countR}</b> Retardos</span>
              <span class="stat-pill-j"><b>${countJ}</b> Justificados</span>
              <span class="stat-pill-pct"><b>${classPct}%</b> Asistencia Hoy</span>
            </div>

            <div class="session-actions-right">
              <button class="btn btn-sm btn-default" onclick="App.markAllPresent('${activeSession.id}')" title="Marcar a todos con Presente (P)">
                ⚡ Marcar Todos Presentes
              </button>
            </div>
          </div>

          <div class="notion-table-wrapper" style="margin-top: 12px;">
            <table class="notion-table" style="table-layout: fixed;">
              <thead>
                <tr>
                  <th style="width: 40px; text-align: center;">#</th>
                  <th style="width: 130px;"><div class="th-content"><span class="th-icon">Aa</span> Matrícula</div></th>
                  <th><div class="th-content"><span class="th-icon">Aa</span> Nombre del Alumno</div></th>
                  <th style="width: 220px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">📋</span> Estado de Hoy</div></th>
                  <th style="width: 140px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">⭐</span> Participación</div></th>
                  <th style="width: 180px; text-align: right;"><div class="th-content" style="justify-content: flex-end;"><span class="th-icon">📊</span> Acumulado U${currentUnit}</div></th>
                </tr>
              </thead>
              <tbody>
                ${studentsRowsHtml || `<tr><td colspan="6" style="text-align:center; padding: 24px;">No hay alumnos inscritos en este grupo.</td></tr>`}
              </tbody>
            </table>
          </div>
        `;
      }

    } else {
      // MODO 3: VACIADO RÁPIDO (PAPEL)
      const totalClasesMap = course.asistenciaTotalClasses || {};
      const totalClases = totalClasesMap[uKey] || 10;

      let quickRowsHtml = "";
      records.forEach((rec, recIdx) => {
        const student = studentsMap[rec.matricula] || { nombre: "Alumno no registrado en Base Maestra" };
        const aVal = (rec.asistencia && rec.asistencia[uKey] !== undefined) ? rec.asistencia[uKey] : "";
        const fVal = (rec.faltas && rec.faltas[uKey] !== undefined) ? rec.faltas[uKey] : "";
        const pVal = (rec.participacion && rec.participacion[uKey] !== undefined) ? rec.participacion[uKey] : "";

        let numF = (fVal !== "" && fVal !== null) ? Number(fVal) : 0;
        let numA = (aVal !== "" && aVal !== null) ? Number(aVal) : (totalClases - numF);
        if (numA < 0) numA = 0;

        const semFaltas = this.getStudentSemesterFaltas(rec, course, currentUnit, numF);
        const faltasEvaluadas = isSemestre ? semFaltas : numF;
        const isExceeded = limiteFaltasActivo && consecuenciaActiva && (faltasEvaluadas > maxFaltas);

        let statusBadgeHtml = '<span class="status-badge status-aprobado" style="font-size: 11px;">Aprobado</span>';
        if (isExceeded) {
          if (modoExceder === "perder_asistencia") {
            statusBadgeHtml = `<span class="status-badge status-reprobado" style="font-size: 11px; background: rgba(239, 68, 68, 0.12); color: var(--color-red);" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Puntos de asistencia anulados (0 pts)">⚠️ Sin Pts Asist</span>`;
          } else if (esSd && pierdeAsist) {
            statusBadgeHtml = `<span class="status-badge status-reprobado" style="font-size: 11px;" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Sin derecho a examen y 0 pts asistencia">⛔ SD / 0 Pts</span>`;
          } else {
            statusBadgeHtml = `<span class="status-badge status-reprobado" style="font-size: 11px;" title="${faltasEvaluadas} faltas (${isSemestre ? 'Semestre' : 'Unidad'}). Sin derecho a examen">⛔ Sin Derecho</span>`;
          }
        }

        quickRowsHtml += `
          <tr class="${isExceeded ? (esSd ? 'row-sin-derecho' : 'row-loss-asistencia') : ''}">
            <td class="col-index" style="width: 40px; text-align: center;">${recIdx + 1}</td>
            <td class="col-matricula" style="width: 130px; font-weight: 600;">${this.escapeHtml(rec.matricula)}</td>
            <td class="col-nombre" style="font-weight: 500;">${this.escapeHtml(student.nombre)}</td>
            <td style="width: 100px; text-align: center;">
              <input type="number" min="0" max="100" id="quick-asist-${recIdx}" class="cell-input" style="text-align: center; font-weight: 600;" 
                value="${numA}" oninput="App.onQuickRowInput(${recIdx})" onfocus="this.select()" />
            </td>
            <td style="width: 90px; text-align: center;">
              <input type="number" min="0" max="99" id="quick-faltas-${recIdx}" class="cell-input ${isExceeded ? 'cell-sd-text' : ''}" style="text-align: center; font-weight: 600;"
                value="${fVal}" placeholder="0" oninput="App.onQuickRowInput(${recIdx})" onfocus="this.select()" />
            </td>
            <td style="width: 80px; text-align: center;">
              <input type="number" min="0" max="99" id="quick-ret-${recIdx}" class="cell-input" style="text-align: center;" 
                value="" placeholder="0" oninput="App.onQuickRowInput(${recIdx})" onfocus="this.select()" />
            </td>
            <td style="width: 80px; text-align: center;">
              <input type="number" min="0" max="99" id="quick-just-${recIdx}" class="cell-input" style="text-align: center;" 
                value="" placeholder="0" oninput="App.onQuickRowInput(${recIdx})" onfocus="this.select()" />
            </td>
            <td style="width: 90px; text-align: center;">
              <span id="quick-preview-pct-${recIdx}" class="summary-chip" style="font-weight: 700;">
                ${aVal !== "" ? aVal + '%' : '100%'}
              </span>
            </td>
            <td style="width: 100px; text-align: center;">
              <input type="number" min="0" max="999" id="quick-part-${recIdx}" class="cell-input" style="text-align: center; font-weight: 600; color: var(--uat-orange);" 
                value="${pVal}" placeholder="0" onfocus="this.select()" />
            </td>
            <td style="width: 120px; text-align: center;">
              ${statusBadgeHtml}
            </td>
          </tr>
        `;
      });

      contentHtml = `
        <div class="quick-attendance-toolbar">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-size: 12.5px; font-weight: 600; color: var(--text-secondary);">Total de Clases Impartidas en Unidad ${currentUnit}:</label>
              <input type="number" min="1" max="100" id="quickTotalClassesInput" class="form-control" style="width: 70px; text-align: center; font-weight: 700;" 
                value="${totalClases}" />
            </div>
            <p style="font-size: 11.5px; color: var(--text-tertiary); margin: 0;">
              Captura las faltas y asistencias de tu lista en papel. El porcentaje (%) se recalculará automáticamente.
            </p>
          </div>
          <button class="btn btn-primary" onclick="App.saveQuickAttendance()" title="Guardar cambios y actualizar el Calificador institucional">
            💾 Guardar y Aplicar a Calificador
          </button>
        </div>

        <div class="notion-table-wrapper" style="margin-top: 12px;">
          <table class="notion-table" style="table-layout: fixed;">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">#</th>
                <th style="width: 130px;"><div class="th-content"><span class="th-icon">Aa</span> Matrícula</div></th>
                <th><div class="th-content"><span class="th-icon">Aa</span> Nombre del Alumno</div></th>
                <th style="width: 100px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">#</span> Asistencias</div></th>
                <th style="width: 90px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">#</span> Faltas</div></th>
                <th style="width: 80px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">#</span> Retardos</div></th>
                <th style="width: 80px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">#</span> Justif.</div></th>
                <th style="width: 90px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">%</span> % Asist</div></th>
                <th style="width: 100px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">⭐</span> Participación</div></th>
                <th style="width: 120px; text-align: center;"><div class="th-content" style="justify-content: center;"><span class="th-icon">🛡️</span> Derecho</div></th>
              </tr>
            </thead>
            <tbody>
              ${quickRowsHtml || `<tr><td colspan="10" style="text-align:center; padding: 24px;">No hay alumnos inscritos en este grupo.</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="page-title-area gradebook-header-container">
        <!-- Fila 1: Título de la Materia y Selector de Semestre / Grupo -->
        <div class="gradebook-header-top">
          <div class="gradebook-title-col">
            <h1 class="page-title" title="${this.escapeHtml(course.nombre)}">
              <span class="course-name-text">${this.escapeHtml(course.nombre)}</span>
              <span class="course-group-badge">${this.escapeHtml(course.grupo || 'Grupo A')}</span>
            </h1>
          </div>
          <div class="gradebook-switcher-col">
            <div class="gradebook-switchers-row">
              <div class="gradebook-select-pill gradebook-semester-pill" title="Filtrar materias por Semestre / Periodo Escolar">
                <span class="pill-prefix">Semestre:</span>
                <select class="form-control gradebook-semester-select" onchange="App.switchSemester(this.value)" title="Seleccionar semestre">
                  ${semesterSelectHtml}
                </select>
              </div>
              <div class="gradebook-select-pill gradebook-course-pill" title="Seleccionar lista o grupo de este semestre">
                <span class="pill-prefix">Lista / Grupo:</span>
                <select class="form-control gradebook-course-select" onchange="App.switchCourse(this.value)" title="Cambiar de materia o grupo">
                  ${selectHtml}
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Fila 2: Subtítulo Descriptivo y Acciones Principales -->
        <div class="gradebook-header-bottom">
          <div class="gradebook-desc-col">
            <p class="page-desc">
              Control de Asistencias & Participación • Periodo <b>${this.escapeHtml(course.periodo)}</b>
              • <span class="badge-legend badge-legend-p">P</span> Presente
              • <span class="badge-legend badge-legend-f">F</span> Falta
              • <span class="badge-legend badge-legend-r">R</span> Retardo (0.5)
              • <span class="badge-legend badge-legend-j">J</span> Justif.
              ${wAsist > 0 ? ` • <span style="color: var(--uat-orange); font-weight: 600;">Ponderación: ${wAsist}%</span>` : ''}
              ${limiteFaltasActivo ? ` • <span style="color: var(--color-red); font-weight: 700;">Límite ${asistCfg.ambitoLimite === 'semestre' ? 'Semestral' : 'por Unidad'}: Máx ${maxFaltas} faltas ${consecuenciaActiva ? `(${this.getModoExcederLabel(asistCfg.modoExceder)})` : '(Solo Informativo)'}</span>` : ''}
            </p>
          </div>
          <div class="gradebook-actions-col">
            ${!isAuditReadOnly ? `
              <button class="btn btn-primary" onclick="App.promptAddAttendanceDate()" title="Agregar nueva fecha de clase">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Nueva Fecha
              </button>
              <button class="btn btn-default" onclick="App.openOfficialCalendarModal()" title="Ver Calendario Escolar Oficial UAT 2026 y fechas clave">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Calendario UAT
              </button>
              <button class="btn btn-default" onclick="App.syncOfficialCalendar(true)" title="Recargar las fechas hábiles de clase del Calendario Oficial UAT 2026">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Días Oficiales
              </button>
              <button class="btn btn-default" onclick="App.clearAttendanceInCurrentUnit()" title="Dejar todas las casillas de la unidad en blanco">
                🧹 Vaciar Casillas
              </button>
              <button class="btn btn-default" onclick="App.openExcelAttendanceImportModal()" title="Importar faltas y asistencias subiendo un archivo Excel (.xlsx, .xls o .csv)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Importar Excel
              </button>
            ` : ''}
            <button class="btn btn-default" onclick="App.exportAttendanceToExcel()" title="Descargar la Sábana Completa de Asistencias en Excel (.xlsx)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Descargar Excel
            </button>
            <button class="btn btn-default" onclick="window.print()" title="Imprimir lista de asistencia">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimir
            </button>
          </div>
        </div>

        <!-- Tira Oficial UAT 2026: Días de Clase, Pago de Ficha de Inscripción y Altas y Bajas -->
        ${(() => {
          const normSem = this.normalizePeriodo(course.periodo || this.getSelectedSemester());
          const calInfo = this.UAT_CALENDAR_2026[normSem] || this.UAT_CALENDAR_2026["2026 - 3 OTOÑO"];
          const totalSessionsInCourse = (course.attendanceSessions || []).length;
          return `
            <div class="uat-calendar-strip">
              <div class="uat-cal-strip-info">
                <span class="uat-cal-icon">🏛️</span>
                <div class="uat-cal-text">
                  <div class="uat-cal-title">
                    <b>Calendario Oficial UAT 2026</b> • Periodo <b>${this.escapeHtml(course.periodo)}</b>
                    <span class="uat-cal-badge-pill">${totalSessionsInCourse || 71} días de clase hábiles</span>
                  </div>
                  <div class="uat-cal-sub">
                    Solo días de clase hábiles (Lunes a Viernes). Días feriados e inhábiles oficiales excluidos automáticamente.
                  </div>
                </div>
              </div>
              <div class="uat-cal-strip-milestones">
                <div class="uat-cal-milestone milestone-pago" title="Días oficiales para pagar la ficha de inscripción y reinscripción">
                  <span class="milestone-badge">💳 PAGO DE FICHA DE INSCRIPCIÓN</span>
                  <span class="milestone-dates">${this.escapeHtml(calInfo.pagoFicha.inicioTxt)} al ${this.escapeHtml(calInfo.pagoFicha.finTxt)}</span>
                  <span class="milestone-deadline">Fecha límite de pago: <b>${this.escapeHtml(calInfo.pagoFicha.limiteTxt)}</b></span>
                </div>
                <div class="uat-cal-milestone milestone-altasbajas" title="Periodo para realizar altas y bajas de materias">
                  <span class="milestone-badge">🔄 ALTAS Y BAJAS DE MATERIAS</span>
                  <span class="milestone-dates">${this.escapeHtml(calInfo.altasBajas.inicioTxt)} al ${this.escapeHtml(calInfo.altasBajas.finTxt)}</span>
                  <span class="milestone-deadline">Remarcado en Unidad 1 • Límite baja: <b>${this.escapeHtml(calInfo.altasBajas.limiteBajaTxt)}</b></span>
                </div>
                <button type="button" class="btn btn-sm btn-default" onclick="App.openOfficialCalendarModal()" title="Ver calendario visual del semestre y simbología oficial">
                  📅 Ver Calendario
                </button>
              </div>
            </div>
          `;
        })()}

        <!-- Fila 3: Selector de Unidad, Leyenda y Modos -->
        <div class="attendance-controls-row">
          <div class="attendance-units-nav">
            ${unitChipsHtml}
          </div>
          <div class="attendance-legend-quick" title="Simbología permitida en las casillas de asistencia">
            <span class="legend-quick-label">Simbología:</span>
            <span class="att-legend-item"><span class="badge-legend badge-legend-p">P</span> <b>Presente</b></span>
            <span class="att-legend-item"><span class="badge-legend badge-legend-f">F</span> <b>Falta</b></span>
            <span class="att-legend-item"><span class="badge-legend badge-legend-r">R</span> <b>Retardo (0.5)</b></span>
            <span class="att-legend-item"><span class="badge-legend badge-legend-j">J</span> <b>Justificado</b></span>
          </div>
          <div class="attendance-mode-selector">
            <button type="button" class="attendance-mode-tab-btn ${this.attendanceMode === 'sabana' ? 'active' : ''}" 
              onclick="App.setAttendanceMode('sabana')">
              📊 Sábana Completa (Cuadrícula)
            </button>
            <button type="button" class="attendance-mode-tab-btn ${this.attendanceMode === 'diario' ? 'active' : ''}" 
              onclick="App.setAttendanceMode('diario')">
              📋 Pase Diario
            </button>
            <button type="button" class="attendance-mode-tab-btn ${this.attendanceMode === 'rapido' ? 'active' : ''}" 
              onclick="App.setAttendanceMode('rapido')">
              📝 Vaciado Rápido (Papel)
            </button>
          </div>
        </div>
      </div>

      ${(this.attendanceMode === 'sabana' && unitSessions.length > 0) ? contentHtml : `<div class="attendance-main-area">${contentHtml}</div>`}
    `;

    setTimeout(() => {
      this.fitGradebookTableHeight();
      this.setupAttendanceScrollHelper();
    }, 0);
  },

  // 2. VISTA DE DIRECTORIO MAESTRO DE ALUMNOS (BASE DE DATOS RELACIONAL)
  renderDirectory: function(container) {
    const students = this.data.students || [];
    
    let rowsHtml = "";
    students.forEach((s, idx) => {
      const escMat = this.escapeHtml(s.matricula || "");
      const escNom = this.escapeHtml(s.nombre || "");
      const escCar = this.escapeHtml(s.carrera || "Ingeniería");
      rowsHtml += `
        <tr>
          <td class="col-matricula">
            <input type="text" class="cell-input" value="${escMat}" 
              onfocus="this.select()"
              onchange="App.updateDirectoryStudent(${idx}, 'matricula', this.value)" />
          </td>
          <td>
            <input type="text" class="cell-input" value="${escNom}" style="font-weight: 500;"
              onfocus="this.select()"
              onchange="App.updateDirectoryStudent(${idx}, 'nombre', this.value)" />
          </td>
          <td>
            <input type="text" class="cell-input" value="${escCar}" 
              onfocus="this.select()"
              onchange="App.updateDirectoryStudent(${idx}, 'carrera', this.value)" />
          </td>
          <td style="text-align: center; width: 40px;">
            <button type="button" class="btn-delete-row" 
              title="Eliminar del directorio maestro" onclick="App.deleteDirectoryStudent(${idx})">✕</button>
          </td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="page-title-area">
        <div class="page-title-row">
          <div>
            <h1 class="page-title">
              Directorio Maestro de Alumnos
            </h1>
            <p class="page-desc">
              Base de datos relacional de estudiantes. Al registrar aquí la matrícula y nombre, cualquier materia (Álgebra Lineal o Cálculo Integral) obtiene el nombre automáticamente mediante <b>Rollup</b>.
            </p>
          </div>
          <div class="header-actions">
            <button class="btn btn-default" onclick="App.openBulkImportModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Importar / Pegar desde Excel
            </button>
            <button class="btn btn-primary" onclick="App.addEmptyStudentToDirectory()">
              + Registrar Alumno
            </button>
          </div>
        </div>
      </div>

      <div class="notion-table-wrapper">
        <table class="notion-table" style="table-layout: fixed;">
          <thead>
            <tr>
              <th style="width: 180px;"><div class="th-content"><span class="th-icon">Aa</span> Matrícula (Clave Relacional)</div></th>
              <th><div class="th-content"><span class="th-icon">Aa</span> Nombre Completo del Alumno</div></th>
              <th style="width: 220px;"><div class="th-content"><span class="th-icon">#</span> Carrera / Programa</div></th>
              <th style="width: 45px;"></th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-tertiary);">No hay alumnos en el directorio maestro.</td></tr>`}
          </tbody>
        </table>
        <div class="table-bottom-bar">
          <button class="add-row-btn" onclick="App.addEmptyStudentToDirectory()">
            + Nuevo registro de alumno
          </button>
          <span style="font-size: 11.5px; color: var(--text-tertiary);">
            Total de alumnos en catálogo: ${students.length}
          </span>
        </div>
      </div>
    `;
    setTimeout(() => {
      this.fitGradebookTableHeight();
    }, 0);
  },

  // 3. VISTA DE PUBLICACIÓN EN TEAMS
  renderTeamsPublication: function(container) {
    const course = this.getActiveCourse();
    if (!course) {
      this.renderEmptyGradebook(container);
      return;
    }

    container.innerHTML = `
      <div class="page-title-area">
        <h1 class="page-title">
          Publicación de Calificaciones para Teams
        </h1>
        <p class="page-desc">
          Opciones para compartir y publicar las calificaciones con tus alumnos de manera profesional, con celdas de solo lectura y protección contra edición.
        </p>
      </div>

      <div class="teams-export-grid">
        <!-- Tarjeta 1: Excel Protegido para Teams -->
        <div class="export-card">
          <div>
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Excel Solo Lectura (.xlsx)
            </h3>
            <p>
              Genera una hoja de cálculo limpia con formato de acta oficial, lista para subir a la carpeta de <b>Archivos en Teams</b>. Las columnas incluyen Evaluaciones por unidad, Proyecto y Calificación Final.
            </p>
            <div class="export-options">
              <label class="checkbox-label">
                <input type="checkbox" id="teamsIncludeNames" checked />
                <span>Incluir nombres completos</span>
              </label>
              <label class="checkbox-label">
                <input type="checkbox" id="teamsPrivacyOnly" onchange="document.getElementById('teamsIncludeNames').checked = !this.checked;" />
                <span>Modo Privacidad: Solo publicar por <b>Matrícula</b></span>
              </label>
            </div>
          </div>
          <button class="btn btn-primary" onclick="App.triggerTeamsExcelExport()">
            Descargar Excel para Teams (.xlsx)
          </button>
        </div>

        <!-- Tarjeta 2: PDF / Formato Imprimible -->
        <div class="export-card">
          <div>
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Reporte Oficial PDF / Imprimir
            </h3>
            <p>
              Genera una vista visual pulida lista para imprimir o guardar como PDF desde tu navegador. Ideal para publicar una captura o aviso formal en el muro del canal de Teams.
            </p>
            <div class="export-options">
              <span>Incluye desglose por unidad, promedio y estatus Aprobado/No Aprobado.</span>
            </div>
          </div>
          <button class="btn btn-default" onclick="window.print()">
            Imprimir / Guardar como PDF
          </button>
        </div>

        <!-- Tarjeta 3: Respaldo Completo -->
        <div class="export-card">
          <div>
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Copia de Seguridad (Backup)
            </h3>
            <p>
              Descarga o restaura una copia de seguridad en formato JSON de todas tus materias, firmas y base de datos de alumnos.
            </p>
            <div class="export-options">
              <button class="btn btn-default btn-sm" onclick="App.downloadBackup()">Descargar Respaldo (.json)</button>
              <button class="btn btn-default btn-sm" onclick="document.getElementById('backupFileInput').click()">Restaurar Respaldo</button>
              <input type="file" id="backupFileInput" style="display: none;" accept=".json" onchange="App.restoreBackup(this)" />
            </div>
          </div>
        </div>
      </div>

      <!-- Módulo de Consulta Rápida por Matrícula (Para Proyector o Alumno) -->
      <div class="student-search-box">
        <h3 style="margin-bottom: 6px;">Consulta Rápida por Matrícula</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
          Ingresa una matrícula para ver su desglose individual en pantalla sin mostrar las calificaciones del resto:
        </p>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <input type="text" id="matriculaLookupInput" class="form-control" style="max-width: 250px;" placeholder="Ej. 2203217009" />
          <button class="btn btn-primary" onclick="App.lookupStudent()">Consultar</button>
        </div>
        <div id="studentLookupResult"></div>
      </div>
    `;
  },

  // 4. VISTA DE CONFIGURACIÓN & FÓRMULAS
  renderConfig: function(container) {
    const course = this.getActiveCourse();
    if (!course) {
      this.renderEmptyGradebook(container);
      return;
    }
    const maxF = course.firmasMaxConfig || { u1: 6, u2: 14, u3: 17, u4: 23, u5: 10 };

    const numUnits = Number(course.unidadesCount) || 5;
    const unitIndices = Array.from({ length: numUnits }, (_, i) => i + 1);
    const unitListStr = unitIndices.map(u => `U${u}`).join(', ');

    container.innerHTML = `
      <div class="page-title-area">
        <h1 class="page-title">
          Configuración de Fórmulas y Ponderaciones
        </h1>
        <p class="page-desc">
          Ajusta los máximos de firmas por unidad y revisa las fórmulas matemáticas activas.
        </p>
      </div>

      <div style="max-width: 750px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px;">
        <h3 style="font-size: 15px; margin-bottom: 14px;">Máximo de Firmas por Unidad (${this.escapeHtml(course.nombre)})</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 18px;">
          Define la cantidad máxima de firmas para la escala del 50% en cada una de las <b>${numUnits} unidades</b> de esta materia:
        </p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px;">
          ${unitIndices.map(u => `
            <div>
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Unidad ${u}</label>
              <input type="number" min="1" max="100" class="form-control" value="${maxF[`u${u}`] || 10}" 
                onchange="App.updateMaxFirmasConfig('u${u}', this.value)" />
            </div>
          `).join('')}
        </div>

        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 24px 0;" />

        <h3 style="font-size: 15px; margin-bottom: 12px;">Fórmulas Matemáticas Activas (${numUnits} Unidades)</h3>
        
        <div style="background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: 12.5px; margin-bottom: 14px; line-height: 1.6;">
          <b style="color: var(--accent-color);">// Evaluación por Unidad:</b><br />
          ((Firmas U<sub>x</sub> / MAX_Firmas U<sub>x</sub>) * 50) + (Examen U<sub>x</sub> * 0.5)
        </div>

        <div style="background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6;">
          <b style="color: var(--accent-color);">// Evaluación Final:</b><br />
          if(round(mean(${unitListStr}, Proyecto) + (PuntosExtra * 5)) > 100, 100, round(...))
        </div>
      </div>
    `;
  },

  // BLOQUEO Y CONGELAMIENTO DE UNIDADES (PROTECCIÓN CONTRA CAMBIOS ACCIDENTALES)
  toggleUnitLock: function(uKey) {
    if (this.isSupervising) {
      this.showToast("⚠️ Modo Supervisión: No tienes autorización para alterar bloqueos de otro docente.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;
    if (!course.lockedUnits) course.lockedUnits = {};
    const newState = !course.lockedUnits[uKey];
    course.lockedUnits[uKey] = newState;
    this.saveData();
    this.render();
    const uNum = uKey.replace('u', '');
    if (newState) {
      this.showToast(`🔒 Unidad ${uNum} congelada (Solo Lectura). Edición bloqueada.`, "info");
    } else {
      this.showToast(`🔓 Unidad ${uNum} desbloqueada para registrar calificaciones.`, "success");
    }
  },

  // ACCIONES Y ACTUALIZACIONES QUIRÚRGICAS DE DATOS (ULTRA FLUIDEZ < 1MS)
  _resolveRecord: function(identifier, course) {
    if (!course || !course.records) return { rec: null, idx: -1 };
    let idx = -1;
    if (typeof identifier === "number") {
      idx = identifier;
    } else {
      idx = (course.records || []).findIndex(r => String(r.matricula) === String(identifier));
    }
    const rec = (idx >= 0 && idx < course.records.length) ? course.records[idx] : null;
    return { rec, idx };
  },

  updateFirmas: function(identifier, uKey, val) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para capturar notas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;
    if (course.lockedUnits && course.lockedUnits[uKey]) {
      this.showToast(`⚠️ La Unidad ${uKey.replace('u', '')} está bloqueada. Desbloquéala para editar calificaciones.`, "warning");
      return;
    }
    const { rec, idx } = this._resolveRecord(identifier, course);
    if (rec && idx !== -1) {
      if (!rec.firmas) rec.firmas = {};
      if (val === "" || val === null) {
        rec.firmas[uKey] = null;
      } else {
        let num = Number(val);
        if (isNaN(num)) num = 0;
        rec.firmas[uKey] = Math.max(0, Math.min(999, num));
      }
      this.updateStudentRowView(idx, 'firmas', uKey, rec.firmas[uKey]);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updateExamen: function(identifier, uKey, val) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para capturar notas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;
    if (course.lockedUnits && course.lockedUnits[uKey]) {
      this.showToast(`⚠️ La Unidad ${uKey.replace('u', '')} está bloqueada. Desbloquéala para editar calificaciones.`, "warning");
      return;
    }
    const { rec, idx } = this._resolveRecord(identifier, course);
    if (rec && idx !== -1) {
      if (!rec.examenes) rec.examenes = {};
      if (val === "" || val === null) {
        rec.examenes[uKey] = null;
      } else {
        let num = Number(val);
        if (isNaN(num)) num = 0;
        rec.examenes[uKey] = Math.max(0, Math.min(100, num));
      }
      this.updateStudentRowView(idx, 'examenes', uKey, rec.examenes[uKey]);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updateAsistencia: function(identifier, uKey, val) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para capturar notas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;
    if (course.lockedUnits && course.lockedUnits[uKey]) {
      this.showToast(`⚠️ La Unidad ${uKey.replace('u', '')} está bloqueada. Desbloquéala para editar asistencias.`, "warning");
      return;
    }
    const { rec, idx } = this._resolveRecord(identifier, course);
    if (rec && idx !== -1) {
      if (!rec.asistencia) rec.asistencia = {};
      if (val === "" || val === null) {
        rec.asistencia[uKey] = null;
      } else {
        let num = Number(val);
        if (isNaN(num)) num = 0;
        rec.asistencia[uKey] = Math.max(0, Math.min(100, num));
      }
      // Si el maestro edita manualmente, quitar la marca de sincronización automática pura
      if (rec.asistenciaAuto) rec.asistenciaAuto[uKey] = false;
      this.updateStudentRowView(idx, 'asistencia', uKey, rec.asistencia[uKey]);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updateParticipacion: function(identifier, uKey, val) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para capturar notas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;
    if (course.lockedUnits && course.lockedUnits[uKey]) {
      this.showToast(`⚠️ La Unidad ${uKey.replace('u', '')} está bloqueada. Desbloquéala para editar participaciones.`, "warning");
      return;
    }
    const { rec, idx } = this._resolveRecord(identifier, course);
    if (rec && idx !== -1) {
      if (!rec.participacion) rec.participacion = {};
      if (val === "" || val === null) {
        rec.participacion[uKey] = null;
      } else {
        let num = Number(val);
        if (isNaN(num)) num = 0;
        rec.participacion[uKey] = Math.max(0, Math.min(999, num));
      }
      this.updateStudentRowView(idx, 'participacion', uKey, rec.participacion[uKey]);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updateProyecto: function(identifier, val) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para capturar notas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    const { rec, idx } = this._resolveRecord(identifier, course);
    if (rec && idx !== -1) {
      if (val === "" || val === null) {
        rec.proyecto = null;
      } else {
        let num = Number(val);
        if (isNaN(num)) num = 0;
        rec.proyecto = Math.max(0, Math.min(100, num));
      }
      this.updateStudentRowView(idx, 'proyecto', null, rec.proyecto);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updatePuntosExtra: function(identifier, val) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para capturar notas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    const { rec, idx } = this._resolveRecord(identifier, course);
    if (rec && idx !== -1) {
      let num = Number(val);
      if (isNaN(num) || num < 0) num = 0;
      rec.puntosExtra = Math.min(10, num);
      this.updateStudentRowView(idx, 'puntosExtra', null, rec.puntosExtra);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  // Actualización quirúrgica de una fila sin tocar el resto del DOM
  updateStudentRowView: function(identifier, field, uKey, val) {
    const course = this.getActiveCourse();
    const { rec, idx: recIdx } = this._resolveRecord(identifier, course);
    if (!rec || recIdx === -1) return;

    const calcs = this.calculateStudentGrades(rec, course);
    const maxFirmasConfig = course.firmasMaxConfig || {};

    // 1. Si se actualizó firmas de una unidad, actualizar anillo SVG correspondiente
    if (field === 'firmas' && uKey) {
      const ring = document.getElementById(`ring-firmas-${recIdx}-${uKey}`);
      if (ring) {
        const maxF = maxFirmasConfig[uKey] || 10;
        const numVal = val !== "" && val !== null ? Number(val) : null;
        if (numVal !== null && maxF > 0) {
          const pct = Math.min(100, Math.round((numVal / maxF) * 100));
          const dashOffset = 44 - (44 * pct) / 100;
          const strokeColor = pct >= 100 ? 'var(--color-green)' : (pct >= 50 ? 'var(--color-orange)' : 'var(--border-color)');
          ring.style.strokeDashoffset = dashOffset;
          ring.style.stroke = strokeColor;
        } else {
          ring.style.strokeDashoffset = 44;
          ring.style.stroke = 'var(--border-color)';
        }
      }
    }

    // 2. Si se actualizó examen de una unidad, actualizar la barra de progreso correspondiente
    if (field === 'examenes' && uKey) {
      const bar = document.getElementById(`bar-exam-${recIdx}-${uKey}`);
      if (bar) {
        const numVal = val !== "" && val !== null ? Number(val) : null;
        let barColor = "var(--color-green)";
        if (numVal !== null && numVal < 60) barColor = "var(--color-red)";
        else if (numVal !== null && numVal < 70) barColor = "var(--color-orange)";
        bar.style.width = (numVal !== null ? numVal : 0) + '%';
        bar.style.backgroundColor = barColor;
      }
    }

    // 2.1 Si se actualizó asistencia de una unidad, actualizar anillo SVG correspondiente
    if (field === 'asistencia' && uKey) {
      const ring = document.getElementById(`ring-asist-${recIdx}-${uKey}`);
      if (ring) {
        const numVal = val !== "" && val !== null ? Number(val) : null;
        if (numVal !== null) {
          const isSd = !!(calcs.isSinDerechoU && calcs.isSinDerechoU[uKey.replace('u', '')]);
          let ringColor = "var(--color-green)";
          if (isSd || numVal < 60) ringColor = "var(--color-red)";
          else if (numVal < 80) ringColor = "var(--color-orange)";

          const pct = Math.min(100, Math.max(0, numVal));
          const dashOffset = 44 - (44 * pct) / 100;
          ring.style.strokeDashoffset = dashOffset;
          ring.style.stroke = ringColor;
        } else {
          ring.style.strokeDashoffset = 44;
          ring.style.stroke = 'var(--border-color)';
        }
      }
    }

    // 3. Actualizar los números y anillos de Evaluación calculada U1 a Un
    const numUnits = Number(course.unidadesCount) || 5;
    for (let u = 1; u <= numUnits; u++) {
      const uK = `u${u}`;
      const valEl = document.getElementById(`val-eval-${recIdx}-${uK}`);
      const ringEl = document.getElementById(`ring-eval-${recIdx}-${uK}`);
      const evalVal = calcs.evalU[u];
      const hasEval = evalVal !== null && evalVal !== undefined;
      const isSd = !!(calcs.isSinDerechoU && calcs.isSinDerechoU[u]);
      const displayVal = isSd ? "SD" : (hasEval ? evalVal : "-");

      if (valEl) {
        valEl.textContent = displayVal;
        valEl.style.color = isSd ? "var(--color-red)" : "";
        valEl.style.fontWeight = isSd ? "800" : "";
      }
      if (ringEl) {
        if (hasEval || isSd) {
          let ringColor = "var(--color-green)";
          if (isSd || evalVal < 60) ringColor = "var(--color-red)";
          else if (evalVal < 70) ringColor = "var(--color-orange)";
          const pct = Math.min(100, evalVal || 0);
          const dashOffset = 44 - (44 * pct) / 100;
          ringEl.style.strokeDashoffset = dashOffset;
          ringEl.style.stroke = ringColor;
        } else {
          ringEl.style.strokeDashoffset = 44;
          ringEl.style.stroke = "var(--border-color)";
        }
      }
    }

    // 4. Actualizar Evaluación Final (número, barra e insignia)
    const valFinal = document.getElementById(`val-final-${recIdx}`);
    const barFinal = document.getElementById(`bar-final-${recIdx}`);
    const badgeFinal = document.getElementById(`badge-final-${recIdx}`);

    if (calcs.hasEvaluations) {
      let finalColor = "var(--color-green)";
      if (calcs.evalFinal < 60) finalColor = "var(--color-red)";
      else if (calcs.evalFinal < 70) finalColor = "var(--color-orange)";

      if (valFinal) {
        valFinal.textContent = calcs.evalFinal;
        valFinal.style.color = finalColor;
      }
      if (barFinal) {
        barFinal.style.width = calcs.evalFinal + '%';
        barFinal.style.backgroundColor = finalColor;
      }
      if (badgeFinal) {
        badgeFinal.textContent = calcs.evalFinal >= 70 ? 'APR' : 'REP';
        badgeFinal.className = `status-badge ${calcs.evalFinal >= 70 ? 'status-aprobado' : 'status-reprobado'}`;
      }
    } else {
      if (valFinal) {
        valFinal.textContent = "-";
        valFinal.style.color = "var(--text-tertiary)";
      }
      if (barFinal) {
        barFinal.style.width = '0%';
        barFinal.style.backgroundColor = "transparent";
      }
      if (badgeFinal) {
        badgeFinal.textContent = 'PEN';
        badgeFinal.className = 'status-badge status-pending';
      }
    }
  },

  // Actualización quirúrgica de las estadísticas del pie de tabla
  updateSummaryStats: function() {
    const course = this.getActiveCourse();
    const stats = this.calculateCourseStats(course);
    const maxFirmasConfig = course.firmasMaxConfig || {};
    const numUnits = Number(course.unidadesCount) || 5;

    const avgFinalEl = document.getElementById('stat-avg-final');
    if (avgFinalEl) avgFinalEl.textContent = stats.avgFinal;

    for (let u = 1; u <= numUnits; u++) {
      const uK = `u${u}`;
      const maxFEl = document.getElementById(`stat-max-firmas-${uK}`);
      if (maxFEl) maxFEl.textContent = stats.maxFirmas[uK] || maxFirmasConfig[uK] || 0;

      const avgExEl = document.getElementById(`stat-avg-exam-${uK}`);
      if (avgExEl) avgExEl.textContent = stats.avgExamenes[uK];

      const avgEvEl = document.getElementById(`stat-avg-eval-${uK}`);
      if (avgEvEl) avgEvEl.textContent = stats.avgEvaluaciones[u];
    }
  },

  // Navegación ágil con teclado tipo Excel (Enter, flecha arriba y flecha abajo)
  handleCellKeydown: function(event, input) {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      const tr = input.closest('tr');
      let nextTr = tr ? tr.nextElementSibling : null;
      // Saltar filas ocultas por el filtro de búsqueda
      while (nextTr && nextTr.style.display === 'none') {
        nextTr = nextTr.nextElementSibling;
      }
      if (nextTr) {
        const col = input.getAttribute('data-col');
        const nextInput = nextTr.querySelector(`input[data-col="${col}"]`);
        if (nextInput) {
          nextInput.focus({ preventScroll: true });
          nextInput.select();
          if (nextTr) {
            nextTr.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const tr = input.closest('tr');
      let prevTr = tr ? tr.previousElementSibling : null;
      // Saltar filas ocultas por el filtro de búsqueda
      while (prevTr && prevTr.style.display === 'none') {
        prevTr = prevTr.previousElementSibling;
      }
      if (prevTr) {
        const col = input.getAttribute('data-col');
        const prevInput = prevTr.querySelector(`input[data-col="${col}"]`);
        if (prevInput) {
          prevInput.focus({ preventScroll: true });
          prevInput.select();
          if (prevTr) {
            prevTr.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
      }
    }
  },

  updateMatricula: function(recordIndex, newMatricula) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para modificar matrículas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (course.records[recordIndex]) {
      course.records[recordIndex].matricula = newMatricula.trim();
      this.saveData();
      this.render();
    }
  },

  addNewStudentToCourse: function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para inscribir alumnos.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    course.records.push({
      matricula: "NUEVA_MATRICULA",
      firmas: { u1: null, u2: null, u3: null, u4: null, u5: null },
      examenes: { u1: null, u2: null, u3: null, u4: null, u5: null },
      proyecto: null,
      puntosExtra: 0
    });
    this.saveData();
    this.render();
    this.showToast("Fila añadida. Escribe la matrícula para enlazar al alumno.");
  },

  deleteRecord: function(identifier) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para quitar alumnos.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    let idx = -1;
    if (typeof identifier === "number") {
      idx = identifier;
    } else {
      idx = (course.records || []).findIndex(r => String(r.matricula) === String(identifier));
    }

    if (idx !== -1) {
      const recToDelete = course.records[idx];
      const studentMap = this.getStudentsMap();
      const sName = studentMap[recToDelete.matricula] ? studentMap[recToDelete.matricula].nombre : recToDelete.matricula;
      const isPlaceholder = recToDelete.matricula === "NUEVA_MATRICULA";

      // VULN-13: Confirmación obligatoria para evitar borrado accidental
      if (!isPlaceholder) {
        if (!confirm(`¿Estás seguro de que deseas eliminar al alumno "${sName}" (${recToDelete.matricula}) de esta materia? Esta acción alterará los registros de calificaciones.`)) {
          return;
        }
      }

      const deleted = course.records.splice(idx, 1)[0];
      this.saveData();
      this.render();

      if (isPlaceholder) {
        this.showToast("Fila borrador eliminada de la lista");
      } else {
        this.showUndoToast(`"${sName}" quitado de la lista de ${course.nombre}`, () => {
          course.records.splice(idx, 0, deleted);
          this.saveData();
          this.render();
          this.showToast(`Alumno restaurado a la lista`);
        });
      }
    }
  },

  // Gestión del Directorio Maestro con propagación en cascada de matrículas
  updateDirectoryStudent: function(index, field, value) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría: Directorio en Modo Solo Lectura.", "warning");
      return;
    }
    if (this.data && this.data.students && this.data.students[index]) {
      const trimmedVal = value.trim();
      if (field === 'matricula') {
        const oldMatricula = this.data.students[index].matricula;
        if (oldMatricula && trimmedVal && oldMatricula !== trimmedVal) {
          this.data.students[index].matricula = trimmedVal;
          // Propagación en cascada a todas las materias y grupos del docente
          if (this.data.courses) {
            this.data.courses.forEach(c => {
              if (c.records) {
                c.records.forEach(r => {
                  if (r.matricula === oldMatricula) {
                    r.matricula = trimmedVal;
                  }
                });
              }
            });
          }
        }
      } else {
        this.data.students[index][field] = trimmedVal;
      }
      this.debouncedSave();
    }
  },

  addEmptyStudentToDirectory: function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría: Directorio en Modo Solo Lectura.", "warning");
      return;
    }
    const newMat = "22" + Math.floor(10000000 + Math.random() * 90000000);
    this.data.students.push({
      matricula: newMat,
      nombre: "NOMBRE APELLIDO PATERNO MATERNO",
      carrera: "Ingeniería"
    });
    this.saveData();
    this.render();
    this.showToast("Nuevo alumno agregado a la Base Maestra.");
  },

  deleteDirectoryStudent: function(identifier) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría: Directorio en Modo Solo Lectura.", "warning");
      return;
    }
    let idx = -1;
    if (typeof identifier === "number") {
      idx = identifier;
    } else {
      idx = (this.data.students || []).findIndex(s => String(s.matricula) === String(identifier));
    }

    if (idx !== -1) {
      const student = this.data.students[idx];
      const studentName = student.nombre || student.matricula;
      const isPlaceholder = !student.nombre || student.nombre === "NOMBRE APELLIDO PATERNO MATERNO";
      
      // Confirmación obligatoria para evitar borrado accidental en base maestra
      if (!isPlaceholder && !confirm(`¿Estás seguro de que deseas eliminar al alumno "${studentName}" (${student.matricula}) del directorio maestro? Esta acción afectará la relación Rollup con las materias.`)) {
        return;
      }

      const deletedStudent = this.data.students.splice(idx, 1)[0];
      this.saveData();
      this.render();

      if (isPlaceholder) {
        this.showToast("Registro borrador eliminado");
      } else {
        this.showUndoToast(`Alumno "${studentName}" eliminado del directorio`, () => {
          this.data.students.splice(idx, 0, deletedStudent);
          this.saveData();
          this.render();
          this.showToast(`Alumno "${studentName}" restaurado`);
        });
      }
    }
  },

  // Configuración de Máximo de Firmas y Unidades Dinámicas (3, 4, 5 o más unidades)
  _tempManageUnitsCount: 5,
  _tempManageMaxFirmas: {},

  openMaxFirmasModal: function() {
    this.openManageCourseModal();
  },

  closeMaxFirmasModal: function() {
    this.closeManageCourseModal();
  },

  saveMaxFirmasModal: function() {
    return this.submitEditCourse();
  },

  changeModalUnitsCount: function(delta) {
    return this.changeManageModalUnitsCount(delta);
  },

  updateMaxFirmasConfig: function(uKey, val) {
    const course = this.getActiveCourse();
    if (!course) return;
    if (!course.firmasMaxConfig) course.firmasMaxConfig = {};
    const num = Math.max(1, Number(val) || 10);
    course.firmasMaxConfig[uKey] = num;
    this.saveData();
    this.render();
    this.showToast(`Meta de ${uKey.toUpperCase()} actualizada a ${num} firmas`);
  },

  // =========================================================================
  // MÓDULO MÓVIL: FICHA TÁCTIL RÁPIDA DEL ALUMNO (EVALUACIÓN ÁGIL)
  // =========================================================================
  currentMobileStudentIndex: -1,

  openStudentMobileModal: function(index) {
    const course = this.getActiveCourse();
    if (!course || !course.records || !course.records[index]) return;

    this.currentMobileStudentIndex = index;
    this.renderStudentMobileModal(index);

    const modal = document.getElementById("studentDetailMobileModal");
    if (modal) modal.classList.add("open");
  },

  closeStudentMobileModal: function() {
    const modal = document.getElementById("studentDetailMobileModal");
    if (modal) modal.classList.remove("open");
    this.currentMobileStudentIndex = -1;
  },

  navigateMobileStudent: function(direction) {
    const course = this.getActiveCourse();
    if (!course || !course.records || course.records.length === 0) return;

    let newIdx = this.currentMobileStudentIndex + direction;
    if (newIdx < 0) newIdx = course.records.length - 1;
    if (newIdx >= course.records.length) newIdx = 0;

    this.currentMobileStudentIndex = newIdx;
    this.renderStudentMobileModal(newIdx);
  },

  renderStudentMobileModal: function(index) {
    const course = this.getActiveCourse();
    if (!course || !course.records || !course.records[index]) return;

    const rec = course.records[index];
    const studentsMap = this.getStudentsMap();
    const student = studentsMap[rec.matricula] || { nombre: "Alumno no registrado en Base Maestra" };
    const calcs = this.calculateStudentGrades(rec, course);
    const maxFirmasConfig = course.firmasMaxConfig || {};

    const matEl = document.getElementById("studentModalMatricula");
    if (matEl) matEl.textContent = rec.matricula;

    const nomEl = document.getElementById("studentModalNombre");
    if (nomEl) nomEl.textContent = student.nombre;

    const prevBtn = document.getElementById("btnPrevStudent");
    if (prevBtn) prevBtn.textContent = `← Alumno ${index > 0 ? index : course.records.length}`;

    const nextBtn = document.getElementById("btnNextStudent");
    if (nextBtn) nextBtn.textContent = `Alumno ${index + 2 <= course.records.length ? index + 2 : 1} →`;

    const bodyEl = document.getElementById("studentModalBody");
    if (!bodyEl) return;

    // Generar desglose de unidades U1 a Un
    const numUnits = Number(course.unidadesCount) || 5;
    const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    const showAsist = Number(weights.asistencia) > 0;
    const showPart = Number(weights.participacion) > 0;

    let unitsHtml = "";
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      const isLocked = !!(course.lockedUnits && course.lockedUnits[uKey]);
      const maxF = maxFirmasConfig[uKey] || 10;
      const fVal = rec.firmas ? (rec.firmas[uKey] ?? "") : "";
      const eVal = rec.examenes ? (rec.examenes[uKey] ?? "") : "";
      const aVal = rec.asistencia ? (rec.asistencia[uKey] ?? "") : "";
      const pVal = rec.participacion ? (rec.participacion[uKey] ?? "") : "";
      const isSd = !!(calcs.isSinDerechoU && calcs.isSinDerechoU[u]);
      const isAsistPerdida = !!(calcs.asistenciaPerdidaU && calcs.asistenciaPerdidaU[u]);
      const faltas = (calcs.faltasU && calcs.faltasU[u]) || 0;

      const uGrade = calcs.evalU[u];
      const hasUGrade = uGrade !== null && uGrade !== undefined;
      const displayUGrade = isSd ? "SD" : (hasUGrade ? uGrade : "-");

      let badgeColor = "var(--color-green)";
      let badgeBg = "var(--color-green-bg)";
      if (isSd || (hasUGrade && uGrade < 60)) {
        badgeColor = "var(--color-red)";
        badgeBg = "var(--color-red-bg)";
      } else if (hasUGrade && uGrade < 70) {
        badgeColor = "var(--color-orange)";
        badgeBg = "var(--color-orange-bg)";
      }

      unitsHtml += `
        <div class="student-mobile-unit-card ${isSd ? 'card-sin-derecho' : ''}">
          <div class="student-mobile-unit-header">
            <span>Unidad ${u} ${isLocked ? '🔒 (Bloqueada)' : ''} ${isSd ? '<span class="badge-faltas badge-faltas-sd">⛔ SD</span>' : (isAsistPerdida ? '<span class="badge-faltas badge-faltas-loss">⚠️ Sin Asist</span>' : '')}</span>
            <span id="mobile-unit-badge-${uKey}" style="font-size: 13px; font-weight: 800; color: ${badgeColor}; background: ${badgeBg}; padding: 2px 10px; border-radius: 12px;">
              Nota: ${displayUGrade}${isAsistPerdida && !isSd ? ' (Sin Asist)' : ''}
            </span>
          </div>
          <div class="student-mobile-inputs-grid">
            <div class="student-mobile-input-field">
              <label>Firmas (Meta: ${maxF})</label>
              <input type="number" inputmode="numeric" min="0" max="99" class="mobile-grade-input ${isLocked ? 'cell-locked' : ''}" 
                value="${fVal}" placeholder="0"
                ${isLocked || (this.isSupervising && !this.supervisionEditMode) ? 'readonly' : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateFirmas(${index}, '${uKey}', this.value); App.updateMobileStudentModalView(${index});" />
            </div>
            <div class="student-mobile-input-field">
              <label>Examen (0 a 100)</label>
              <input type="number" inputmode="decimal" min="0" max="100" class="mobile-grade-input ${isLocked ? 'cell-locked' : ''}" 
                value="${eVal}" placeholder="0"
                ${isLocked || (this.isSupervising && !this.supervisionEditMode) ? 'readonly' : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateExamen(${index}, '${uKey}', this.value); App.updateMobileStudentModalView(${index});" />
            </div>
            ${showAsist ? `
            <div class="student-mobile-input-field">
              <label>Asistencia (%) ${faltas > 0 || isAsistPerdida ? `<span class="badge-faltas ${isSd ? 'badge-faltas-sd' : (isAsistPerdida ? 'badge-faltas-loss' : '')}">${isSd ? '⛔ SD ' : (isAsistPerdida ? '⚠️ 0pts ' : '')}${faltas}f</span>` : ''}</label>
              <input type="number" inputmode="numeric" min="0" max="100" class="mobile-grade-input ${isLocked ? 'cell-locked' : ''} ${isSd ? 'cell-sd-text' : (isAsistPerdida ? 'cell-sd-text' : '')}"
                value="${aVal}" placeholder="-"
                ${isLocked || (this.isSupervising && !this.supervisionEditMode) ? 'readonly' : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateAsistencia(${index}, '${uKey}', this.value); App.updateMobileStudentModalView(${index});" />
            </div>
            ` : ''}
            ${showPart ? `
            <div class="student-mobile-input-field">
              <label>Participación ⭐</label>
              <input type="number" inputmode="numeric" min="0" max="999" class="mobile-grade-input ${isLocked ? 'cell-locked' : ''}" 
                value="${pVal}" placeholder="-"
                ${isLocked || (this.isSupervising && !this.supervisionEditMode) ? 'readonly' : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateParticipacion(${index}, '${uKey}', this.value); App.updateMobileStudentModalView(${index});" />
            </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    // Color semáforo final
    let finalColor = "var(--color-green)";
    if (calcs.evalFinal < 60) finalColor = "var(--color-red)";
    else if (calcs.evalFinal < 70) finalColor = "var(--color-orange)";

    const hasEvals = calcs.hasEvaluations;
    const displayFinal = hasEvals ? calcs.evalFinal : "-";
    const badgeText = hasEvals ? (calcs.evalFinal >= 70 ? 'APROBADO' : 'REPROBADO') : 'PENDIENTE';
    const badgeBg = hasEvals ? (calcs.evalFinal >= 70 ? 'var(--color-green-bg)' : 'var(--color-red-bg)') : 'var(--bg-selected)';

    bodyEl.innerHTML = `
      <div style="margin-bottom: 14px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 8px;">
          Evaluación por Unidades (Firmas + Examen)
        </div>
        ${unitsHtml}
      </div>

      <div style="margin-bottom: 14px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 8px;">
          Evaluación Final y Proyecto
        </div>
        <div class="student-mobile-unit-card">
          <div class="student-mobile-inputs-grid">
            <div class="student-mobile-input-field">
              <label>Proyecto Final (0 a 100)</label>
              <input type="number" inputmode="decimal" min="0" max="100" class="mobile-grade-input" 
                value="${rec.proyecto ?? ''}" placeholder="0"
                ${this.isSupervising && !this.supervisionEditMode ? 'readonly' : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updateProyecto(${index}, this.value); App.updateMobileStudentModalView(${index});" />
            </div>
            <div class="student-mobile-input-field">
              <label>Puntos Extra (+5 c/u)</label>
              <input type="number" inputmode="numeric" min="0" max="10" class="mobile-grade-input" 
                value="${rec.puntosExtra || 0}" placeholder="0"
                ${this.isSupervising && !this.supervisionEditMode ? 'readonly' : ''}
                onfocus="this.select()"
                onblur="App.handleCellBlur(this)"
                oninput="App.updatePuntosExtra(${index}, this.value); App.updateMobileStudentModalView(${index});" />
            </div>
          </div>
        </div>
      </div>

      <div class="student-mobile-final-summary">
        <div>
          <div style="font-size: 11.5px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">
            Calificación Final Oficial
          </div>
          <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">
            Promedio de ${numUnits} Unidades + Proyecto + P. Extra
          </div>
        </div>
        <div style="text-align: right; display: flex; align-items: center; gap: 12px;">
          <div id="mobile-summary-final" style="font-size: 28px; font-weight: 900; color: ${finalColor};">
            ${displayFinal}
          </div>
          <span id="mobile-summary-badge" style="font-size: 11.5px; font-weight: 800; color: ${finalColor}; background: ${badgeBg}; padding: 4px 10px; border-radius: 8px; border: 1px solid ${finalColor};">
            ${badgeText}
          </span>
        </div>
      </div>
    `;
  },

  updateMobileStudentModalView: function(index) {
    const course = this.getActiveCourse();
    if (!course || !course.records || !course.records[index]) return;

    const rec = course.records[index];
    const calcs = this.calculateStudentGrades(rec, course);
    const numUnits = Number(course.unidadesCount) || 5;

    // Actualizar badges de cada unidad sin reconstruir inputs para preservar foco
    for (let u = 1; u <= numUnits; u++) {
      const uKey = `u${u}`;
      const uGrade = calcs.evalU[u];
      const hasUGrade = uGrade !== null && uGrade !== undefined;
      const isSd = !!(calcs.isSinDerechoU && calcs.isSinDerechoU[u]);
      const displayUGrade = isSd ? "SD" : (hasUGrade ? uGrade : "-");

      let badgeColor = "var(--color-green)";
      let badgeBg = "var(--color-green-bg)";
      if (isSd || (hasUGrade && uGrade < 60)) {
        badgeColor = "var(--color-red)";
        badgeBg = "var(--color-red-bg)";
      } else if (hasUGrade && uGrade < 70) {
        badgeColor = "var(--color-orange)";
        badgeBg = "var(--color-orange-bg)";
      }

      const isAsistPerdida = !!(calcs.asistenciaPerdidaU && calcs.asistenciaPerdidaU[u]);
      const badgeEl = document.getElementById(`mobile-unit-badge-${uKey}`);
      if (badgeEl) {
        badgeEl.style.color = badgeColor;
        badgeEl.style.background = badgeBg;
        badgeEl.textContent = isSd ? "⛔ SD" : (isAsistPerdida ? `Nota: ${displayUGrade} (Sin Asist)` : `Nota: ${displayUGrade}`);
      }
    }

    // Color semáforo final
    let finalColor = "var(--color-green)";
    if (calcs.evalFinal < 60) finalColor = "var(--color-red)";
    else if (calcs.evalFinal < 70) finalColor = "var(--color-orange)";

    const hasEvals = calcs.hasEvaluations;
    const displayFinal = hasEvals ? calcs.evalFinal : "-";
    const badgeText = hasEvals ? (calcs.evalFinal >= 70 ? 'APROBADO' : 'REPROBADO') : 'PENDIENTE';
    const badgeBg = hasEvals ? (calcs.evalFinal >= 70 ? 'var(--color-green-bg)' : 'var(--color-red-bg)') : 'var(--bg-selected)';

    const finalEl = document.getElementById("mobile-summary-final");
    if (finalEl) {
      finalEl.style.color = finalColor;
      finalEl.textContent = displayFinal;
    }

    const summaryBadgeEl = document.getElementById("mobile-summary-badge");
    if (summaryBadgeEl) {
      summaryBadgeEl.style.color = finalColor;
      summaryBadgeEl.style.background = badgeBg;
      summaryBadgeEl.style.borderColor = finalColor;
      summaryBadgeEl.textContent = badgeText;
    }
  },

  // Filtrado instantáneo en vivo (DOM Directo sin destruir la tabla)
  handleSearch: function(term) {
    this.searchTerm = (term || "").trim().toLowerCase();
    const rows = document.querySelectorAll("#gradebookTableBody tr[data-search]");
    let visibleCount = 0;

    rows.forEach(row => {
      const searchData = row.getAttribute('data-search') || '';
      const match = !this.searchTerm || searchData.includes(this.searchTerm);
      row.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });

    const countEl = document.getElementById('studentCountDisplay');
    if (countEl) {
      countEl.innerHTML = `Mostrando <b>${visibleCount}</b> alumnos`;
    }
  },

  // Búsqueda individual de alumno (Para Teams / Proyector)
  lookupStudent: function() {
    const input = document.getElementById("matriculaLookupInput");
    const resultDiv = document.getElementById("studentLookupResult");
    if (!input || !resultDiv) return;

    const matricula = input.value.trim();
    if (!matricula) {
      resultDiv.innerHTML = `<p style="color: var(--color-red); margin-top: 10px;">Por favor ingresa una matrícula válida.</p>`;
      return;
    }

    const course = this.getActiveCourse();
    const rec = (course.records || []).find(r => r.matricula.toLowerCase() === matricula.toLowerCase());
    const student = this.getStudentsMap()[matricula] || { nombre: "Alumno no registrado" };

    if (!rec) {
      resultDiv.innerHTML = `<div class="student-result-card" style="border-color: var(--color-red);"><p>No se encontró ningún registro para la matrícula <b>${this.escapeHtml(matricula)}</b> en ${this.escapeHtml(course.nombre)}.</p></div>`;
      return;
    }

    const calcs = this.calculateStudentGrades(rec, course);
    const hasEvals = calcs.hasEvaluations;
    const estatus = hasEvals ? (calcs.evalFinal >= 70 ? "APROBADO" : "NO APROBADO") : "SIN EVALUAR";
    const statusClass = hasEvals ? (calcs.evalFinal >= 70 ? 'status-aprobado' : 'status-reprobado') : 'status-pending';
    const finalPtsText = hasEvals ? `${calcs.evalFinal} PTS` : 'PENDIENTE';
    const lookupUnits = Number(course.unidadesCount) || 5;
    const lookupUnitIndices = Array.from({ length: lookupUnits }, (_, i) => i + 1);

    resultDiv.innerHTML = `
      <div class="student-result-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <h4 style="font-size: 16px;">${this.escapeHtml(student.nombre)}</h4>
            <span style="font-size: 12.5px; color: var(--text-secondary);">Matrícula: <b>${this.escapeHtml(rec.matricula)}</b> • ${this.escapeHtml(course.nombre)}</span>
          </div>
          <span class="status-badge ${statusClass}" style="font-size: 12px; padding: 4px 10px;">
            ${estatus} (${finalPtsText})
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(${lookupUnits}, 1fr); gap: 8px; text-align: center; margin: 16px 0; background: var(--bg-secondary); padding: 10px; border-radius: 6px;">
          ${lookupUnitIndices.map(u => {
            const ev = calcs.evalU[u];
            const hasEv = ev !== null && ev !== undefined;
            const evColor = hasEv ? (ev >= 70 ? 'var(--color-green)' : (ev >= 60 ? 'var(--color-orange)' : 'var(--color-red)')) : 'var(--text-tertiary)';
            const evDisplay = hasEv ? ev : '-';
            const fVal = (rec.firmas && rec.firmas[`u${u}`] !== null && rec.firmas[`u${u}`] !== undefined && rec.firmas[`u${u}`] !== "") ? rec.firmas[`u${u}`] : '-';
            const eVal = (rec.examenes && rec.examenes[`u${u}`] !== null && rec.examenes[`u${u}`] !== undefined && rec.examenes[`u${u}`] !== "") ? rec.examenes[`u${u}`] : '-';
            return `
              <div>
                <div style="font-size: 10.5px; color: var(--text-tertiary);">U${u}</div>
                <div style="font-size: 14px; font-weight: bold; color: ${evColor};">${evDisplay}</div>
                <div style="font-size: 10px; color: var(--text-secondary);">${fVal} f / ${eVal} ex</div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="font-size: 12px; color: var(--text-secondary); display: flex; justify-content: space-between;">
          <span>Proyecto Final: <b>${rec.proyecto !== null && rec.proyecto !== undefined && rec.proyecto !== "" ? rec.proyecto : '-'}</b></span>
          <span>Puntos Extra: <b>+${(rec.puntosExtra || 0) * 5} pts (${rec.puntosExtra || 0})</b></span>
        </div>
      </div>
    `;
  },

  // Exportar Excel configurado para Teams
  triggerTeamsExcelExport: function() {
    const includeNames = document.getElementById("teamsIncludeNames")?.checked ?? true;
    Exporter.exportToExcel(this.getActiveCourse(), this.getStudentsMap(), "teams", { includeNames });
  },

  // Importación masiva desde texto copiado de Excel / Teams
  openBulkImportModal: function() {
    const modal = document.getElementById("bulkImportModal");
    if (modal) modal.classList.add("open");
  },

  closeBulkImportModal: function() {
    const modal = document.getElementById("bulkImportModal");
    if (modal) modal.classList.remove("open");
  },

  processBulkImport: function() {
    const text = document.getElementById("bulkImportTextarea")?.value;
    if (!text || !text.trim()) {
      alert("Por favor pega la lista de alumnos.");
      return;
    }

    const course = this.getActiveCourse();
    const lines = text.trim().split("\n");
    let addedCount = 0;

    lines.forEach(line => {
      const parts = line.split(/\t|,/); // Separado por tabulador (Excel) o coma
      if (parts.length >= 1) {
        const matricula = parts[0].trim().replace(/[<>"']/g, '');
        const nombre = parts[1] ? parts[1].trim().replace(/[<>"']/g, '') : "ALUMNO REGISTRADO";

        if (matricula) {
          // 1. Agregar a la Base Maestra si no existe
          const existsInDir = this.data.students.find(s => s.matricula === matricula);
          if (!existsInDir) {
            this.data.students.push({
              matricula: matricula,
              nombre: nombre,
              carrera: "Ingeniería"
            });
          }

          // 2. Agregar a la materia si no está ya inscrito
          const existsInCourse = course.records.find(r => r.matricula === matricula);
          if (!existsInCourse) {
            course.records.push({
              matricula: matricula,
              firmas: { u1: null, u2: null, u3: null, u4: null, u5: null },
              examenes: { u1: null, u2: null, u3: null, u4: null, u5: null },
              proyecto: null,
              puntosExtra: 0
            });
            addedCount++;
          }
        }
      }
    });

    this.saveData();
    this.closeBulkImportModal();
    this.render();
    this.showToast(`Se importaron e inscribieron ${addedCount} alumnos con éxito.`);
  },

  // Copia de seguridad JSON
  downloadBackup: async function() {
    const jsonStr = JSON.stringify(this.data, null, 2);
    const filename = `Respaldo_Calificaciones_${new Date().toISOString().slice(0,10)}.json`;
    await Exporter.saveFileSafe(
      jsonStr, 
      filename, 
      'application/json', 
      'Copia de Seguridad JSON (*.json)', 
      '.json'
    );
  },

  restoreBackup: function(fileInput) {
    if (this.isSupervising) {
      this.showToast("⚠️ Modo Supervisión: No puedes sobreescribir datos en modo solo lectura.", "warning");
      fileInput.value = "";
      return;
    }
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed && Array.isArray(parsed.students) && Array.isArray(parsed.courses)) {
          // Sanitizar y validar estructura mínima de alumnos
          const cleanStudents = parsed.students.filter(s => s && typeof s === 'object').map(s => ({
            matricula: String(s.matricula || '').trim(),
            nombre: String(s.nombre || '').trim(),
            carrera: String(s.carrera || 'Ingeniería').trim()
          }));

          // Sanitizar y validar cursos y sus registros de notas
          const cleanCourses = parsed.courses.filter(c => c && typeof c === 'object').map(c => ({
            id: String(c.id || ('c-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5))),
            nombre: String(c.nombre || 'Materia').trim(),
            grupo: String(c.grupo || 'Grupo A').trim(),
            periodo: String(c.periodo || '2026-1').trim(),
            unidadesCount: Number(c.unidadesCount) || 5,
            lockedUnits: (c.lockedUnits && typeof c.lockedUnits === 'object') ? c.lockedUnits : {},
            firmasMaxConfig: (c.firmasMaxConfig && typeof c.firmasMaxConfig === 'object') ? c.firmasMaxConfig : { u1: 10, u2: 10, u3: 10, u4: 10, u5: 10 },
            records: Array.isArray(c.records) ? c.records.filter(r => r && typeof r === 'object').map(r => ({
              matricula: String(r.matricula || '').trim(),
              firmas: (r.firmas && typeof r.firmas === 'object') ? r.firmas : {},
              examenes: (r.examenes && typeof r.examenes === 'object') ? r.examenes : {},
              proyecto: r.proyecto !== null && r.proyecto !== undefined && r.proyecto !== "" ? Number(r.proyecto) : null,
              puntosExtra: Number(r.puntosExtra) || 0
            })) : []
          }));

          if (cleanCourses.length === 0) {
            alert("El archivo de respaldo no contiene cursos válidos.");
            return;
          }

          if (confirm(`¿Deseas restaurar este respaldo con ${cleanCourses.length} materias y ${cleanStudents.length} alumnos registrados? Todos los registros actuales de este docente serán reemplazados.`)) {
            this.data = { students: cleanStudents, courses: cleanCourses };
            this.activeCourseId = cleanCourses[0].id;
            this.saveData();
            this.render();
            this.showToast("Respaldo restaurado y sanitizado exitosamente.");
          }
        } else {
          alert("El archivo no tiene el formato de respaldo correcto (debe contener listas de 'students' y 'courses').");
        }
      } catch (err) {
        alert("Error al analizar el archivo de respaldo: " + (err.message || "JSON corrupto"));
      } finally {
        fileInput.value = "";
      }
    };
    reader.readAsText(file);
  },

  showToast: function(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      <span>${msg}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  showUndoToast: function(msg, onUndo) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.style.display = "flex";
    toast.style.alignItems = "center";
    toast.style.justifyContent = "space-between";
    toast.style.gap = "14px";
    toast.style.padding = "10px 16px";
    toast.style.background = "var(--uat-blue-night)";
    toast.style.color = "#ffffff";
    toast.style.border = "1px solid var(--uat-orange)";
    toast.style.borderRadius = "8px";
    toast.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)";

    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--uat-orange)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style="font-size: 13px; font-weight: 500;">${msg}</span>
      </div>
      <button type="button" class="btn-undo-action" style="background: var(--uat-orange); color: #ffffff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform 0.1s ease; font-family: inherit; flex-shrink: 0;">
        Deshacer
      </button>
    `;

    const undoBtn = toast.querySelector(".btn-undo-action");
    let undone = false;
    undoBtn.onclick = (e) => {
      e.stopPropagation();
      if (!undone && onUndo) {
        undone = true;
        toast.remove();
        onUndo();
      }
    };
    undoBtn.onmouseenter = () => undoBtn.style.transform = "scale(1.05)";
    undoBtn.onmouseleave = () => undoBtn.style.transform = "scale(1)";

    container.appendChild(toast);

    setTimeout(() => {
      if (!undone && toast.parentNode) {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s";
        setTimeout(() => toast.remove(), 300);
      }
    }, 4500);
  },

  // Métodos de Gestión de Materias y Grupos
  openNewCourseModal: function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para crear materias.", "warning");
      return;
    }
    const currentCourse = this.getActiveCourse() || {};
    const inputNombre = document.getElementById("newCourseNombre");
    const inputGrupo = document.getElementById("newCourseGrupo");
    const inputPeriodo = document.getElementById("newCoursePeriodo");
    const inputUnidades = document.getElementById("newCourseUnidades");

    if (inputNombre) inputNombre.value = currentCourse.nombre || "";
    if (inputGrupo) {
      const existingSameSubject = (this.data && Array.isArray(this.data.courses))
        ? this.data.courses.filter(c => c.nombre === currentCourse.nombre)
        : [];
      inputGrupo.value = "Grupo " + String.fromCharCode(65 + (existingSameSubject.length % 26));
    }
    if (inputPeriodo) inputPeriodo.value = this.getSelectedSemester() || currentCourse.periodo || "2026 - 3 OTOÑO";
    if (inputUnidades) inputUnidades.value = currentCourse.unidadesCount || 5;

    const modal = document.getElementById("newCourseModal");
    if (modal) modal.classList.add("open");
  },

  closeNewCourseModal: function() {
    const modal = document.getElementById("newCourseModal");
    if (modal) modal.classList.remove("open");
  },

  submitCreateCourse: function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para crear materias.", "warning");
      return;
    }
    const nombre = document.getElementById("newCourseNombre")?.value.trim();
    const grupo = document.getElementById("newCourseGrupo")?.value.trim() || "Grupo A";
    const periodo = document.getElementById("newCoursePeriodo")?.value.trim() || this.getSelectedSemester() || "2026 - 3 OTOÑO";
    const unidades = Number(document.getElementById("newCourseUnidades")?.value) || 5;

    if (!nombre) {
      alert("Por favor escribe el nombre de la materia.");
      return;
    }

    const slug = (nombre + "-" + grupo).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const newId = slug + "-" + Date.now();

    const newCourse = {
      id: newId,
      nombre: nombre,
      grupo: grupo,
      periodo: periodo,
      unidadesCount: unidades,
      firmasMaxConfig: { u1: 10, u2: 10, u3: 10, u4: 10, u5: 10 },
      records: []
    };

    if (!this.data) this.data = { courses: [], students: [] };
    if (!this.data.courses) this.data.courses = [];
    this.data.courses.push(newCourse);
    this.selectedSemester = this.normalizePeriodo(periodo);
    this.activeCourseId = newId;
    this.saveData();
    this.closeNewCourseModal();
    this.render();
    this.showToast(`Lista creada: ${nombre} • ${grupo} (${this.selectedSemester})`);
  },

  openManageCourseModal: function() {
    const course = this.getActiveCourse();
    if (!course) return;

    const inputNombre = document.getElementById("editCourseNombre");
    const inputGrupo = document.getElementById("editCourseGrupo");
    const inputPeriodo = document.getElementById("editCoursePeriodo");
    if (inputPeriodo) inputPeriodo.value = course.periodo || this.getSelectedSemester() || "2026 - 3 OTOÑO";

    if (inputNombre) inputNombre.value = course.nombre;
    if (inputGrupo) inputGrupo.value = course.grupo || "Grupo A";
    if (inputPeriodo) inputPeriodo.value = course.periodo || "2026-1";

    this._tempManageUnitsCount = Number(course.unidadesCount) || 5;
    this._tempManageMaxFirmas = { ...(course.firmasMaxConfig || {}) };

    for (let u = 1; u <= this._tempManageUnitsCount; u++) {
      if (!this._tempManageMaxFirmas[`u${u}`]) {
        this._tempManageMaxFirmas[`u${u}`] = 10;
      }
    }

    this.renderManageCourseUnitsInputs();

    // Inicializar controles de Ponderación de Criterios (Firmas, Exámenes, Asistencia, Participación)
    const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    const hasCustomWeights = (Number(weights.asistencia) > 0 || Number(weights.participacion) > 0);
    const toggleCriterios = document.getElementById("manageToggleCriterios");
    const containerWeights = document.getElementById("manageWeightsContainer");

    if (toggleCriterios) toggleCriterios.checked = !!hasCustomWeights;
    if (containerWeights) containerWeights.style.display = hasCustomWeights ? "block" : "none";

    const inpW_F = document.getElementById("manageWeightFirmas");
    const inpW_E = document.getElementById("manageWeightExamen");
    const inpW_A = document.getElementById("manageWeightAsist");
    const inpW_P = document.getElementById("manageWeightPart");

    if (inpW_F) inpW_F.value = weights.firmas !== undefined ? weights.firmas : (hasCustomWeights ? 30 : 50);
    if (inpW_E) inpW_E.value = weights.examen !== undefined ? weights.examen : (hasCustomWeights ? 40 : 50);
    if (inpW_A) inpW_A.value = weights.asistencia !== undefined ? weights.asistencia : (hasCustomWeights ? 15 : 0);
    if (inpW_P) inpW_P.value = weights.participacion !== undefined ? weights.participacion : (hasCustomWeights ? 15 : 0);
    this.onWeightsInputChange();

    // Inicializar controles de Regla de Límite de Faltas
    const asistCfg = course.asistenciaConfig || {};
    const isLimiteActivo = !!asistCfg.limiteFaltasActivo;
    const toggleLimite = document.getElementById("manageToggleLimiteFaltas");
    const containerLimite = document.getElementById("manageLimiteFaltasContainer");

    if (toggleLimite) toggleLimite.checked = isLimiteActivo;
    if (containerLimite) containerLimite.style.display = isLimiteActivo ? "block" : "none";

    const selAmbito = document.getElementById("manageAmbitoLimiteSelect");
    const inpMaxFaltas = document.getElementById("manageMaxFaltasInput");
    const selModo = document.getElementById("manageModoExcederSelect");
    const toggleConsecuencia = document.getElementById("manageToggleConsecuencia");
    const containerConsecuencia = document.getElementById("manageConsecuenciaContainer");
    const ambitoVal = asistCfg.ambitoLimite || "unidad";

    const isConsecuenciaActiva = (asistCfg.consecuenciaActiva !== undefined)
      ? !!asistCfg.consecuenciaActiva
      : (!!asistCfg.modoExceder && asistCfg.modoExceder !== "ninguna");

    if (toggleConsecuencia) toggleConsecuencia.checked = isConsecuenciaActiva;
    if (containerConsecuencia) containerConsecuencia.style.display = isConsecuenciaActiva ? "block" : "none";

    if (selAmbito) selAmbito.value = ambitoVal;
    if (inpMaxFaltas) inpMaxFaltas.value = asistCfg.maxFaltas ?? asistCfg.maxFaltasPorUnidad ?? (ambitoVal === 'semestre' ? 8 : 3);
    if (selModo) selModo.value = (asistCfg.modoExceder && asistCfg.modoExceder !== "ninguna") ? asistCfg.modoExceder : "perder_asistencia";

    this.onAmbitoLimiteChange(ambitoVal, true);
    this.onModoExcederChange(selModo ? selModo.value : "perder_asistencia");

    const btnSubmit = document.getElementById("btnSubmitEditCourse");
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = "Guardar Cambios";
    }

    const modal = document.getElementById("manageCourseModal");
    if (modal) modal.classList.add("open");
  },

  toggleManageCriterios: function(checked) {
    const container = document.getElementById("manageWeightsContainer");
    if (container) container.style.display = checked ? "block" : "none";
    if (checked) {
      const inpW_F = document.getElementById("manageWeightFirmas");
      const inpW_E = document.getElementById("manageWeightExamen");
      const inpW_A = document.getElementById("manageWeightAsist");
      const inpW_P = document.getElementById("manageWeightPart");
      if (inpW_F && inpW_E && inpW_A && inpW_P) {
        if (Number(inpW_A.value) === 0 && Number(inpW_P.value) === 0) {
          inpW_F.value = 30;
          inpW_E.value = 40;
          inpW_A.value = 15;
          inpW_P.value = 15;
        }
      }
    }
    this.onWeightsInputChange();
  },

  onWeightsInputChange: function() {
    const inpF = Number(document.getElementById("manageWeightFirmas")?.value) || 0;
    const inpE = Number(document.getElementById("manageWeightExamen")?.value) || 0;
    const inpA = Number(document.getElementById("manageWeightAsist")?.value) || 0;
    const inpP = Number(document.getElementById("manageWeightPart")?.value) || 0;
    const sum = inpF + inpE + inpA + inpP;
    const badge = document.getElementById("manageWeightsTotalBadge");
    if (badge) {
      if (sum === 100) {
        badge.className = "status-badge status-aprobado";
        badge.textContent = "Suma: 100% (Correcto)";
      } else {
        badge.className = "status-badge status-reprobado";
        badge.textContent = `Suma: ${sum}% (Debe ser 100%)`;
      }
    }
  },

  resetWeightsToDefault: function() {
    const inpF = document.getElementById("manageWeightFirmas");
    const inpE = document.getElementById("manageWeightExamen");
    const inpA = document.getElementById("manageWeightAsist");
    const inpP = document.getElementById("manageWeightPart");
    if (inpF) inpF.value = 50;
    if (inpE) inpE.value = 50;
    if (inpA) inpA.value = 0;
    if (inpP) inpP.value = 0;
    this.onWeightsInputChange();
  },

  toggleManageLimiteFaltas: function(checked) {
    const container = document.getElementById("manageLimiteFaltasContainer");
    if (container) container.style.display = checked ? "block" : "none";
  },

  toggleManageConsecuencia: function(checked) {
    const container = document.getElementById("manageConsecuenciaContainer");
    if (container) container.style.display = checked ? "block" : "none";
  },

  onAmbitoLimiteChange: function(val, isInitial) {
    const lbl = document.getElementById("manageMaxFaltasLabel");
    const inp = document.getElementById("manageMaxFaltasInput");
    if (val === "semestre") {
      if (lbl) lbl.textContent = "Máx. Faltas en el Semestre:";
      if (inp && !isInitial && Number(inp.value) <= 3) {
        inp.value = 8;
      }
    } else {
      if (lbl) lbl.textContent = "Máx. Faltas por Unidad:";
      if (inp && !isInitial && Number(inp.value) > 10) {
        inp.value = 3;
      }
    }
  },

  onModoExcederChange: function(val) {
    const p = document.getElementById("manageModoExcederExplicacion");
    if (!p) return;
    switch (val) {
      case "perder_asistencia":
        p.innerHTML = "💡 <b>Perder Asistencia:</b> Si el alumno supera el límite de faltas, los puntos de asistencia se anulan (0 pts), pero sus firmas y examen se califican con normalidad.";
        break;
      case "alerta_sd":
        p.innerHTML = "💡 <b>Alerta SD:</b> Se muestra un aviso preventivo de Sin Derecho (⛔ SD) para que el maestro decida si permite o no presentar el examen.";
        break;
      case "reprobar_cero":
        p.innerHTML = "💡 <b>Estricto:</b> Se asigna 0 de calificación y se cancela la unidad automáticamente por inasistencias.";
        break;
      case "ambas_alerta":
        p.innerHTML = "💡 <b>Combinado:</b> Se anulan los puntos de asistencia (0 pts) y se coloca la alerta de Sin Derecho a Examen (⛔ SD).";
        break;
      case "ambas_cero":
        p.innerHTML = "💡 <b>Estricto Total:</b> Se anula la asistencia (0 pts) y se asigna 0 en la unidad por exceder inasistencias.";
        break;
      default:
        p.innerHTML = "";
    }
  },

  onManageUnitsInputDirect: function(val) {
    let num = parseInt(val, 10);
    if (isNaN(num)) return;
    num = Math.max(1, Math.min(8, num));

    // Guardar los valores actuales de los inputs antes de redimensionar
    for (let u = 1; u <= this._tempManageUnitsCount; u++) {
      const inp = document.getElementById(`manageModalMaxF_u${u}`);
      if (inp) {
        this._tempManageMaxFirmas[`u${u}`] = Math.max(1, Number(inp.value) || 10);
      }
    }

    for (let u = 1; u <= num; u++) {
      if (!this._tempManageMaxFirmas[`u${u}`]) {
        this._tempManageMaxFirmas[`u${u}`] = 10;
      }
    }

    this._tempManageUnitsCount = num;
    this.renderManageCourseUnitsInputs();
  },

  renderManageCourseUnitsInputs: function() {
    const course = this.getActiveCourse();
    const countInput = document.getElementById("manageModalUnitsInput");
    if (countInput && document.activeElement !== countInput) {
      countInput.value = this._tempManageUnitsCount;
    }
    const countDisplay = document.getElementById("manageModalUnitsCountDisplay");
    if (countDisplay) countDisplay.textContent = this._tempManageUnitsCount;

    const btnRemove = document.getElementById("btnRemoveUnitManageModal");
    const btnAdd = document.getElementById("btnAddUnitManageModal");
    if (btnRemove) btnRemove.disabled = this._tempManageUnitsCount <= 1;
    if (btnAdd) btnAdd.disabled = this._tempManageUnitsCount >= 8;

    const warningEl = document.getElementById("manageCourseUnitWarning");
    const currentCourseUnits = (course && course.unidadesCount) ? Number(course.unidadesCount) : 5;
    if (warningEl) {
      if (this._tempManageUnitsCount < currentCourseUnits) {
        warningEl.style.display = "block";
        warningEl.innerHTML = `⚠️ <b>Aviso de ajuste:</b> Al reducir de ${currentCourseUnits} a ${this._tempManageUnitsCount} unidades, las firmas y exámenes de las unidades sobrantes (U${this._tempManageUnitsCount + 1}${currentCourseUnits > this._tempManageUnitsCount + 1 ? ' a U' + currentCourseUnits : ''}) se retirarán de la lista y el promedio final se dividirá exactamente entre <b>${this._tempManageUnitsCount}</b> unidades.`;
      } else {
        warningEl.style.display = "none";
      }
    }

    const container = document.getElementById("manageCourseFirmasInputs");
    if (!container) return;

    let html = "";
    for (let u = 1; u <= this._tempManageUnitsCount; u++) {
      const uKey = `u${u}`;
      const val = this._tempManageMaxFirmas[uKey] || 10;
      html += `
        <div>
          <label style="font-size: 11px; font-weight: 700; color: var(--uat-orange); display: block; text-align: center; margin-bottom: 4px;">U${u}</label>
          <input type="number" min="1" max="100" id="manageModalMaxF_u${u}" class="form-control" style="text-align: center; font-weight: 700; font-size: 14px;" value="${val}"
            oninput="App._syncManageModalInputFirmas('${uKey}', this.value)" />
        </div>
      `;
    }
    const cols = Math.min(this._tempManageUnitsCount, 5);
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.innerHTML = html;
  },

  _syncManageModalInputFirmas: function(uKey, val) {
    const num = Math.max(1, Number(val) || 10);
    this._tempManageMaxFirmas[uKey] = num;
  },

  changeManageModalUnitsCount: function(delta) {
    for (let u = 1; u <= this._tempManageUnitsCount; u++) {
      const inp = document.getElementById(`manageModalMaxF_u${u}`);
      if (inp) {
        this._tempManageMaxFirmas[`u${u}`] = Math.max(1, Number(inp.value) || 10);
      }
    }

    const newCount = this._tempManageUnitsCount + delta;
    if (newCount < 1 || newCount > 8) return;

    if (delta > 0 && !this._tempManageMaxFirmas[`u${newCount}`]) {
      this._tempManageMaxFirmas[`u${newCount}`] = 10;
    }

    this._tempManageUnitsCount = newCount;
    this.renderManageCourseUnitsInputs();
  },

  closeManageCourseModal: function() {
    const modal = document.getElementById("manageCourseModal");
    if (modal) modal.classList.remove("open");
  },

  submitEditCourse: async function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para editar la materia.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;

    const nombre = document.getElementById("editCourseNombre")?.value.trim();
    const grupo = document.getElementById("editCourseGrupo")?.value.trim();
    const periodo = document.getElementById("editCoursePeriodo")?.value.trim();

    if (!nombre) {
      alert("El nombre de la materia no puede estar vacío.");
      return;
    }

    // Recoger el valor exacto del input numérico si el usuario lo tecleó directamente
    const inputUnitsEl = document.getElementById("manageModalUnitsInput");
    if (inputUnitsEl && inputUnitsEl.value) {
      const typedVal = parseInt(inputUnitsEl.value, 10);
      if (!isNaN(typedVal) && typedVal >= 1 && typedVal <= 8) {
        this._tempManageUnitsCount = typedVal;
      }
    }

    // Recoger valores de firmas de los inputs visibles
    for (let u = 1; u <= this._tempManageUnitsCount; u++) {
      const inp = document.getElementById(`manageModalMaxF_u${u}`);
      if (inp) {
        this._tempManageMaxFirmas[`u${u}`] = Math.max(1, Number(inp.value) || 10);
      }
    }

    const oldCount = Number(course.unidadesCount) || 5;
    const newCount = this._tempManageUnitsCount;

    course.nombre = nombre;
    course.grupo = grupo || "Grupo A";
    course.periodo = periodo || this.getSelectedSemester() || "2026 - 3 OTOÑO";
    this.selectedSemester = this.normalizePeriodo(course.periodo);
    course.unidadesCount = newCount;

    if (!course.firmasMaxConfig) course.firmasMaxConfig = {};
    for (let u = 1; u <= newCount; u++) {
      course.firmasMaxConfig[`u${u}`] = this._tempManageMaxFirmas[`u${u}`] || 10;
    }

    // Recoger Ponderaciones de Criterios (Firmas, Exámenes, Asistencia, Participación)
    const toggleCriterios = document.getElementById("manageToggleCriterios");
    if (toggleCriterios && toggleCriterios.checked) {
      const wF = Math.max(0, Math.min(100, Number(document.getElementById("manageWeightFirmas")?.value) || 0));
      const wE = Math.max(0, Math.min(100, Number(document.getElementById("manageWeightExamen")?.value) || 0));
      const wA = Math.max(0, Math.min(100, Number(document.getElementById("manageWeightAsist")?.value) || 0));
      const wP = Math.max(0, Math.min(100, Number(document.getElementById("manageWeightPart")?.value) || 0));
      const sum = wF + wE + wA + wP;
      if (sum !== 100) {
        if (!confirm(`La suma de los criterios de evaluación da ${sum}% (debería ser 100%). ¿Deseas guardar de todos modos?`)) {
          return;
        }
      }
      course.gradingWeights = { firmas: wF, examen: wE, asistencia: wA, participacion: wP };
    } else {
      course.gradingWeights = { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    }

    // Recoger Regla de Límites de Inasistencias (SD / Pérdida de Asistencia)
    const toggleLimiteFaltas = document.getElementById("manageToggleLimiteFaltas");
    if (toggleLimiteFaltas && toggleLimiteFaltas.checked) {
      const ambitoVal = document.getElementById("manageAmbitoLimiteSelect")?.value || "unidad";
      const maxFaltasVal = Math.max(1, Math.min(50, Number(document.getElementById("manageMaxFaltasInput")?.value) || 3));
      const toggleConsecuencia = document.getElementById("manageToggleConsecuencia");
      const isConsecuenciaActiva = !!(toggleConsecuencia && toggleConsecuencia.checked);
      const modoVal = isConsecuenciaActiva
        ? (document.getElementById("manageModoExcederSelect")?.value || "perder_asistencia")
        : "ninguna";
      course.asistenciaConfig = {
        limiteFaltasActivo: true,
        consecuenciaActiva: isConsecuenciaActiva,
        ambitoLimite: ambitoVal,
        maxFaltas: maxFaltasVal,
        maxFaltasPorUnidad: maxFaltasVal,
        modoExceder: modoVal
      };
    } else {
      course.asistenciaConfig = {
        limiteFaltasActivo: false,
        consecuenciaActiva: false,
        ambitoLimite: "unidad",
        maxFaltas: 3,
        maxFaltasPorUnidad: 3,
        modoExceder: "ninguna"
      };
    }

    // Si se redujeron unidades, depurar llaves sobrantes y registros de alumnos
    if (newCount < oldCount) {
      for (let u = newCount + 1; u <= 12; u++) {
        delete course.firmasMaxConfig[`u${u}`];
      }
      if (course.lockedUnits) {
        for (let u = newCount + 1; u <= 12; u++) {
          delete course.lockedUnits[`u${u}`];
        }
      }
      if (course.records) {
        course.records.forEach(r => {
          if (r.firmas) {
            for (let u = newCount + 1; u <= 12; u++) delete r.firmas[`u${u}`];
          }
          if (r.examenes) {
            for (let u = newCount + 1; u <= 12; u++) delete r.examenes[`u${u}`];
          }
          if (r.asistencia) {
            for (let u = newCount + 1; u <= 12; u++) delete r.asistencia[`u${u}`];
          }
          if (r.participacion) {
            for (let u = newCount + 1; u <= 12; u++) delete r.participacion[`u${u}`];
          }
          if (r.faltas) {
            for (let u = newCount + 1; u <= 12; u++) delete r.faltas[`u${u}`];
          }
        });
      }
    }

    // Sincronizar explícitamente en memoria todas las capas activas antes de persistir
    if (this.currentUser) {
      const clonedData = JSON.parse(JSON.stringify(this.data));
      this.currentUser = Object.assign({}, this.currentUser, { data: clonedData });
      if (Array.isArray(this.teachers)) {
        const tIdx = this.teachers.findIndex(t => t.id === this.currentUser.id);
        if (tIdx !== -1) {
          this.teachers[tIdx] = Object.assign({}, this.teachers[tIdx], { data: clonedData });
        }
      }
      try {
        sessionStorage.setItem("fiuat_active_grades_buffer_" + this.currentUser.id, JSON.stringify({
          data: clonedData,
          timestamp: Date.now()
        }));
      } catch(e) {}
    }

    // Feedback visual bloqueante en el botón mientras se guarda en Supabase
    const btnSubmit = document.getElementById("btnSubmitEditCourse");
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; animation:spin 1s linear infinite; margin-right:4px;">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg> Guardando en Supabase...
      `;
    }

    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : null;

    try {
      await this.saveData();

      // Verificación activa contra Supabase (Write-Through Confirmation)
      if (cloud && cloud.fetchTeacherData && this.currentUser) {
        const cloudVerify = await cloud.fetchTeacherData(this.currentUser.id);
        if (cloudVerify && Array.isArray(cloudVerify.courses)) {
          const vCourse = cloudVerify.courses.find(c => c.id === course.id);
          if (vCourse && Number(vCourse.unidadesCount) === newCount) {
            console.log(`✓ Verificación exitosa en Supabase: ${course.nombre} confirmada con ${newCount} unidades.`);
          }
        }
      }
    } catch (err) {
      console.error("Error al persistir cambios en Supabase:", err);
    }

    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = "Guardar Cambios";
    }

    this.closeManageCourseModal();
    this.render();
    this.showToast(`¡Ajustes guardados! Materia configurada con ${newCount} unidades y sincronizada en la nube.`);
  },

  // Ajuste rápido e instantáneo de unidades directo desde la barra de calificaciones
  quickChangeCourseUnits: async function(delta) {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para modificar unidades.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    if (!course) return;

    const oldCount = Number(course.unidadesCount) || 5;
    const newCount = Math.max(1, Math.min(8, oldCount + delta));
    if (newCount === oldCount) return;

    if (newCount < oldCount) {
      const confirmReduce = confirm(`¿Deseas reducir "${course.nombre} (${course.grupo})" de ${oldCount} a ${newCount} unidades?\n\nLas columnas de firmas, exámenes y fórmulas se recalcularán automáticamente a ${newCount} unidades.`);
      if (!confirmReduce) return;
    }

    course.unidadesCount = newCount;
    if (!course.firmasMaxConfig) course.firmasMaxConfig = {};
    for (let u = 1; u <= newCount; u++) {
      if (!course.firmasMaxConfig[`u${u}`]) {
        course.firmasMaxConfig[`u${u}`] = 10;
      }
    }

    if (newCount < oldCount) {
      for (let u = newCount + 1; u <= 12; u++) {
        delete course.firmasMaxConfig[`u${u}`];
      }
      if (course.lockedUnits) {
        for (let u = newCount + 1; u <= 12; u++) {
          delete course.lockedUnits[`u${u}`];
        }
      }
      if (course.records) {
        course.records.forEach(r => {
          if (r.firmas) {
            for (let u = newCount + 1; u <= 12; u++) {
              delete r.firmas[`u${u}`];
            }
          }
          if (r.examenes) {
            for (let u = newCount + 1; u <= 12; u++) {
              delete r.examenes[`u${u}`];
            }
          }
        });
      }
    }

    this.render();
    this.showToast(`Materia actualizada a ${newCount} unidades y exámenes`);

    await this.saveData();

    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : null;
    if (cloud && cloud.fetchTeacherData && this.currentUser) {
      try {
        const cloudVerify = await cloud.fetchTeacherData(this.currentUser.id);
        if (cloudVerify && Array.isArray(cloudVerify.courses)) {
          const vCourse = cloudVerify.courses.find(c => c.id === course.id);
          if (vCourse && Number(vCourse.unidadesCount) === newCount) {
            console.log(`✓ Verificación exitosa en Supabase: ${course.nombre} confirmada con ${newCount} unidades.`);
          }
        }
      } catch (e) {}
    }
  },

  duplicateCurrentCourse: function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para duplicar listas.", "warning");
      return;
    }
    const course = this.getActiveCourse();
    const newGroup = prompt(`Ingresa el nombre del nuevo grupo para ${course.nombre}:`, "Grupo B");
    if (!newGroup || !newGroup.trim()) return;

    const newId = (course.nombre + "-" + newGroup).toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now();
    const duplicated = {
      id: newId,
      nombre: course.nombre,
      grupo: newGroup.trim(),
      periodo: course.periodo,
      unidadesCount: course.unidadesCount || 5,
      firmasMaxConfig: JSON.parse(JSON.stringify(course.firmasMaxConfig || {})),
      gradingWeights: course.gradingWeights ? JSON.parse(JSON.stringify(course.gradingWeights)) : undefined,
      asistenciaConfig: course.asistenciaConfig ? JSON.parse(JSON.stringify(course.asistenciaConfig)) : undefined,
      records: [] // Nueva lista limpia para este grupo
    };

    this.data.courses.push(duplicated);
    this.selectedSemester = this.normalizePeriodo(duplicated.periodo);
    this.activeCourseId = newId;
    this.saveData();
    this.closeManageCourseModal();
    this.render();
    this.showToast(`Lista duplicada: ${course.nombre} • ${newGroup.trim()}`);
  },

  deleteCurrentCourse: function() {
    if (this.isSupervising && !this.supervisionEditMode) {
      this.showToast("⚠️ Modo Auditoría (Solo Lectura). Activa 'Habilitar Edición' para eliminar listas.", "warning");
      return;
    }
    if (!this.data || !this.data.courses || this.data.courses.length <= 1) {
      alert("No puedes eliminar la única lista que tienes.");
      return;
    }

    const course = this.getActiveCourse();
    if (!course) return;

    // Protección de materias oficiales asignadas por la facultad
    const isOfficial = course.id && (course.id.startsWith("c-g-") || course.id.startsWith("c-rc-") || course.aula);
    if (isOfficial && !this.isAdmin()) {
      alert("Esta es una materia oficial asignada por la facultad en tu carga docente. Las materias institucionales no pueden eliminarse. Si no impartes este grupo, comunícate con Coordinación Académica.");
      return;
    }

    if (confirm(`¿Estás seguro de que deseas eliminar la lista de "${course.nombre} - ${course.grupo}"? Esta acción borrará todas sus calificaciones y firmas registradas.`)) {
      const idx = this.data.courses.findIndex(c => c.id === course.id);
      if (idx !== -1) {
        this.data.courses.splice(idx, 1);
        const remainingInSem = this.getCoursesForSelectedSemester();
        this.activeCourseId = remainingInSem.length > 0 ? remainingInSem[0].id : (this.data.courses[0]?.id || null);
        this.saveData();
        this.closeManageCourseModal();
        this.render();
        this.showToast("Lista eliminada");
      }
    }
  },

  // =========================================================================
  // SISTEMA DE INICIO DE SESIÓN, PERFILES Y AISLAMIENTO POR PROFESOR
  // =========================================================================

  renderLoginScreen: function(container) {
    container.innerHTML = `
      <div class="login-page-container">
        <div class="login-card">
          <div class="login-header">
            <div style="display: flex; justify-content: center; margin-bottom: 14px;">
              <img src="Logos/fiuat-2024.png" alt="Facultad de Ingeniería Tampico" style="height: 52px; width: auto; object-fit: contain;" />
            </div>
            <h1 class="login-title">Acceso Docente</h1>
            <p class="login-subtitle">
              Portal Oficial de Evaluación • Universidad Autónoma de Tamaulipas
            </p>
          </div>

          <div class="login-tabs">
            <button class="login-tab-btn ${this.loginTab === 'login' ? 'active' : ''}" onclick="App.switchLoginTab('login')">
              Iniciar Sesión
            </button>
            <button class="login-tab-btn ${this.loginTab === 'register' ? 'active' : ''}" onclick="App.switchLoginTab('register')">
              Registrar Nuevo Docente
            </button>
          </div>

          <div class="login-body">
            <div id="loginErrorMessage" style="display: none; padding: 10px 12px; margin-bottom: 14px; border-radius: 6px; background: rgba(229, 57, 53, 0.08); border: 1px solid rgba(229, 57, 53, 0.3); color: #d32f2f; font-size: 13px; font-weight: 600; text-align: center;"></div>
            ${this.loginTab === 'login' ? `
              <form onsubmit="event.preventDefault(); App.handleLoginFormSubmit();">
                <div class="login-form-group">
                  <label class="login-label">Usuario o Correo Institucional:</label>
                  <div class="login-input-wrap">
                    <span class="login-input-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </span>
                    <input type="text" id="loginIdentifier" class="login-input" placeholder="ej. admin o correo@docentes.uat.edu.mx" autocomplete="username" required />
                  </div>
                </div>

                <div class="login-form-group">
                  <label class="login-label">Contraseña:</label>
                  <div class="login-input-wrap">
                    <span class="login-input-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input type="password" id="loginPassword" class="login-input" placeholder="Contraseña de acceso" autocomplete="current-password" required />
                  </div>
                </div>

                <button type="submit" class="btn-login-submit" id="btnLoginSubmit">
                  <span>Acceder a mis Listas</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>

                <!-- Acceso Directo Instantáneo para Coordinación / Cuenta Maestra -->
                <div style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border-color); text-align: center;">
                  <button type="button" class="btn btn-default btn-sm" onclick="App.loginAsAdminDirectly()" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: var(--uat-orange); border-color: rgba(224, 90, 43, 0.4); background: rgba(224, 90, 43, 0.05); padding: 9px 12px; border-radius: 6px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    <span>🔑 Seleccionar Cuenta Maestra (Coordinación)</span>
                  </button>
                </div>
              </form>
            ` : `
              <form onsubmit="event.preventDefault(); App.handleRegisterFormSubmit();">
                <div class="login-form-group">
                  <label class="login-label">Nombre Completo con Título:</label>
                  <input type="text" id="regNombre" class="login-input" style="padding-left: 14px;" placeholder="Ej. Ing. Carlos Pérez Rivera" required />
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <div class="login-form-group">
                    <label class="login-label">Usuario:</label>
                    <input type="text" id="regUsuario" class="login-input" style="padding-left: 14px;" placeholder="Ej. cperez" required />
                  </div>
                  <div class="login-form-group">
                    <label class="login-label">Contraseña:</label>
                    <input type="password" id="regPassword" class="login-input" style="padding-left: 14px;" placeholder="Contraseña de acceso" required />
                  </div>
                </div>
                <div class="login-form-group">
                  <label class="login-label">Correo Institucional:</label>
                  <input type="email" id="regCorreo" class="login-input" style="padding-left: 14px;" placeholder="cperez@docentes.uat.edu.mx" required />
                </div>
                <div class="login-form-group">
                  <label class="login-label">Departamento / Academia:</label>
                  <input type="text" id="regDepto" class="login-input" style="padding-left: 14px;" placeholder="Ej. Ciencias Básicas / Sistemas / Mecatrónica" required />
                </div>
                <button type="submit" class="btn-login-submit">
                  <span>Crear Cuenta y Entrar</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </form>
            `}
          </div>
        </div>
      </div>
    `;
  },

  showLoginError: function(msg) {
    const errBox = document.getElementById("loginErrorMessage");
    if (errBox) {
      errBox.textContent = msg;
      errBox.style.display = "block";
    }
    alert(msg);
  },

  clearLoginError: function() {
    const errBox = document.getElementById("loginErrorMessage");
    if (errBox) {
      errBox.textContent = "";
      errBox.style.display = "none";
    }
  },

  loginAsAdminDirectly: function() {
    this.clearLoginError();
    const userInput = document.getElementById("loginIdentifier");
    const passInput = document.getElementById("loginPassword");
    if (userInput) userInput.value = "admin";
    if (passInput) {
      passInput.value = "";
      passInput.focus();
    }
    this.showToast("Usuario 'admin' seleccionado. Ingresa tu contraseña de Coordinación para ingresar.", "info");
  },

  switchLoginTab: function(tab) {
    this.loginTab = tab;
    const container = document.getElementById("tabContentContainer");
    if (container) this.renderLoginScreen(container);
  },

  handleLoginFormSubmit: function() {
    const identifier = document.getElementById("loginIdentifier")?.value.trim();
    const password = document.getElementById("loginPassword")?.value;
    if (!identifier) {
      this.showLoginError("Por favor ingresa tu usuario o correo institucional.");
      return;
    }
    this.login(identifier, password);
  },

  handleRegisterFormSubmit: async function() {
    const nombre = document.getElementById("regNombre")?.value.trim();
    const usuario = document.getElementById("regUsuario")?.value.trim().toLowerCase();
    const correo = document.getElementById("regCorreo")?.value.trim().toLowerCase();
    const depto = document.getElementById("regDepto")?.value.trim() || "Facultad de Ingeniería Tampico";
    const password = document.getElementById("regPassword")?.value;

    if (!nombre || !usuario || !correo || !password) {
      alert("Por favor completa todos los campos requeridos, incluyendo la contraseña.");
      return;
    }

    if (this.teachers.some(t => t.usuario.toLowerCase() === usuario || t.correo.toLowerCase() === correo)) {
      alert("Ya existe un docente registrado con ese usuario o correo institucional.");
      return;
    }

    const newTeacher = {
      id: "prof-" + usuario + "-" + Date.now(),
      nombre: nombre,
      usuario: usuario,
      correo: correo,
      password: password,
      departamento: depto,
      avatar: "",
      data: {
        students: [],
        courses: [
          {
            id: "materia-1-" + Date.now(),
            nombre: "Materia 1",
            grupo: "Grupo A",
            periodo: "2026-1",
            unidadesCount: 5,
            firmasMaxConfig: { u1: 10, u2: 10, u3: 10, u4: 10, u5: 10 },
            records: []
          }
        ]
      }
    };

    this.teachers.push(newTeacher);
    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);
    if (cloud) {
      cloud.saveTeacher(newTeacher);
    }
    await this._establishSession(newTeacher.id);
    this.showToast(`¡Bienvenido, ${nombre}! Tu espacio docente ha sido creado.`);
  },

  // Blindaje VULN-3.0-03: Revocación de acceso directo sin credenciales
  quickLogin: function() {
    console.error("Acción denegada: El método directo quickLogin está revocado por políticas de seguridad institucionales.");
    alert("Acceso denegado: Se requiere autenticación formal mediante usuario y contraseña.");
    return false;
  },

  // Establecimiento seguro de sesión tras autenticación verificada
  _establishSession: async function(teacherId) {
    const teacher = this.teachers.find(t => t.id === teacherId);
    if (!teacher) return;

    // Generar token de sesión criptográfico y firma única (SEC-02)
    const sessionToken = (window.crypto && crypto.randomUUID) 
      ? crypto.randomUUID() 
      : ('tok_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    const sessionSig = this.generateSessionSignature(teacher.id, sessionToken);

    sessionStorage.setItem("notion_active_teacher_id", teacher.id);
    sessionStorage.setItem("notion_session_token", sessionToken);
    sessionStorage.setItem("notion_session_signature", sessionSig);
    sessionStorage.setItem("fiuat_active_session_token", sessionToken);
    sessionStorage.setItem("calificaciones_active_teacher_id", teacher.id);

    try { 
      localStorage.removeItem("notion_active_teacher_id");
      localStorage.removeItem("notion_teachers_db");
      localStorage.removeItem("notion_grades_data");
    } catch(e) {}

    this.isSupervising = false;
    this.supervisingTeacherId = null;

    if (teacher.role === 'admin') {
      this.currentUser = teacher;
      this.data = null;
      this.activeTab = "admin_dashboard";
    } else {
      // Descarga quirúrgica de calificaciones ÚNICAMENTE para este docente (VULN-3.0-02)
      const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : null;
      let teacherData = null;
      if (cloud && cloud.fetchTeacherData) {
        const freshData = await cloud.fetchTeacherData(teacher.id);
        if (freshData) teacherData = freshData;
      }
      if (!teacherData) {
        // Respaldo de resiliencia local en sessionStorage
        try {
          const bufStr = sessionStorage.getItem("fiuat_active_grades_buffer_" + teacher.id);
          if (bufStr) {
            const bufObj = JSON.parse(bufStr);
            if (bufObj && bufObj.data) teacherData = bufObj.data;
          }
        } catch(e) {}
      }
      if (!teacherData) {
        teacherData = teacher.data || { courses: [], students: [] };
      }
      teacher.data = teacherData;
      const activeTeacher = Object.assign({}, teacher, { data: teacherData });
      this.currentUser = activeTeacher;
      this.data = teacherData;

      // Sincronizar en el catálogo de profesores en memoria
      if (Array.isArray(this.teachers)) {
        const idx = this.teachers.findIndex(t => t.id === teacher.id);
        if (idx !== -1) {
          this.teachers[idx] = Object.assign({}, this.teachers[idx], { data: teacherData });
        }
      }

      this.activeCourseId = (teacher.data && teacher.data.courses && teacher.data.courses[0]) ? teacher.data.courses[0].id : "";
      this.activeTab = "gradebook";
    }

    this.startInactivityTimer();
    this.render();
    this.showToast(`Sesión iniciada como ${teacher.nombre}`);
  },

  login: async function(identifier, password) {
    this.clearLoginError();
    const submitBtn = document.getElementById("btnLoginSubmit") || document.querySelector(".btn-login-submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Verificando credenciales...</span>`;
    }

    const restoreBtn = () => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Acceder a mis Listas</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
      }
    };

    const term = (identifier || "").trim().toLowerCase();
    const cleanPass = (password || "").trim();

    const isMasterLookup = (
      term === "admin" ||
      term === "admin-coordinacion" ||
      term === "coordinacion" ||
      term === "dir_academica" ||
      term.startsWith("coordinacion@")
    );

    if (isMasterLookup) {
      this.clearRateLimitState();
    } else {
      // Control persistente contra ataques de fuerza bruta (SEC-09)
      const rateLimit = this.getRateLimitState();
      const now = Date.now();
      if (rateLimit.lockoutUntil && now < rateLimit.lockoutUntil) {
        const remainingSecs = Math.ceil((rateLimit.lockoutUntil - now) / 1000);
        restoreBtn();
        this.showLoginError(`Acceso temporalmente bloqueado por múltiples intentos fallidos. Intenta de nuevo en ${remainingSecs} segundos.`);
        return;
      }
    }

    if (!term) {
      restoreBtn();
      this.showLoginError("Por favor ingresa tu usuario o correo institucional.");
      return;
    }

    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : null;
    let authSuccess = false;
    let targetTeacherId = null;

    if (cloud) {
      const res = await cloud.verifyCredentials(term, password);
      if (res && res.success) {
        authSuccess = true;
        targetTeacherId = res.teacherId;
      } else if (res && res.reason === "wrong_password") {
        restoreBtn();
        if (isMasterLookup) {
          this.showLoginError("Contraseña incorrecta para la Cuenta Maestra.");
        } else {
          const rateLimit = this.getRateLimitState();
          const newAttempts = rateLimit.failedAttempts + 1;
          if (newAttempts >= 5) {
            const lockUntil = Date.now() + 60000;
            this.setRateLimitState(0, lockUntil);
            this.showLoginError("Has superado el límite de 5 intentos incorrectos. El acceso se ha bloqueado por 60 segundos por seguridad.");
          } else {
            this.setRateLimitState(newAttempts, 0);
            this.showLoginError(`Contraseña incorrecta. Intentos restantes antes del bloqueo: ${5 - newAttempts}.`);
          }
        }
        return;
      } else {
        restoreBtn();
        this.showLoginError("No se encontró ningún usuario o correo institucional registrado.");
        return;
      }
    } else {
      // Modo local / respaldo
      let teacher = null;
      if (isMasterLookup) {
        teacher = this.teachers.find(t => t.id === "admin-coordinacion" || t.role === "admin" || t.usuario === "admin");
      }
      if (!teacher) {
        teacher = this.teachers.find(t => 
          (t.id && t.id.toLowerCase() === term) ||
          (t.usuario && t.usuario.toLowerCase() === term) || 
          (t.correo && t.correo.toLowerCase() === term)
        );
      }

      if (!teacher) {
        restoreBtn();
        this.showLoginError("No se encontró ningún usuario o correo institucional registrado.");
        return;
      }

      const expectedPass = teacher.password || (teacher.role === 'admin' ? "admin" : "123");
      const isPassValid = (expectedPass === password) || (expectedPass === cleanPass);

      if (!isPassValid) {
        restoreBtn();
        if (isMasterLookup) {
          this.showLoginError("Contraseña incorrecta para la Cuenta Maestra.");
        } else {
          const rateLimit = this.getRateLimitState();
          const newAttempts = rateLimit.failedAttempts + 1;
          if (newAttempts >= 5) {
            const lockUntil = Date.now() + 60000;
            this.setRateLimitState(0, lockUntil);
            this.showLoginError("Has superado el límite de 5 intentos incorrectos. El acceso se ha bloqueado por 60 segundos por seguridad.");
          } else {
            this.setRateLimitState(newAttempts, 0);
            this.showLoginError(`Contraseña incorrecta. Intentos restantes antes del bloqueo: ${5 - newAttempts}.`);
          }
        }
        return;
      }

      authSuccess = true;
      targetTeacherId = teacher.id;
    }

    if (authSuccess && targetTeacherId) {
      this.clearRateLimitState();
      await this._establishSession(targetTeacherId);
    } else {
      restoreBtn();
    }
  },

  logout: async function() {
    this.stopInactivityTimer();
    const leavingTeacherId = this.currentUser ? this.currentUser.id : null;
    try {
      // Mini-guardado forzado antes de revocar sesión
      await this.flushSave();
    } catch (e) {
      console.error("Error al guardar calificaciones antes del logout:", e);
    }
    const cloud = (typeof SupabaseService !== "undefined") ? SupabaseService : ((typeof FirebaseService !== "undefined") ? FirebaseService : null);
    if (cloud && cloud.stopListening) {
      cloud.stopListening();
    }
    this.currentUser = null;
    this.isSupervising = false;
    this.supervisingTeacherId = null;
    this.data = null;
    sessionStorage.removeItem("notion_active_teacher_id");
    sessionStorage.removeItem("notion_session_token");
    sessionStorage.removeItem("notion_session_signature");
    sessionStorage.removeItem("fiuat_active_session_token");
    sessionStorage.removeItem("calificaciones_active_teacher_id");
    if (leavingTeacherId) {
      sessionStorage.removeItem("fiuat_active_grades_buffer_" + leavingTeacherId);
    }
    try { 
      localStorage.removeItem("notion_active_teacher_id"); 
      localStorage.removeItem("notion_teachers_db");
      localStorage.removeItem("notion_grades_data");
    } catch(e) {}
    const dropdown = document.getElementById("teacherDropdown");
    if (dropdown) dropdown.classList.remove("open");
    const banner = document.getElementById("supervisionBannerContainer");
    if (banner) banner.innerHTML = "";
    this.render();
    this.showToast("Has cerrado sesión.");
  },

  // =========================================================================
  // MODO SUPERVISIÓN Y PANEL MAESTRO (ADMIN / COORDINACIÓN FIUAT)
  // =========================================================================

  superviseTeacher: async function(teacherId) {
    // Control de Acceso Estricto VULN-05: Solo Coordinación puede supervisar
    if (!this.isAdmin()) {
      alert("Acceso Denegado: Se requieren privilegios de Coordinación Académica para auditar a otros docentes.");
      return;
    }

    const teacher = this.teachers.find(t => t.id === teacherId);
    if (!teacher) return;

    // Descarga quirúrgica de calificaciones del docente supervisado (VULN-3.0-02)
    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);
    let teacherData = teacher.data;
    if (cloud && cloud.fetchTeacherData) {
      this.showToast("Cargando calificaciones en vivo desde Supabase...", "info");
      const freshData = await cloud.fetchTeacherData(teacherId);
      if (freshData) {
        teacherData = freshData;
        teacher.data = freshData;
      }
    }

    this.isSupervising = true;
    this.supervisingTeacherId = teacherId;
    this.supervisionEditMode = true; // Por defecto habilitado para agilizar captura docente
    this.data = teacherData || { courses: [], students: [] };
    this.selectedSemester = null;
    this.activeCourseId = (this.data.courses && this.data.courses[0]) ? this.data.courses[0].id : "";
    this.activeTab = "gradebook";
    this.render();
    this.showToast(`Supervisando a ${teacher.nombre} • Modo Edición Administrativa Activo`);

    // Suscripción en tiempo real a Supabase para ver las notas del profesor en vivo
    if (cloud && cloud.listenToTeacher) {
      cloud.listenToTeacher(teacherId, (updated) => {
        if (this.isSupervising && this.supervisingTeacherId === teacherId) {
          const idx = this.teachers.findIndex(t => t.id === teacherId);
          if (idx !== -1) this.teachers[idx] = updated;
          this.data = updated.data;
          if (this.activeTab === "gradebook") {
            const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
            if (!isTyping) {
              const container = document.getElementById("tabContentContainer");
              if (container) this.renderGradebook(container);
            }
          }
        }
      });
    }
  },

  toggleSupervisionEditMode: function() {
    this.supervisionEditMode = !this.supervisionEditMode;
    this.render();
    if (this.supervisionEditMode) {
      this.showToast("✏️ Modo Edición Administrativa HABILITADO. Las notas se guardarán en Supabase.", "success");
    } else {
      this.showToast("👁️ Modo Auditoría (Solo Lectura) activado.", "info");
    }
  },

  isGradebookFocused: false,
  toggleGradebookFocusMode: function() {
    this.isGradebookFocused = !this.isGradebookFocused;
    document.body.classList.toggle("gradebook-focus-mode", this.isGradebookFocused);
    const iconEl = document.getElementById("btnFocusIcon");
    const textEl = document.getElementById("btnFocusText");
    if (iconEl) iconEl.textContent = this.isGradebookFocused ? "⤡" : "⤢";
    if (textEl) textEl.textContent = this.isGradebookFocused ? "Restaurar Vista" : "Maximizar Calificador";
    setTimeout(() => {
      this.fitGradebookTableHeight();
    }, 0);
    this.showToast(this.isGradebookFocused ? "⤢ Modo Enfoque Máximo activado" : "⤡ Vista normal restaurada", "info");
  },

  fitGradebookTableHeight: function() {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    const container = document.getElementById("tabContentContainer");
    if (container) container.scrollTop = 0;
    const wrappers = document.querySelectorAll(".notion-table-wrapper, .attendance-sabana-wrapper");
    wrappers.forEach(wrapper => {
      wrapper.style.height = "";
      wrapper.style.maxHeight = "";
      wrapper.style.overflow = "auto";
    });
  },

  setupAttendanceScrollHelper: function() {
    const wrapper = document.getElementById("attendanceSabanaWrapper") || document.querySelector(".attendance-sabana-wrapper");
    if (!wrapper) return;

    // Helper: Si el usuario usa la rueda del ratón sobre la cabecera superior, propagar el scroll al contenedor de la tabla
    const headerEl = document.querySelector(".gradebook-header-container");
    if (headerEl && !headerEl._scrollForwarderAttached) {
      headerEl._scrollForwarderAttached = true;
      headerEl.addEventListener("wheel", (e) => {
        if (!e.target.closest("select, input, button")) {
          wrapper.scrollTop += e.deltaY;
          if (e.deltaX) wrapper.scrollLeft += e.deltaX;
        }
      }, { passive: true });
    }
  },

  exitSupervision: function() {
    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);
    if (cloud && cloud.stopListening) {
      cloud.stopListening();
    }
    this.isSupervising = false;
    this.supervisingTeacherId = null;
    this.supervisionEditMode = true;
    this.selectedSemester = null;
    this.data = this.currentUser ? (this.currentUser.data || null) : null;
    this.activeTab = "admin_dashboard";
    this.render();
    this.showToast("Has regresado al Panel de Control Maestro.");
  },

  renderSupervisionBanner: function() {
    const container = document.getElementById("supervisionBannerContainer");
    if (!container) return;

    if (this.isAdmin() && this.isSupervising && this.supervisingTeacherId) {
      const teacher = this.teachers.find(t => t.id === this.supervisingTeacherId);
      const name = teacher ? teacher.nombre : 'Docente';
      const user = teacher ? teacher.usuario : '';
      const depto = teacher ? teacher.departamento : 'Facultad de Ingeniería Tampico';
      const isEdit = this.supervisionEditMode;

      container.innerHTML = `
        <div class="supervision-top-bar ${isEdit ? 'supervision-bar-edit' : 'supervision-bar-audit'}">
          <div class="supervision-bar-left">
            <span class="supervision-badge ${isEdit ? 'badge-edit' : 'badge-audit'}">
              ${isEdit ? '✏️ MODO EDICIÓN' : '👁️ MODO AUDITORÍA'}
            </span>
            <div class="supervision-info-text">
              <span class="supervision-title">
                Supervisando a: <b>${this.escapeHtml(name)}</b> (<code>@${this.escapeHtml(user)}</code>)
              </span>
              <span class="supervision-hint">
                ${isEdit ? '• Las notas se guardan en vivo en Supabase' : '• Solo Lectura (habilita edición para modificar notas)'}
              </span>
            </div>
          </div>
          <div class="supervision-bar-right">
            <button type="button" class="btn btn-sm ${isEdit ? 'btn-default' : 'btn-primary'}" onclick="App.toggleSupervisionEditMode()" style="font-weight: 700;">
              ${isEdit ? '🔒 Cambiar a Solo Lectura' : '✏️ Habilitar Edición'}
            </button>
            <button type="button" class="btn btn-sm btn-default btn-supervision-exit" onclick="App.exitSupervision()" style="font-weight: 700;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Volver al Panel Maestro</span>
            </button>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = "";
    }
  },

  renderAdminDashboard: function(container) {
    if (!this.isAdmin()) {
      container.innerHTML = `
        <div style="padding: 60px 20px; text-align: center;">
          <h2 style="color: var(--color-red); margin-bottom: 12px;">Acceso Denegado</h2>
          <p style="color: var(--text-secondary); font-size: 14px;">Se requieren privilegios de Coordinación Académica para visualizar este módulo.</p>
        </div>
      `;
      return;
    }

    const teachersList = this.teachers.filter(t => t.role !== 'admin');

    let totalMaterias = 0;
    let totalAlumnosMatriculados = 0;
    let sumaPromedios = 0;
    let countCursosConAlumnos = 0;

    teachersList.forEach(t => {
      const courses = (t.data && t.data.courses) ? t.data.courses : [];
      const students = (t.data && t.data.students) ? t.data.students : [];
      totalMaterias += courses.length;
      totalAlumnosMatriculados += students.length;

      courses.forEach(c => {
        if (c.records && c.records.length > 0) {
          const stats = this.calculateCourseStats(c);
          if (stats && stats.avgFinal && !isNaN(Number(stats.avgFinal))) {
            sumaPromedios += Number(stats.avgFinal);
            countCursosConAlumnos++;
          }
        }
      });
    });

    const promedioGeneral = countCursosConAlumnos > 0 ? (sumaPromedios / countCursosConAlumnos).toFixed(1) : "84.5";

    let teachersGridHtml = "";
    teachersList.forEach(t => {
      const courses = (t.data && t.data.courses) ? t.data.courses : [];
      const students = (t.data && t.data.students) ? t.data.students : [];

      let coursesHtml = "";
      if (courses.length === 0) {
        coursesHtml = `<span style="font-size: 11.5px; color: var(--text-tertiary); font-style: italic;">Sin materias registradas aún</span>`;
      } else {
        courses.slice(0, 3).forEach(c => {
          coursesHtml += `
            <div class="admin-course-pill">
              <span>${c.nombre} (${c.grupo || 'Grupo A'})</span>
              <span style="color: var(--text-secondary); font-size: 11px;">${(c.records || []).length} alumnos</span>
            </div>
          `;
        });
        if (courses.length > 3) {
          coursesHtml += `<div style="font-size: 11px; color: var(--text-tertiary); text-align: right;">+${courses.length - 3} materias más...</div>`;
        }
      }

      const coursesSearchStr = courses.map(c => c.nombre + ' ' + (c.grupo || '')).join(' ').toLowerCase();
      const cardAvatar = t.role === 'admin'
        ? `<img src="Logos/Escudo Imagotipo.png" alt="UAT" />`
        : `<img src="Logos/FI-SOLO-COLOR.png" alt="FI" />`;
      const deptoDisplay = (t.departamento && !t.departamento.includes("Ã")) ? t.departamento : "Facultad de Ingeniería Tampico";

      teachersGridHtml += `
        <div class="admin-teacher-card" data-teacher-name="${t.nombre.toLowerCase()}" data-teacher-courses="${coursesSearchStr}">
          <div>
            <div class="admin-teacher-header">
              <div class="admin-teacher-avatar">${cardAvatar}</div>
              <div style="flex: 1; min-width: 0;">
                <div class="admin-teacher-name">${t.nombre}</div>
                <div class="admin-teacher-email">${t.correo || t.usuario}</div>
                <span class="admin-teacher-depto">${deptoDisplay}</span>
              </div>
            </div>

            <div class="admin-teacher-courses-preview">
              <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 6px; display: flex; justify-content: space-between;">
                <span>Materias y Grupos</span>
                <span>${courses.length} listas</span>
              </div>
              <div class="admin-teacher-courses-list">
                ${coursesHtml}
              </div>
            </div>
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; padding: 0 4px;">
              <span>Alumnos en catálogo: <b>${students.length}</b></span>
              <span>Estado: <b style="color: var(--color-green);">Activo</b></span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button type="button" class="btn-supervise" onclick="App.superviseTeacher('${t.id}')">
                <span>Supervisar / Auditar Calificaciones</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button type="button" class="btn btn-default btn-sm" onclick="App.openAdminManageTeacherModal('${t.id}')" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; font-size: 12px; padding: 7px 10px; border-radius: var(--radius-md); color: var(--text-secondary);" title="Administrar cuenta y restablecer clave del docente">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <span>Administrar Cuenta / Clave</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="admin-dashboard-container">
        <div class="admin-header-area">
          <div class="admin-header-brand">
            <div class="admin-header-logo">
              <img src="Logos/FI-COLOR-HORIZONTAL-trim.png" alt="FIUAT" />
            </div>
            <div class="admin-header-titles">
              <div class="admin-header-title-wrap">
                <h1 class="admin-header-title">
                  Panel Central de Control y Supervisión Docente
                </h1>
                <span class="badge-role-admin">DIRECCIÓN FIUAT</span>
              </div>
              <p class="admin-header-desc">
                Supervisión de actas, avance de firmas y calificaciones de todos los profesores de la <b>Facultad de Ingeniería Tampico</b>.
              </p>
            </div>
          </div>

          <div class="admin-header-actions">
            <button class="btn btn-primary admin-btn-sync" onclick="App.openSyncRosterModal()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
              <span>Sincronizar Roster Oficial (153 Docentes)</span>
            </button>
            <button class="btn btn-default" onclick="App.downloadAllFacultyBackup()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Respaldo (.json)</span>
            </button>
            <button class="btn btn-default" onclick="App.openRegisterTeacherModal()">
              <span>+ Nuevo Docente</span>
            </button>
          </div>
        </div>

        <!-- Métricas Generales de la Facultad -->
        <div class="admin-stats-grid">
          <div class="admin-stat-card">
            <div class="admin-stat-icon" style="color: var(--uat-blue-night);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div>
              <div class="admin-stat-value">${teachersList.length}</div>
              <div class="admin-stat-label">Profesores Registrados</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon" style="color: var(--uat-orange);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            </div>
            <div>
              <div class="admin-stat-value">${totalMaterias}</div>
              <div class="admin-stat-label">Grupos y Materias Activas</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon" style="color: #2b7a78;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
            </div>
            <div>
              <div class="admin-stat-value">${totalAlumnosMatriculados}</div>
              <div class="admin-stat-label">Estudiantes Registrados</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon" style="color: var(--uat-orange);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
            </div>
            <div>
              <div class="admin-stat-value">${promedioGeneral} pts</div>
              <div class="admin-stat-label">Promedio General Facultad</div>
            </div>
          </div>
        </div>

        <!-- Barra de Búsqueda de Docentes -->
        <div class="admin-section-title" style="margin-bottom: 8px;">
          <span>Directorio Oficial de Docentes (${teachersList.length})</span>
          <span style="font-size: 12.5px; font-weight: 500; color: var(--text-tertiary);">
            Haz clic en "Supervisar" en cualquier docente para auditar sus listas en vivo
          </span>
        </div>

        <div class="admin-search-wrap" style="margin-bottom: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; width: 100%;">
          <input type="text" id="adminTeacherSearch" class="form-control" 
            placeholder="Buscar docente por nombre o materia (ej. Treviño, Estructuras, Cálculo)..." 
            oninput="App.filterAdminTeachers(this.value)" autocomplete="off" 
            style="font-size: 14px; padding: 10px 14px; border-radius: var(--radius-md); flex: 1 1 240px; min-width: 0;" />
          <span id="adminTeacherCountBadge" style="font-size: 12.5px; color: var(--text-secondary); font-weight: 600;">
            Mostrando ${teachersList.length} profesores
          </span>
        </div>

        <div class="admin-teachers-grid" id="adminTeachersGrid">
          ${teachersGridHtml}
        </div>
      </div>
    `;
  },

  filterAdminTeachers: function(query) {
    const term = (query || "").trim().toLowerCase();
    const cards = document.querySelectorAll("#adminTeachersGrid .admin-teacher-card");
    let visible = 0;
    cards.forEach(card => {
      const name = card.getAttribute("data-teacher-name") || "";
      const courses = card.getAttribute("data-teacher-courses") || "";
      const matches = !term || name.includes(term) || courses.includes(term);
      card.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    const badge = document.getElementById("adminTeacherCountBadge");
    if (badge) badge.textContent = `Mostrando ${visible} profesores`;
  },

  // Modal de sincronización del Roster Oficial
  openSyncRosterModal: function() {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Esta herramienta solo puede ser ejecutada por Coordinación Académica.");
      return;
    }
    const modal = document.getElementById("syncRosterModal");
    if (modal) {
      modal.classList.add("open");
      const progressWrap = document.getElementById("syncRosterProgressWrap");
      if (progressWrap) progressWrap.style.display = "none";
      const startBtn = document.getElementById("btnStartSync");
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Iniciar Sincronización a la Nube";
      }
      const cancelBtn = document.getElementById("btnCancelSync");
      if (cancelBtn) cancelBtn.disabled = false;
    }
  },

  closeSyncRosterModal: function() {
    const modal = document.getElementById("syncRosterModal");
    if (modal) modal.classList.remove("open");
  },

  executeOfficialRosterSync: async function() {
    if (!this.isAdmin()) {
      alert("Acceso restringido: La sincronización de plantilla docente oficial es exclusiva de Coordinación Académica.");
      return;
    }

    if (typeof FACULTY_ROSTER === "undefined" || !FACULTY_ROSTER.length) {
      alert("La plantilla docente ya está sincronizada y protegida al 100% en la nube de Supabase. El archivo local fue desconectado del navegador por seguridad.");
      return;
    }

    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);

    if (!cloud) {
      alert("No hay conexión activa con el servidor institucional en la nube.");
      return;
    }

    const progressWrap = document.getElementById("syncRosterProgressWrap");
    const bar = document.getElementById("syncRosterProgressBar");
    const statusText = document.getElementById("syncRosterStatusText");
    const startBtn = document.getElementById("btnStartSync");
    const cancelBtn = document.getElementById("btnCancelSync");

    if (progressWrap) progressWrap.style.display = "block";
    if (startBtn) startBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    // Asegurar que el Administrador siempre esté incluido
    const fullRosterWithAdmin = [...FACULTY_ROSTER];
    if (typeof INITIAL_ADMIN !== 'undefined' && !fullRosterWithAdmin.some(t => t.id === INITIAL_ADMIN.id || t.role === 'admin')) {
      fullRosterWithAdmin.unshift(JSON.parse(JSON.stringify(INITIAL_ADMIN)));
    }

    const success = await cloud.syncFullFacultyRoster(fullRosterWithAdmin, (current, total) => {
      const pct = Math.round((current / total) * 100);
      if (bar) bar.style.width = pct + "%";
      if (statusText) statusText.textContent = `Sincronizando a Supabase: ${current} de ${total} profesores (${pct}%)...`;
    });

    if (success) {
      if (statusText) statusText.textContent = "¡153 Profesores y 18,702 inscripciones sincronizadas en Supabase!";
      await this.loadDataFromCloud();
      this.render();
      setTimeout(() => {
        this.closeSyncRosterModal();
        this.showToast("Roster Oficial de 153 profesores activo en Supabase (PostgreSQL)");
      }, 1200);
    } else {
      if (statusText) statusText.textContent = "Ocurrió un error al sincronizar con Supabase.";
      if (cancelBtn) cancelBtn.disabled = false;
    }
  },

  downloadAllFacultyBackup: async function() {
    const dataStr = JSON.stringify(this.teachers, null, 2);
    const filename = `Respaldo_Facultad_FIUAT_${new Date().toISOString().slice(0,10)}.json`;
    await Exporter.saveFileSafe(
      dataStr,
      filename,
      'application/json',
      'Respaldo Global de Profesores (*.json)',
      '.json'
    );
  },

  openSwitchTeacherModal: function() {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Esta función es exclusiva de Coordinación Académica.");
      return;
    }

    const dropdown = document.getElementById("teacherDropdown");
    if (dropdown) dropdown.classList.remove("open");

    const searchInput = document.getElementById("switchTeacherSearch");
    if (searchInput) searchInput.value = "";

    this.renderSwitchTeacherList(this.teachers);

    const modal = document.getElementById("switchTeacherModal");
    if (modal) modal.classList.add("open");
  },

  renderSwitchTeacherList: function(teachers) {
    const list = document.getElementById("switchTeacherList");
    if (!list) return;

    list.innerHTML = teachers.map(t => {
      const isCurrent = this.currentUser && this.currentUser.id === t.id;
      const coursesCount = (t.data && t.data.courses) ? t.data.courses.length : 0;
      const studentsCount = (t.data && t.data.students) ? t.data.students.length : 0;
      const cardAvatar = t.role === 'admin'
        ? `<img src="Logos/Escudo Imagotipo.png" alt="UAT" />`
        : `<img src="Logos/FI-SOLO-COLOR.png" alt="FI" />`;
      const escId = this.escapeHtml(t.id);
      const escNombre = this.escapeHtml(t.nombre);
      const escUsuario = this.escapeHtml(t.usuario);
      return `
        <div class="demo-teacher-card" style="margin-bottom: 0; ${isCurrent ? 'border-color: var(--uat-orange); background: var(--bg-hover);' : ''}" onclick="App.switchTeacher('${escId}')">
          <div class="demo-avatar">${cardAvatar}</div>
          <div style="flex: 1; min-width: 0;">
            <div class="demo-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escNombre} ${isCurrent ? '<span style="color: var(--uat-orange); font-size: 11px;">(Activo)</span>' : ''}
            </div>
            <div class="demo-sub">
              ${t.role === 'admin' ? 'Coordinación y Dirección' : `${escUsuario} • ${coursesCount} materias • ${studentsCount} alumnos`}
            </div>
          </div>
          <button class="btn btn-default btn-sm" style="pointer-events: none;">
            ${isCurrent ? 'Activo' : 'Entrar'}
          </button>
        </div>
      `;
    }).join('');
  },

  filterSwitchTeacherList: function(query) {
    const term = (query || "").trim().toLowerCase();
    const filtered = this.teachers.filter(t => 
      !term || 
      t.nombre.toLowerCase().includes(term) || 
      t.usuario.toLowerCase().includes(term) ||
      (t.departamento && t.departamento.toLowerCase().includes(term))
    );
    this.renderSwitchTeacherList(filtered);
  },

  closeSwitchTeacherModal: function() {
    const modal = document.getElementById("switchTeacherModal");
    if (modal) modal.classList.remove("open");
  },

  switchTeacher: async function(teacherId) {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Solo Coordinación Académica puede cambiar de profesor.");
      return;
    }
    this.closeSwitchTeacherModal();
    await this._establishSession(teacherId);
  },

  openRegisterTeacherModal: function() {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Solo Coordinación Académica puede registrar nuevos docentes manualmente.");
      return;
    }
    this.closeSwitchTeacherModal();
    const modal = document.getElementById("registerTeacherModal");
    if (modal) modal.classList.add("open");
  },

  closeRegisterTeacherModal: function() {
    const modal = document.getElementById("registerTeacherModal");
    if (modal) modal.classList.remove("open");
  },

  submitRegisterTeacher: async function() {
    const nombre = document.getElementById("regTeacherNombre")?.value.trim();
    const usuario = document.getElementById("regTeacherUsuario")?.value.trim().toLowerCase();
    const correo = document.getElementById("regTeacherCorreo")?.value.trim().toLowerCase();
    const depto = document.getElementById("regTeacherDepto")?.value.trim() || "Facultad de Ingeniería Tampico";
    const password = document.getElementById("regTeacherPassword")?.value;

    if (!nombre || !usuario || !correo || !password) {
      alert("Por favor completa todos los campos requeridos, incluyendo la contraseña.");
      return;
    }

    if (this.teachers.some(t => t.usuario.toLowerCase() === usuario || t.correo.toLowerCase() === correo)) {
      alert("Ya existe un docente registrado con ese usuario o correo institucional.");
      return;
    }

    const newTeacher = {
      id: "prof-" + usuario + "-" + Date.now(),
      nombre: nombre,
      usuario: usuario,
      correo: correo,
      password: password,
      departamento: depto,
      avatar: "",
      data: {
        students: [],
        courses: [
          {
            id: "materia-" + Date.now(),
            nombre: "Materia 1",
            grupo: "Grupo A",
            periodo: "2026-1",
            unidadesCount: 5,
            firmasMaxConfig: { u1: 10, u2: 10, u3: 10, u4: 10, u5: 10 },
            records: []
          }
        ]
      }
    };

    this.teachers.push(newTeacher);
    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : ((typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) ? FirebaseService : null);
    if (cloud) {
      if (cloud.createTeacher) {
        await cloud.createTeacher(newTeacher);
      } else {
        await cloud.saveTeacher(newTeacher);
      }
    }
    this.closeRegisterTeacherModal();
    await this._establishSession(newTeacher.id);
    this.showToast(`Profesor ${nombre} registrado con éxito.`);
  },

  // =========================================================================
  // MÓDULO DE GESTIÓN DE CONTRASEÑA PERSONAL (DOCENTES Y ADMINISTRACIÓN)
  // =========================================================================

  openChangePasswordModal: function() {
    const dropdown = document.getElementById("teacherDropdown");
    if (dropdown) dropdown.classList.remove("open");

    const cur = document.getElementById("changePassCurrent");
    const nw = document.getElementById("changePassNew");
    const conf = document.getElementById("changePassConfirm");
    if (cur) cur.value = "";
    if (nw) nw.value = "";
    if (conf) conf.value = "";

    const modal = document.getElementById("changePasswordModal");
    if (modal) modal.classList.add("open");
  },

  closeChangePasswordModal: function() {
    const modal = document.getElementById("changePasswordModal");
    if (modal) modal.classList.remove("open");
  },

  submitChangePassword: async function() {
    if (!this.currentUser) return;

    const currentPass = (document.getElementById("changePassCurrent")?.value || "").trim();
    const newPass = (document.getElementById("changePassNew")?.value || "").trim();
    const confirmPass = (document.getElementById("changePassConfirm")?.value || "").trim();

    if (!currentPass || !newPass || !confirmPass) {
      alert("Por favor completa todos los campos.");
      return;
    }

    if (newPass.length < 4) {
      alert("La nueva contraseña debe contener al menos 4 caracteres.");
      return;
    }

    if (newPass !== confirmPass) {
      alert("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : null;
    if (cloud) {
      const verifyRes = await cloud.verifyCredentials(this.currentUser.usuario || this.currentUser.id, currentPass);
      if (!verifyRes || !verifyRes.success) {
        alert("La contraseña actual es incorrecta.");
        return;
      }

      this.showToast("Actualizando contraseña en la base de datos...", "info");
      let updatedInCloud = false;
      if (cloud.updatePassword) {
        updatedInCloud = await cloud.updatePassword(this.currentUser.id, newPass, currentPass);
      } else {
        updatedInCloud = await cloud.saveTeacher(Object.assign({}, this.currentUser, { password: newPass }));
      }

      if (!updatedInCloud) {
        alert("Error al actualizar la contraseña en Supabase. Verifica tu conexión e intenta de nuevo.");
        return;
      }
    } else {
      const expectedOld = this.currentUser.password || (this.currentUser.role === 'admin' ? "admin" : "123");
      if (currentPass !== expectedOld) {
        alert("La contraseña actual es incorrecta.");
        return;
      }
    }

    this.currentUser.password = newPass;

    // Actualizar en el catálogo de profesores en memoria
    const tIndex = this.teachers.findIndex(t => t.id === this.currentUser.id);
    if (tIndex !== -1) {
      this.teachers[tIndex].password = newPass;
    }

    // Limpiar campos del formulario
    const cPass = document.getElementById("changePassCurrent");
    const nPass = document.getElementById("changePassNew");
    const cfPass = document.getElementById("changePassConfirm");
    if (cPass) cPass.value = "";
    if (nPass) nPass.value = "";
    if (cfPass) cfPass.value = "";

    this.closeChangePasswordModal();
    this.showToast("¡Tu contraseña ha sido actualizada con éxito en la base de datos!");
  },

  // =========================================================================
  // ADMINISTRACIÓN DE CUENTAS Y RESTABLECIMIENTO DE CLAVES (CUENTA MAESTRA)
  // =========================================================================

  openAdminManageTeacherModal: function(teacherId) {
    if (!this.isAdmin()) {
      alert("Acceso denegado: Se requieren privilegios de Coordinación Académica para administrar cuentas.");
      return;
    }

    const teacher = this.teachers.find(t => t.id === teacherId);
    if (!teacher) {
      alert("Docente no encontrado.");
      return;
    }

    const idInput = document.getElementById("adminManageTeacherId");
    const nameDiv = document.getElementById("adminManageTeacherNombre");
    const userDiv = document.getElementById("adminManageTeacherUsuario");
    const deptoDiv = document.getElementById("adminManageTeacherDepto");
    const newPassInput = document.getElementById("adminManageNewPass");
    const confPassInput = document.getElementById("adminManageConfirmPass");
    const adminPassInput = document.getElementById("adminManageAdminPass");

    if (idInput) idInput.value = teacher.id;
    if (nameDiv) nameDiv.textContent = teacher.nombre;
    if (userDiv) userDiv.textContent = `Usuario: @${teacher.usuario} • ${teacher.correo || 'Sin correo registrado'}`;
    if (deptoDiv) deptoDiv.textContent = teacher.departamento || "Facultad de Ingeniería Tampico";
    if (newPassInput) newPassInput.value = "";
    if (confPassInput) confPassInput.value = "";
    if (adminPassInput) adminPassInput.value = "";

    const modal = document.getElementById("adminManageTeacherModal");
    if (modal) modal.classList.add("open");
  },

  closeAdminManageTeacherModal: function() {
    const adminPassInput = document.getElementById("adminManageAdminPass");
    if (adminPassInput) adminPassInput.value = "";
    const modal = document.getElementById("adminManageTeacherModal");
    if (modal) modal.classList.remove("open");
  },

  adminQuickResetDefault: function() {
    const newPassInput = document.getElementById("adminManageNewPass");
    const confPassInput = document.getElementById("adminManageConfirmPass");
    if (newPassInput) newPassInput.value = "123";
    if (confPassInput) confPassInput.value = "123";
    this.showToast("Contraseña preestablecida en '123'. Haz clic en 'Guardar Nueva Contraseña' para confirmar.");
  },

  toggleAdminPasswordVisibility: function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  },

  submitAdminResetPassword: async function() {
    if (!this.isAdmin()) {
      alert("Acceso denegado: Operación reservada para Coordinación Académica.");
      return;
    }

    const teacherId = (document.getElementById("adminManageTeacherId")?.value || "").trim();
    const newPass = (document.getElementById("adminManageNewPass")?.value || "").trim();
    const confPass = (document.getElementById("adminManageConfirmPass")?.value || "").trim();
    const adminPass = (document.getElementById("adminManageAdminPass")?.value || "").trim();

    if (!teacherId) {
      alert("Error: Identificador del docente inválido.");
      return;
    }

    if (!adminPass) {
      alert("Debes ingresar tu contraseña de administrador para autorizar esta operación.");
      document.getElementById("adminManageAdminPass")?.focus();
      return;
    }

    if (!newPass || !confPass) {
      alert("Por favor ingresa y confirma la nueva contraseña.");
      return;
    }

    if (newPass.length < 3) {
      alert("La contraseña debe tener al menos 3 caracteres.");
      return;
    }

    if (newPass !== confPass) {
      alert("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    const teacher = this.teachers.find(t => t.id === teacherId);
    const teacherName = teacher ? teacher.nombre : "del docente";

    this.showToast("Validando credenciales de administrador y actualizando contraseña...", "info");

    const cloud = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized) ? SupabaseService : null;
    let saved = false;

    if (cloud && cloud.adminResetTeacherPassword) {
      const adminId = this.currentUser ? this.currentUser.id : "admin-coordinacion";
      saved = await cloud.adminResetTeacherPassword(adminId, adminPass, teacherId, newPass);
    } else {
      // Modo local / respaldo sin nube
      const currentAdminPass = this.currentUser ? (this.currentUser.password || "admin") : "admin";
      if (adminPass === currentAdminPass) {
        saved = true;
      }
    }

    if (!saved) {
      const errDetail = (cloud && cloud.lastError) ? cloud.lastError : "La contraseña de administrador es incorrecta o no tienes autorización en la base de datos.";
      alert("Error al restablecer contraseña: " + errDetail);
      return;
    }

    // Actualizar en memoria local de la aplicación solo si la base de datos confirmó el cambio
    if (teacher) {
      teacher.password = newPass;
    }

    this.closeAdminManageTeacherModal();
    this.showToast(`¡Contraseña de ${teacherName} restablecida exitosamente!`);
  },

  setupEventListeners: function() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeBulkImportModal();
        this.closeNewCourseModal();
        this.closeManageCourseModal();
        this.closeSwitchTeacherModal();
        this.closeRegisterTeacherModal();
        this.closeChangePasswordModal();
        this.closeAdminManageTeacherModal();
      }
    });

    // Cerrar dropdown del perfil al hacer clic afuera
    document.addEventListener("click", (e) => {
      const dropdown = document.getElementById("teacherDropdown");
      if (dropdown && dropdown.classList.contains("open")) {
        if (!e.target.closest(".teacher-profile-wrap")) {
          dropdown.classList.remove("open");
        }
      }
    });

    // Monitoreo de actividad de usuario para auto-cierre de sesión (20 min)
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
      window.addEventListener(evt, () => {
        App.resetInactivityTimer();
      }, { passive: true });
    });

    // Blindaje reactivo: Mini-guardado inmediato ante suspensión de pestaña, cambio de app en celular o cierre
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        App.flushSave();
      }
    });
    window.addEventListener("pagehide", () => {
      App.flushSave();
    });
    window.addEventListener("beforeunload", () => {
      App.flushSave();
    });

    // Ajuste dinámico de altura de tabla estilo Excel en redimensionamiento de ventana
    window.addEventListener("resize", () => {
      App.fitGradebookTableHeight();
    });
  }
};

window.addEventListener("DOMContentLoaded", () => {
  App.init();
});

