// app.js - Lógica principal del Calificador estilo Notion con Base de Datos y Rollup

const App = {
  teachers: [],
  currentUser: null,
  data: null, // Apunta a currentUser.data
  activeCourseId: "algebra-lineal-ga",
  activeTab: "gradebook", // "admin_dashboard", "gradebook", "directory", "teams", "config"
  theme: "light",
  searchTerm: "",
  loginTab: "login", // "login" o "register"
  isSupervising: false,
  supervisingTeacherId: null,

  isAdmin: function() {
    return this.currentUser && this.currentUser.role === 'admin';
  },

  init: async function() {
    this.initTheme();
    this.setupEventListeners();
    this.loadData();
    this.render();

    // Inicializar sincronización en la nube con Firebase Firestore
    if (typeof FirebaseService !== "undefined") {
      await FirebaseService.init();
      this.updateCloudStatusBadge();
      await this.syncWithFirebase();
    }
  },

  syncWithFirebase: async function() {
    if (typeof FirebaseService === "undefined" || !FirebaseService.isInitialized) return;

    try {
      const cloudTeachers = await FirebaseService.fetchTeachers();
      if (cloudTeachers === null) {
        // Modo sin conexión o error de red
        return;
      }

      if (cloudTeachers.length === 0) {
        // Firestore está vacío: sembrar con datos locales iniciales
        console.log("Sincronizando datos locales hacia Firestore por primera vez...");
        await FirebaseService.seedInitialDataIfEmpty(this.teachers);
      } else {
        // Hay datos en Firestore: actualizar estado local con la nube
        this.teachers = cloudTeachers;
        this.saveTeachers();

        // Re-enlazar usuario actual si está activo
        if (this.currentUser) {
          const fresh = this.teachers.find(t => t.id === this.currentUser.id);
          if (fresh) {
            this.currentUser = fresh;
            if (this.currentUser.data) this.data = this.currentUser.data;
          }
        }
        this.render();
      }
      this.updateCloudStatusBadge();
    } catch (e) {
      console.warn("Error en sincronización con Firebase:", e);
    }
  },

  updateCloudStatusBadge: function() {
    const container = document.getElementById("cloudStatusContainer");
    if (!container) return;

    if (typeof FirebaseService === "undefined" || !FirebaseService.isInitialized) {
      container.innerHTML = `
        <div class="cloud-status-badge offline" title="Operando en modo local (sin conexión a Firestore)">
          <span class="cloud-status-dot"></span>
          <span>Modo Local</span>
        </div>
      `;
      return;
    }

    if (FirebaseService.status === "connected") {
      container.innerHTML = `
        <div class="cloud-status-badge connected" title="Conectado a Firebase Firestore en tiempo real">
          <span class="cloud-status-dot"></span>
          <span>Nube Sincronizada</span>
        </div>
      `;
    } else if (FirebaseService.status === "offline") {
      container.innerHTML = `
        <div class="cloud-status-badge offline" title="Sin conexión a internet. Los cambios se guardan localmente y se sincronizarán al volver a conectar.">
          <span class="cloud-status-dot"></span>
          <span>Sin Conexión</span>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="cloud-status-badge connecting" title="Conectando con Firestore...">
          <span class="cloud-status-dot"></span>
          <span>Conectando...</span>
        </div>
      `;
    }
  },

  // Carga de catálogo de profesores y datos del docente activo
  loadData: function() {
    // 1. Cargar catálogo de profesores
    const savedTeachers = localStorage.getItem("notion_teachers_db");
    if (savedTeachers) {
      try {
        this.teachers = JSON.parse(savedTeachers);
      } catch (e) {
        console.error("Error al cargar profesores:", e);
        this.teachers = (typeof INITIAL_TEACHERS !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_TEACHERS)) : [];
      }
    } else {
      this.teachers = (typeof INITIAL_TEACHERS !== 'undefined') ? JSON.parse(JSON.stringify(INITIAL_TEACHERS)) : [];
      
      // Migración si existían datos anteriores guardados en notion_grades_data
      const legacyGrades = localStorage.getItem("notion_grades_data");
      if (legacyGrades && this.teachers.length > 0) {
        try {
          const parsed = JSON.parse(legacyGrades);
          if (parsed && (parsed.courses || parsed.students)) {
            this.teachers[0].data = parsed;
          }
        } catch(e) {}
      }
      this.saveTeachers();
    }

    // Asegurar que la cuenta maestra de Administración/Coordinación esté siempre disponible
    if (typeof INITIAL_ADMIN !== 'undefined' && !this.teachers.some(t => t.id === INITIAL_ADMIN.id || t.role === 'admin')) {
      this.teachers.unshift(JSON.parse(JSON.stringify(INITIAL_ADMIN)));
      this.saveTeachers();
    }

    // 2. Cargar usuario/profesor activo desde la sesión
    const savedTeacherId = localStorage.getItem("notion_active_teacher_id");
    if (savedTeacherId) {
      this.currentUser = this.teachers.find(t => t.id === savedTeacherId) || null;
    } else {
      // Por defecto iniciamos con la Coordinación o con el primer docente disponible
      this.currentUser = this.teachers.find(t => t.role === 'admin') || this.teachers[0] || null;
      if (this.currentUser) {
        localStorage.setItem("notion_active_teacher_id", this.currentUser.id);
      }
    }

    // 3. Enlazar datos de trabajo del profesor actual
    if (this.currentUser && this.currentUser.data) {
      this.data = this.currentUser.data;
      if (this.data.courses) {
        this.data.courses.forEach((c, idx) => {
          if (!c.grupo) c.grupo = "Grupo " + String.fromCharCode(65 + (idx % 26));
          if (!c.id) c.id = "curso-" + Date.now() + "-" + idx;
        });
        if (!this.data.courses.some(c => c.id === this.activeCourseId)) {
          this.activeCourseId = this.data.courses[0] ? this.data.courses[0].id : "";
        }
      }
    } else {
      this.data = null;
    }
  },

  saveTeachers: function() {
    localStorage.setItem("notion_teachers_db", JSON.stringify(this.teachers));
  },

  saveTimer: null,
  cloudSaveTimer: null,

  saveData: function() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.currentUser) {
      this.currentUser.data = this.data;
      this.saveTeachers();
    }
  },

  debouncedSave: function() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveData();
    }, 250);

    // Guardado en Firestore desacoplado para no saturar la red ni la memoria durante el tipeo
    if (this.cloudSaveTimer) clearTimeout(this.cloudSaveTimer);
    this.cloudSaveTimer = setTimeout(() => {
      if (typeof FirebaseService !== "undefined" && FirebaseService.isInitialized && this.currentUser) {
        FirebaseService.saveTeacher(this.currentUser);
      }
    }, 1200);
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
    if (confirm(`¿Estás seguro de que deseas vaciar los alumnos de ${course.nombre} para comenzar el NUEVO semestre? (Podrás pegar tu nueva lista de inmediato)`)) {
      course.records = [];
      this.saveData();
      this.render();
      this.showToast(`Lista de ${course.nombre} vaciada. Lista para tu nuevo semestre.`);
    }
  },

  clearAllDataForNewSemester: function() {
    if (confirm("¿Deseas limpiar TODOS los alumnos y calificaciones para iniciar tu nuevo semestre desde cero?")) {
      this.data.students = [];
      this.data.courses.forEach(c => {
        c.records = [];
      });
      this.saveData();
      this.render();
      this.showToast("Sistema preparado para tu nuevo semestre.");
      this.openBulkImportModal();
    }
  },

  initTheme: function() {
    const savedTheme = localStorage.getItem("notion_theme") || "light";
    this.theme = savedTheme;
    document.documentElement.setAttribute("data-theme", this.theme);
    this.updateThemeButton();
  },

  toggleTheme: function() {
    this.theme = this.theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", this.theme);
    localStorage.setItem("notion_theme", this.theme);
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

  getActiveCourse: function() {
    return this.data.courses.find(c => c.id === this.activeCourseId) || this.data.courses[0];
  },

  getStudentsMap: function() {
    const map = {};
    (this.data.students || []).forEach(s => {
      map[s.matricula] = s;
    });
    return map;
  },

  // MOTOR MATEMÁTICO: Fórmulas extraídas de las imágenes de Notion
  calculateStudentGrades: function(record, course) {
    const maxFirmasConfig = course.firmasMaxConfig || {};
    const evalU = {};
    const validUnitsForMean = [];

    // 1. Evaluación de cada Unidad (U1 a U5)
    for (let u = 1; u <= (course.unidadesCount || 5); u++) {
      const uKey = `u${u}`;
      const firmas = record.firmas ? record.firmas[uKey] : null;
      const examen = record.examenes ? record.examenes[uKey] : null;
      const maxF = maxFirmasConfig[uKey] || 10;

      let puntajeFirmas = 0;
      if (firmas !== null && firmas !== undefined && maxF > 0) {
        // ((Firmas / max(Firmas)) * 50)
        puntajeFirmas = (Number(firmas) / maxF) * 50;
      }

      let puntajeExamen = 0;
      if (examen !== null && examen !== undefined) {
        // (Examen * 0.5)
        puntajeExamen = Number(examen) * 0.5;
      }

      // Si al menos hay firmas o examen, calculamos la nota de la unidad
      if (firmas !== null || examen !== null) {
        const totalU = Math.round((puntajeFirmas + puntajeExamen) * 10) / 10;
        evalU[u] = totalU;
        validUnitsForMean.push(totalU);
      } else {
        evalU[u] = 0;
        validUnitsForMean.push(0);
      }
    }

    // 2. Proyecto Final y Puntos Extra
    const proyecto = (record.proyecto !== null && record.proyecto !== undefined) ? Number(record.proyecto) : null;
    const puntosExtra = Number(record.puntosExtra) || 0;

    // Fórmula de Evaluación Final de Notion:
    // round(mean(Eval U1, Eval U2, Eval U3, Eval U4, Eval U5, Proyecto Final) + (Puntos Extra * 5))
    const itemsToAverage = [...validUnitsForMean];
    if (proyecto !== null) {
      itemsToAverage.push(proyecto);
    }

    let promedio = 0;
    if (itemsToAverage.length > 0) {
      const suma = itemsToAverage.reduce((acc, v) => acc + v, 0);
      promedio = suma / itemsToAverage.length;
    }

    const conPuntosExtra = promedio + (puntosExtra * 5);
    const evalFinalRedondeada = Math.round(conPuntosExtra);
    const evalFinal = Math.min(100, Math.max(0, evalFinalRedondeada));

    return {
      evalU,
      evalFinal,
      promedioParcial: Math.round(promedio * 10) / 10
    };
  },

  // Cálculo de estadísticas de columna (MAX para firmas, AVERAGE para exámenes y evaluaciones)
  calculateCourseStats: function(course) {
    const records = course.records || [];
    const stats = {
      maxFirmas: {},
      avgFirmas: {},
      avgExamenes: {},
      avgEvaluaciones: {},
      avgFinal: 0
    };

    const count = records.length;
    if (count === 0) return stats;

    for (let u = 1; u <= (course.unidadesCount || 5); u++) {
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
    }

    // Evaluaciones
    let sumFinal = 0;
    const evalSums = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    records.forEach(r => {
      const c = this.calculateStudentGrades(r, course);
      sumFinal += c.evalFinal;
      for (let u = 1; u <= 5; u++) {
        evalSums[u] += (c.evalU[u] || 0);
      }
    });

    stats.avgFinal = (sumFinal / count).toFixed(1);
    for (let u = 1; u <= 5; u++) {
      stats.avgEvaluaciones[u] = (evalSums[u] / count).toFixed(2);
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

    if (this.activeTab === "admin_dashboard") {
      this.renderAdminDashboard(container);
    } else if (this.activeTab === "gradebook") {
      this.renderGradebook(container);
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

    container.innerHTML = `
      <div class="teacher-profile-wrap">
        <button type="button" class="teacher-profile-btn" onclick="App.toggleTeacherDropdown(event)" title="Cuenta activa">
          <span class="teacher-avatar">${t.avatar || (isAdmin ? '🏛️' : '👨‍🏫')}</span>
          <div class="teacher-info-mini">
            <span class="teacher-name-mini">${t.nombre} ${isAdmin ? '<span class="badge-role-admin">ADMIN</span>' : ''}</span>
            <span class="teacher-depto-mini">${t.departamento || 'FIUAT'}</span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="teacher-dropdown" id="teacherDropdown">
          <div class="teacher-dropdown-header">
            <div class="teacher-avatar-large">${t.avatar || (isAdmin ? '🏛️' : '👨‍🏫')}</div>
            <div>
              <div class="teacher-name-full">${t.nombre} ${isAdmin ? '<span class="badge-role-admin">ADMIN</span>' : ''}</div>
              <div class="teacher-email-full">${t.correo || t.usuario}</div>
              <span class="teacher-badge-depto">${t.departamento || 'FIUAT'}</span>
            </div>
          </div>
          <div style="padding: 10px 16px; font-size: 12px; color: var(--text-secondary); background: var(--bg-secondary); border-bottom: 1px solid var(--border-color);">
            ${isAdmin ? `🏛️ <b>Acceso Maestro</b>: Supervisión general de toda la facultad` : `📚 <b>${coursesCount}</b> Materias / Grupos asignados<br>👥 <b>${studentsCount}</b> Alumnos en su Directorio`}
          </div>
          ${isAdmin ? `
            <button class="dropdown-item" onclick="App.exitSupervision()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              Panel de Control Maestro
            </button>
          ` : ''}
          <button class="dropdown-item" onclick="App.openSwitchTeacherModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
            Cambiar de Profesor
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
          🏛️ Panel de Control Maestro (Supervisión)
          <span class="nav-tab-badge">${regularTeachers.length} profesores</span>
        </button>
        <button class="nav-tab-btn" style="margin-left: auto; color: var(--uat-orange); font-weight: 700;" onclick="App.openRegisterTeacherModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Dar de Alta Nuevo Docente
        </button>
      `;
      return;
    }

    const course = this.getActiveCourse();
    const studentsCount = (this.data && this.data.students) ? this.data.students.length : 0;
    const recordsCount = (course.records || []).length;

    let adminBackBtn = "";
    if (this.isAdmin() && this.isSupervising) {
      adminBackBtn = `
        <button class="nav-tab-btn" style="background: rgba(224, 126, 51, 0.15); color: var(--uat-orange); font-weight: 700; border: 1px solid var(--uat-orange); margin-right: 6px;" onclick="App.exitSupervision()">
          ↩️ Volver al Panel Maestro
        </button>
      `;
    }

    nav.innerHTML = `
      ${adminBackBtn}
      <button class="nav-tab-btn ${this.activeTab === 'gradebook' ? 'active' : ''}" onclick="App.switchTab('gradebook')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>
        ${course.nombre || 'Materia'} • ${course.grupo || 'Grupo A'}
        <span class="nav-tab-badge">${recordsCount} alumnos</span>
      </button>

      <button class="nav-tab-btn ${this.activeTab === 'directory' ? 'active' : ''}" onclick="App.switchTab('directory')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Directorio de Alumnos (Base Maestra)
        <span class="nav-tab-badge">${studentsCount}</span>
      </button>

      <button class="nav-tab-btn ${this.activeTab === 'teams' ? 'active' : ''}" onclick="App.switchTab('teams')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Publicar en Teams (${course.grupo || 'Grupo A'})
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
    this.activeTab = tabName;
    this.render();
  },

  switchCourse: function(courseId) {
    this.activeCourseId = courseId;
    this.render();
  },

  // 1. VISTA DE CALIFICADOR (RÉPLICA DE NOTION)
  renderGradebook: function(container) {
    const course = this.getActiveCourse();
    const studentsMap = this.getStudentsMap();
    const stats = this.calculateCourseStats(course);
    const maxFirmasConfig = course.firmasMaxConfig || {};

    let records = course.records || [];
    let visibleCount = 0;
    const searchLower = (this.searchTerm || "").toLowerCase().trim();

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

      // Celdas de Firmas U1 a U5
      let firmasCells = "";
      for (let u = 1; u <= 5; u++) {
        const uKey = `u${u}`;
        const val = rec.firmas ? (rec.firmas[uKey] ?? "") : "";
        const maxF = maxFirmasConfig[uKey] || 10;
        const pct = val !== "" && val !== null ? Math.min(100, Math.round((Number(val) / maxF) * 100)) : 0;
        const dashOffset = 44 - (44 * pct) / 100;
        const strokeColor = pct >= 100 ? 'var(--color-green)' : (pct >= 50 ? 'var(--color-orange)' : 'var(--border-color)');

        firmasCells += `
          <td class="col-number-input">
            <div class="firmas-cell-content">
              <input type="number" min="0" max="99" class="firmas-num-input" value="${val}" 
                placeholder="-" data-col="firmas-${uKey}"
                onfocus="this.select()"
                oninput="App.updateFirmas('${rec.matricula}', '${uKey}', this.value)"
                onkeydown="App.handleCellKeydown(event, this)" />
              <svg class="progress-ring" viewBox="0 0 20 20">
                <circle class="progress-ring-circle-bg" cx="10" cy="10" r="7"/>
                <circle id="ring-firmas-${rec.matricula}-${uKey}" class="progress-ring-circle" cx="10" cy="10" r="7" 
                  style="stroke-dasharray: 44; stroke-dashoffset: ${dashOffset}; stroke: ${strokeColor};"/>
              </svg>
            </div>
          </td>
        `;
      }

      // Celdas de Exámenes U1 a U5
      let examenesCells = "";
      for (let u = 1; u <= 5; u++) {
        const uKey = `u${u}`;
        const val = rec.examenes ? (rec.examenes[uKey] ?? "") : "";
        const numVal = val !== "" && val !== null ? Number(val) : null;
        let barColor = "var(--color-green)";
        if (numVal !== null && numVal < 60) barColor = "var(--color-red)";
        else if (numVal !== null && numVal < 70) barColor = "var(--color-orange)";

        examenesCells += `
          <td style="min-width: 110px;">
            <div class="progress-bar-wrap">
              <input type="number" min="0" max="100" class="cell-input" style="width: 48px; text-align: right; font-weight: 500;" 
                value="${val}" placeholder="-" data-col="examenes-${uKey}"
                onfocus="this.select()"
                oninput="App.updateExamen('${rec.matricula}', '${uKey}', this.value)"
                onkeydown="App.handleCellKeydown(event, this)" />
              <div class="progress-track">
                <div id="bar-exam-${rec.matricula}-${uKey}" class="progress-fill" style="width: ${numVal !== null ? numVal : 0}%; background-color: ${barColor};"></div>
              </div>
            </div>
          </td>
        `;
      }

      // Celdas de Evaluación calculada U1 a U5
      let evalCells = "";
      for (let u = 1; u <= 5; u++) {
        const uKey = `u${u}`;
        const val = calcs.evalU[u] || 0;
        let ringColor = "var(--color-green)";
        if (val < 60) ringColor = "var(--color-red)";
        else if (val < 70) ringColor = "var(--color-orange)";
        const pct = Math.min(100, val);
        const dashOffset = 44 - (44 * pct) / 100;

        evalCells += `
          <td class="col-calc">
            <div class="firmas-cell-content">
              <span id="val-eval-${rec.matricula}-${uKey}">${val}</span>
              <svg class="progress-ring" viewBox="0 0 20 20">
                <circle class="progress-ring-circle-bg" cx="10" cy="10" r="7"/>
                <circle id="ring-eval-${rec.matricula}-${uKey}" class="progress-ring-circle" cx="10" cy="10" r="7" 
                  style="stroke-dasharray: 44; stroke-dashoffset: ${dashOffset}; stroke: ${ringColor};"/>
              </svg>
            </div>
          </td>
        `;
      }

      rowsHtml += `
        <tr id="row-${rec.matricula}" data-matricula="${rec.matricula}" data-search="${searchData}" style="display: ${isMatch ? '' : 'none'};">
          <td class="col-matricula">
            <input type="text" class="cell-input" value="${rec.matricula}" 
              onfocus="this.select()"
              onchange="App.updateMatricula(${index}, this.value)" />
          </td>
          <td class="col-rollup" title="Obtenido automáticamente de la base de alumnos (Rollup)">
            <div class="rollup-badge">
              <span class="rollup-icon">↗</span>
              <span>${student.nombre}</span>
            </div>
          </td>
          <td class="col-final">
            <div class="progress-bar-wrap">
              <span id="val-final-${rec.matricula}" class="progress-bar-num" style="color: ${finalColor};">${calcs.evalFinal}</span>
              <div class="progress-track">
                <div id="bar-final-${rec.matricula}" class="progress-fill" style="width: ${calcs.evalFinal}%; background-color: ${finalColor};"></div>
              </div>
              <span id="badge-final-${rec.matricula}" class="status-badge ${calcs.evalFinal >= 70 ? 'status-aprobado' : 'status-reprobado'}">
                ${calcs.evalFinal >= 70 ? 'APR' : 'REP'}
              </span>
            </div>
          </td>
          ${firmasCells}
          ${examenesCells}
          ${evalCells}
          <td class="col-number-input">
            <input type="number" min="0" max="100" class="cell-input" value="${rec.proyecto ?? ''}" placeholder="-" data-col="proyecto"
              onfocus="this.select()"
              oninput="App.updateProyecto('${rec.matricula}', this.value)"
              onkeydown="App.handleCellKeydown(event, this)" />
          </td>
          <td class="col-number-input">
            <input type="number" min="0" max="10" class="cell-input" value="${rec.puntosExtra || 0}" placeholder="0" data-col="puntosExtra"
              onfocus="this.select()"
              oninput="App.updatePuntosExtra('${rec.matricula}', this.value)"
              onkeydown="App.handleCellKeydown(event, this)" />
          </td>
          <td style="text-align: center; width: 40px;">
            <button type="button" class="btn-delete-row" 
              title="Quitar alumno de esta materia" onclick="App.deleteRecord('${(rec.matricula || '').replace(/'/g, "\\'")}')">✕</button>
          </td>
        </tr>
      `;
    });

    // Agrupar cursos por nombre de materia
    const coursesBySubject = {};
    (this.data.courses || []).forEach(c => {
      if (!coursesBySubject[c.nombre]) coursesBySubject[c.nombre] = [];
      coursesBySubject[c.nombre].push(c);
    });

    let selectHtml = "";
    Object.keys(coursesBySubject).forEach(subject => {
      selectHtml += `<optgroup label="📚 ${subject}">`;
      coursesBySubject[subject].forEach(c => {
        const count = (c.records || []).length;
        selectHtml += `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${c.grupo || 'Grupo'} (${count} alumnos)</option>`;
      });
      selectHtml += `</optgroup>`;
    });

    container.innerHTML = `
      <div class="page-title-area">
        <div class="page-title-row">
          <div>
            <h1 class="page-title">
              <span>📐</span> ${course.nombre}
              <span style="font-size: 13.5px; font-weight: 700; background: var(--uat-orange-light); color: var(--uat-orange-dark); padding: 3px 12px; border-radius: 12px; border: 1px solid rgba(224, 126, 51, 0.3); margin-left: 6px;">
                ${course.grupo || 'Grupo A'}
              </span>
            </h1>
            <p class="page-desc">
              Control de evaluaciones por unidad y calificación final • Periodo <b>${course.periodo}</b>
            </p>
          </div>
          <div class="header-actions">
            <select class="form-control" style="min-width: 210px; font-weight: 600;" onchange="App.switchCourse(this.value)">
              ${selectHtml}
            </select>
            <button class="btn btn-primary btn-course-pair" onclick="App.openNewCourseModal()" title="Crear nueva materia o agregar otro grupo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva Lista
            </button>
            <button class="btn btn-default btn-course-pair" onclick="App.openManageCourseModal()" title="Ajustes de esta lista (renombrar, duplicar grupo, eliminar)">
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
        </div>
        <div class="toolbar-right">
          <span id="studentCountDisplay" style="font-size: 12.5px; color: var(--text-secondary);">
            Mostrando <b>${visibleCount}</b> alumnos
          </span>
        </div>
      </div>

      <div class="notion-table-wrapper">
        <table class="notion-table notion-table-gradebook">
          <thead>
            <tr>
              <th style="width: 130px;"><div class="th-content"><span class="th-icon">Aa</span> Matrícula</div></th>
              <th style="width: 270px;"><div class="th-content"><span class="th-icon">Q</span> Alumno (Rollup)</div></th>
              <th style="width: 160px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación Final</div></th>
              
              <!-- Firmas U1-U5 -->
              <th style="width: 85px;"><div class="th-content"><span class="th-icon">#</span> Firmas U1</div></th>
              <th style="width: 85px;"><div class="th-content"><span class="th-icon">#</span> Firmas U2</div></th>
              <th style="width: 85px;"><div class="th-content"><span class="th-icon">#</span> Firmas U3</div></th>
              <th style="width: 85px;"><div class="th-content"><span class="th-icon">#</span> Firmas U4</div></th>
              <th style="width: 85px;"><div class="th-content"><span class="th-icon">#</span> Firmas U5</div></th>

              <!-- Exámenes U1-U5 -->
              <th style="width: 110px;"><div class="th-content"><span class="th-icon">#</span> Examen U1</div></th>
              <th style="width: 110px;"><div class="th-content"><span class="th-icon">#</span> Examen U2</div></th>
              <th style="width: 110px;"><div class="th-content"><span class="th-icon">#</span> Examen U3</div></th>
              <th style="width: 110px;"><div class="th-content"><span class="th-icon">#</span> Examen U4</div></th>
              <th style="width: 110px;"><div class="th-content"><span class="th-icon">#</span> Examen U5</div></th>

              <!-- Evaluaciones Calculadas U1-U5 -->
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación U1</div></th>
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación U2</div></th>
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación U3</div></th>
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación U4</div></th>
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">Σ</span> Evaluación U5</div></th>

              <th style="width: 95px;"><div class="th-content"><span class="th-icon">#</span> Proyecto Final</div></th>
              <th style="width: 95px;"><div class="th-content"><span class="th-icon">#</span> Puntos Extra</div></th>
              <th style="width: 45px;"></th>
            </tr>
          </thead>
          <tbody id="gradebookTableBody">
            ${rowsHtml || `<tr><td colspan="21" style="text-align: center; padding: 24px; color: var(--text-tertiary);">No se encontraron alumnos registrados.</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="notion-table-footer">
              <td colspan="2"><span class="summary-chip"><span class="summary-label">TOTAL:</span> <span class="summary-value">${course.records.length} ALUMNOS</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVERAGE:</span> <span id="stat-avg-final" class="summary-value">${stats.avgFinal}</span></span></td>
              
              <!-- Max Firmas -->
              <td><span class="summary-chip"><span class="summary-label">MAX:</span> <span id="stat-max-firmas-u1" class="summary-value">${stats.maxFirmas.u1 || maxFirmasConfig.u1 || 0}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">MAX:</span> <span id="stat-max-firmas-u2" class="summary-value">${stats.maxFirmas.u2 || maxFirmasConfig.u2 || 0}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">MAX:</span> <span id="stat-max-firmas-u3" class="summary-value">${stats.maxFirmas.u3 || maxFirmasConfig.u3 || 0}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">MAX:</span> <span id="stat-max-firmas-u4" class="summary-value">${stats.maxFirmas.u4 || maxFirmasConfig.u4 || 0}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">MAX:</span> <span id="stat-max-firmas-u5" class="summary-value">${stats.maxFirmas.u5 || maxFirmasConfig.u5 || 0}</span></span></td>

              <!-- Promedio Exámenes -->
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-exam-u1" class="summary-value">${stats.avgExamenes.u1}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-exam-u2" class="summary-value">${stats.avgExamenes.u2}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-exam-u3" class="summary-value">${stats.avgExamenes.u3}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-exam-u4" class="summary-value">${stats.avgExamenes.u4}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-exam-u5" class="summary-value">${stats.avgExamenes.u5}</span></span></td>

              <!-- Promedio Evaluaciones -->
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-eval-u1" class="summary-value">${stats.avgEvaluaciones[1]}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-eval-u2" class="summary-value">${stats.avgEvaluaciones[2]}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-eval-u3" class="summary-value">${stats.avgEvaluaciones[3]}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-eval-u4" class="summary-value">${stats.avgEvaluaciones[4]}</span></span></td>
              <td><span class="summary-chip"><span class="summary-label">AVG:</span> <span id="stat-avg-eval-u5" class="summary-value">${stats.avgEvaluaciones[5]}</span></span></td>

              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
        <div class="table-bottom-bar">
          <button class="add-row-btn" onclick="App.addNewStudentToCourse()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo alumno a la lista
          </button>
          <span style="font-size: 11.5px; color: var(--text-tertiary);">
            Auto-guardado activo en almacenamiento local
          </span>
        </div>
      </div>
    `;
  },

  // 2. VISTA DE DIRECTORIO MAESTRO DE ALUMNOS (BASE DE DATOS RELACIONAL)
  renderDirectory: function(container) {
    const students = this.data.students || [];
    
    let rowsHtml = "";
    students.forEach((s, idx) => {
      rowsHtml += `
        <tr>
          <td class="col-matricula">
            <input type="text" class="cell-input" value="${s.matricula}" 
              onfocus="this.select()"
              onchange="App.updateDirectoryStudent(${idx}, 'matricula', this.value)" />
          </td>
          <td>
            <input type="text" class="cell-input" value="${s.nombre}" style="font-weight: 500;"
              onfocus="this.select()"
              onchange="App.updateDirectoryStudent(${idx}, 'nombre', this.value)" />
          </td>
          <td>
            <input type="text" class="cell-input" value="${s.carrera || 'Ingeniería'}" 
              onfocus="this.select()"
              onchange="App.updateDirectoryStudent(${idx}, 'carrera', this.value)" />
          </td>
          <td style="text-align: center; width: 40px;">
            <button type="button" class="btn-delete-row" 
              title="Eliminar del directorio maestro" onclick="App.deleteDirectoryStudent('${(s.matricula || '').replace(/'/g, "\\'")}')">✕</button>
          </td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="page-title-area">
        <div class="page-title-row">
          <div>
            <h1 class="page-title">
              <span>👥</span> Directorio Maestro de Alumnos
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
  },

  // 3. VISTA DE PUBLICACIÓN EN TEAMS
  renderTeamsPublication: function(container) {
    const course = this.getActiveCourse();

    container.innerHTML = `
      <div class="page-title-area">
        <h1 class="page-title">
          <span>📤</span> Publicación de Calificaciones para Teams
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
          <button class="btn btn-default btn-sm" style="color: var(--color-red);" onclick="App.resetToDefault()">
            Restablecer a valores de demostración
          </button>
        </div>
      </div>

      <!-- Módulo de Consulta Rápida por Matrícula (Para Proyector o Alumno) -->
      <div class="student-search-box">
        <h3 style="margin-bottom: 6px;">🔍 Consulta Rápida por Matrícula</h3>
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
    const maxF = course.firmasMaxConfig || { u1: 6, u2: 14, u3: 17, u4: 23, u5: 10 };

    container.innerHTML = `
      <div class="page-title-area">
        <h1 class="page-title">
          <span>⚙️</span> Configuración de Fórmulas y Ponderaciones
        </h1>
        <p class="page-desc">
          Ajusta los máximos de firmas por unidad y revisa las fórmulas matemáticas activas.
        </p>
      </div>

      <div style="max-width: 750px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px;">
        <h3 style="font-size: 15px; margin-bottom: 14px;">Máximo de Firmas por Unidad (${course.nombre})</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 18px;">
          Define la cantidad máxima de firmas para la escala del 50% en cada unidad:
        </p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px;">
          ${[1, 2, 3, 4, 5].map(u => `
            <div>
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Unidad ${u}</label>
              <input type="number" min="1" max="100" class="form-control" value="${maxF[`u${u}`] || 10}" 
                onchange="App.updateMaxFirmasConfig('u${u}', this.value)" />
            </div>
          `).join('')}
        </div>

        <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 24px 0;" />

        <h3 style="font-size: 15px; margin-bottom: 12px;">Fórmulas Matemáticas Activas</h3>
        
        <div style="background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: 12.5px; margin-bottom: 14px; line-height: 1.6;">
          <b style="color: var(--accent-color);">// Evaluación por Unidad:</b><br />
          ((Firmas U<sub>x</sub> / MAX_Firmas U<sub>x</sub>) * 50) + (Examen U<sub>x</sub> * 0.5)
        </div>

        <div style="background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6;">
          <b style="color: var(--accent-color);">// Evaluación Final:</b><br />
          if(round(mean(U1, U2, U3, U4, U5, Proyecto) + (PuntosExtra * 5)) > 100, 100, round(...))
        </div>
      </div>
    `;
  },

  // ACCIONES Y ACTUALIZACIONES QUIRÚRGICAS DE DATOS (ULTRA FLUIDEZ < 1MS)
  updateFirmas: function(matricula, uKey, val) {
    const course = this.getActiveCourse();
    const rec = (course.records || []).find(r => r.matricula === matricula);
    if (rec) {
      if (!rec.firmas) rec.firmas = {};
      rec.firmas[uKey] = val === "" ? null : Number(val);
      this.updateStudentRowView(matricula, 'firmas', uKey, val);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updateExamen: function(matricula, uKey, val) {
    const course = this.getActiveCourse();
    const rec = (course.records || []).find(r => r.matricula === matricula);
    if (rec) {
      if (!rec.examenes) rec.examenes = {};
      rec.examenes[uKey] = val === "" ? null : Number(val);
      this.updateStudentRowView(matricula, 'examenes', uKey, val);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updateProyecto: function(matricula, val) {
    const course = this.getActiveCourse();
    const rec = (course.records || []).find(r => r.matricula === matricula);
    if (rec) {
      rec.proyecto = val === "" ? null : Number(val);
      this.updateStudentRowView(matricula, 'proyecto', null, val);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  updatePuntosExtra: function(matricula, val) {
    const course = this.getActiveCourse();
    const rec = (course.records || []).find(r => r.matricula === matricula);
    if (rec) {
      rec.puntosExtra = Number(val) || 0;
      this.updateStudentRowView(matricula, 'puntosExtra', null, val);
      this.updateSummaryStats();
      this.debouncedSave();
    }
  },

  // Actualización quirúrgica de una fila sin tocar el resto del DOM
  updateStudentRowView: function(matricula, field, uKey, val) {
    const course = this.getActiveCourse();
    const rec = (course.records || []).find(r => r.matricula === matricula);
    if (!rec) return;

    const calcs = this.calculateStudentGrades(rec, course);
    const maxFirmasConfig = course.firmasMaxConfig || {};

    // 1. Si se actualizó firmas de una unidad, actualizar anillo SVG correspondiente
    if (field === 'firmas' && uKey) {
      const ring = document.getElementById(`ring-firmas-${matricula}-${uKey}`);
      if (ring) {
        const maxF = maxFirmasConfig[uKey] || 10;
        const numVal = val !== "" && val !== null ? Number(val) : 0;
        const pct = Math.min(100, Math.round((numVal / maxF) * 100));
        const dashOffset = 44 - (44 * pct) / 100;
        const strokeColor = pct >= 100 ? 'var(--color-green)' : (pct >= 50 ? 'var(--color-orange)' : 'var(--border-color)');
        ring.style.strokeDashoffset = dashOffset;
        ring.style.stroke = strokeColor;
      }
    }

    // 2. Si se actualizó examen de una unidad, actualizar la barra de progreso correspondiente
    if (field === 'examenes' && uKey) {
      const bar = document.getElementById(`bar-exam-${matricula}-${uKey}`);
      if (bar) {
        const numVal = val !== "" && val !== null ? Number(val) : null;
        let barColor = "var(--color-green)";
        if (numVal !== null && numVal < 60) barColor = "var(--color-red)";
        else if (numVal !== null && numVal < 70) barColor = "var(--color-orange)";
        bar.style.width = (numVal !== null ? numVal : 0) + '%';
        bar.style.backgroundColor = barColor;
      }
    }

    // 3. Actualizar los números y anillos de Evaluación calculada U1 a U5
    for (let u = 1; u <= 5; u++) {
      const uK = `u${u}`;
      const valEl = document.getElementById(`val-eval-${matricula}-${uK}`);
      const ringEl = document.getElementById(`ring-eval-${matricula}-${uK}`);
      const evalVal = calcs.evalU[u] || 0;

      if (valEl) valEl.textContent = evalVal;
      if (ringEl) {
        let ringColor = "var(--color-green)";
        if (evalVal < 60) ringColor = "var(--color-red)";
        else if (evalVal < 70) ringColor = "var(--color-orange)";
        const pct = Math.min(100, evalVal);
        const dashOffset = 44 - (44 * pct) / 100;
        ringEl.style.strokeDashoffset = dashOffset;
        ringEl.style.stroke = ringColor;
      }
    }

    // 4. Actualizar Evaluación Final (número, barra e insignia)
    let finalColor = "var(--color-green)";
    if (calcs.evalFinal < 60) finalColor = "var(--color-red)";
    else if (calcs.evalFinal < 70) finalColor = "var(--color-orange)";

    const valFinal = document.getElementById(`val-final-${matricula}`);
    const barFinal = document.getElementById(`bar-final-${matricula}`);
    const badgeFinal = document.getElementById(`badge-final-${matricula}`);

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
  },

  // Actualización quirúrgica de las estadísticas del pie de tabla
  updateSummaryStats: function() {
    const course = this.getActiveCourse();
    const stats = this.calculateCourseStats(course);
    const maxFirmasConfig = course.firmasMaxConfig || {};

    const avgFinalEl = document.getElementById('stat-avg-final');
    if (avgFinalEl) avgFinalEl.textContent = stats.avgFinal;

    for (let u = 1; u <= 5; u++) {
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
          nextInput.focus();
          nextInput.select();
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
          prevInput.focus();
          prevInput.select();
        }
      }
    }
  },

  updateMatricula: function(recordIndex, newMatricula) {
    const course = this.getActiveCourse();
    if (course.records[recordIndex]) {
      course.records[recordIndex].matricula = newMatricula.trim();
      this.saveData();
      this.render();
    }
  },

  addNewStudentToCourse: function() {
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
    const course = this.getActiveCourse();
    let idx = -1;
    if (typeof identifier === "number") {
      idx = identifier;
    } else {
      idx = (course.records || []).findIndex(r => String(r.matricula) === String(identifier));
    }

    if (idx !== -1) {
      const deleted = course.records.splice(idx, 1)[0];
      const studentMap = this.getStudentsMap();
      const sName = studentMap[deleted.matricula] ? studentMap[deleted.matricula].nombre : deleted.matricula;
      const isPlaceholder = deleted.matricula === "NUEVA_MATRICULA";

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

  // Gestión del Directorio Maestro
  updateDirectoryStudent: function(index, field, value) {
    if (this.data.students[index]) {
      this.data.students[index][field] = value.trim();
      this.debouncedSave();
    }
  },

  addEmptyStudentToDirectory: function() {
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

  updateMaxFirmasConfig: function(uKey, val) {
    const course = this.getActiveCourse();
    if (!course.firmasMaxConfig) course.firmasMaxConfig = {};
    course.firmasMaxConfig[uKey] = Number(val) || 10;
    this.saveData();
    this.render();
    this.showToast(`Máximo de firmas de ${uKey.toUpperCase()} actualizado a ${val}`);
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
      resultDiv.innerHTML = `<div class="student-result-card" style="border-color: var(--color-red);"><p>No se encontró ningún registro para la matrícula <b>${matricula}</b> en ${course.nombre}.</p></div>`;
      return;
    }

    const calcs = this.calculateStudentGrades(rec, course);
    const estatus = calcs.evalFinal >= 70 ? "APROBADO" : "NO APROBADO";

    resultDiv.innerHTML = `
      <div class="student-result-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <h4 style="font-size: 16px;">${student.nombre}</h4>
            <span style="font-size: 12.5px; color: var(--text-secondary);">Matrícula: <b>${rec.matricula}</b> • ${course.nombre}</span>
          </div>
          <span class="status-badge ${calcs.evalFinal >= 70 ? 'status-aprobado' : 'status-reprobado'}" style="font-size: 12px; padding: 4px 10px;">
            ${estatus} (${calcs.evalFinal} PTS)
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; text-align: center; margin: 16px 0; background: var(--bg-secondary); padding: 10px; border-radius: 6px;">
          ${[1, 2, 3, 4, 5].map(u => `
            <div>
              <div style="font-size: 10.5px; color: var(--text-tertiary);">U${u}</div>
              <div style="font-size: 14px; font-weight: bold; color: ${calcs.evalU[u] >= 70 ? 'var(--color-green)' : 'var(--color-red)'};">${calcs.evalU[u]}</div>
              <div style="font-size: 10px; color: var(--text-secondary);">${rec.firmas ? (rec.firmas[`u${u}`] || 0) : 0} firmas / ${rec.examenes ? (rec.examenes[`u${u}`] || 0) : 0} ex</div>
            </div>
          `).join('')}
        </div>

        <div style="font-size: 12px; color: var(--text-secondary); display: flex; justify-content: space-between;">
          <span>Proyecto Final: <b>${rec.proyecto !== null && rec.proyecto !== undefined ? rec.proyecto : '-'}</b></span>
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
        const matricula = parts[0].trim().replace(/["']/g, '');
        const nombre = parts[1] ? parts[1].trim().replace(/["']/g, '') : "ALUMNO REGISTRADO";

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
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed.students && parsed.courses) {
          this.data = parsed;
          this.saveData();
          this.render();
          this.showToast("Respaldo restaurado exitosamente.");
        } else {
          alert("El archivo no tiene el formato de respaldo correcto.");
        }
      } catch (err) {
        alert("Error al leer el archivo JSON.");
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
    const currentCourse = this.getActiveCourse();
    const inputNombre = document.getElementById("newCourseNombre");
    const inputGrupo = document.getElementById("newCourseGrupo");
    const inputPeriodo = document.getElementById("newCoursePeriodo");
    const inputUnidades = document.getElementById("newCourseUnidades");

    if (inputNombre) inputNombre.value = currentCourse.nombre || "";
    if (inputGrupo) {
      const existingSameSubject = this.data.courses.filter(c => c.nombre === currentCourse.nombre);
      inputGrupo.value = "Grupo " + String.fromCharCode(65 + (existingSameSubject.length % 26));
    }
    if (inputPeriodo) inputPeriodo.value = currentCourse.periodo || "2026-1";
    if (inputUnidades) inputUnidades.value = currentCourse.unidadesCount || 5;

    const modal = document.getElementById("newCourseModal");
    if (modal) modal.classList.add("open");
  },

  closeNewCourseModal: function() {
    const modal = document.getElementById("newCourseModal");
    if (modal) modal.classList.remove("open");
  },

  submitCreateCourse: function() {
    const nombre = document.getElementById("newCourseNombre")?.value.trim();
    const grupo = document.getElementById("newCourseGrupo")?.value.trim() || "Grupo A";
    const periodo = document.getElementById("newCoursePeriodo")?.value.trim() || "2026-1";
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

    this.data.courses.push(newCourse);
    this.activeCourseId = newId;
    this.saveData();
    this.closeNewCourseModal();
    this.render();
    this.showToast(`Lista creada: ${nombre} • ${grupo}`);
  },

  openManageCourseModal: function() {
    const course = this.getActiveCourse();
    const inputNombre = document.getElementById("editCourseNombre");
    const inputGrupo = document.getElementById("editCourseGrupo");
    const inputPeriodo = document.getElementById("editCoursePeriodo");

    if (inputNombre) inputNombre.value = course.nombre;
    if (inputGrupo) inputGrupo.value = course.grupo || "Grupo A";
    if (inputPeriodo) inputPeriodo.value = course.periodo || "2026-1";

    const modal = document.getElementById("manageCourseModal");
    if (modal) modal.classList.add("open");
  },

  closeManageCourseModal: function() {
    const modal = document.getElementById("manageCourseModal");
    if (modal) modal.classList.remove("open");
  },

  submitEditCourse: function() {
    const course = this.getActiveCourse();
    const nombre = document.getElementById("editCourseNombre")?.value.trim();
    const grupo = document.getElementById("editCourseGrupo")?.value.trim();
    const periodo = document.getElementById("editCoursePeriodo")?.value.trim();

    if (!nombre) {
      alert("El nombre de la materia no puede estar vacío.");
      return;
    }

    course.nombre = nombre;
    course.grupo = grupo || "Grupo A";
    course.periodo = periodo || "2026-1";

    this.saveData();
    this.closeManageCourseModal();
    this.render();
    this.showToast(`Datos actualizados: ${nombre} • ${course.grupo}`);
  },

  duplicateCurrentCourse: function() {
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
      records: [] // Nueva lista limpia para este grupo
    };

    this.data.courses.push(duplicated);
    this.activeCourseId = newId;
    this.saveData();
    this.closeManageCourseModal();
    this.render();
    this.showToast(`Lista duplicada: ${course.nombre} • ${newGroup.trim()}`);
  },

  deleteCurrentCourse: function() {
    if (this.data.courses.length <= 1) {
      alert("No puedes eliminar la única lista que tienes.");
      return;
    }

    const course = this.getActiveCourse();
    if (confirm(`¿Estás seguro de que deseas eliminar la lista de "${course.nombre} - ${course.grupo}"? Esta acción no se puede deshacer.`)) {
      const idx = this.data.courses.findIndex(c => c.id === course.id);
      if (idx !== -1) {
        this.data.courses.splice(idx, 1);
        this.activeCourseId = this.data.courses[0].id;
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
            <div class="login-institution-badge">
              <span>🏛️</span> Facultad de Ingeniería Tampico • UAT
            </div>
            <h1 class="login-title">Acceso Docente</h1>
            <p class="login-subtitle">
              Ingresa con tu cuenta institucional para gestionar tus materias, actas y calificaciones protegidas.
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
            ${this.loginTab === 'login' ? `
              <form onsubmit="event.preventDefault(); App.handleLoginFormSubmit();">
                <div class="login-form-group">
                  <label class="login-label">Usuario o Correo Institucional:</label>
                  <div class="login-input-wrap">
                    <span class="login-input-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </span>
                    <input type="text" id="loginIdentifier" class="login-input" placeholder="ej. rgarcia o rgarcia@docentes.uat.edu.mx" value="rgarcia" required />
                  </div>
                </div>

                <div class="login-form-group">
                  <label class="login-label">Contraseña:</label>
                  <div class="login-input-wrap">
                    <span class="login-input-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input type="password" id="loginPassword" class="login-input" placeholder="Contraseña de acceso" value="123" required />
                  </div>
                </div>

                <button type="submit" class="btn-login-submit">
                  <span>Acceder a mis Listas</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </form>

              <div class="demo-teachers-section">
                <div class="demo-teachers-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
                  Cuentas de Demostración (Acceso con 1 Clic):
                </div>
                ${this.teachers.map(t => {
                  if (t.role === 'admin') {
                    return `
                      <div class="demo-teacher-card" style="border: 1.5px solid var(--uat-orange); background: rgba(224, 126, 51, 0.08);" onclick="App.quickLogin('${t.id}')">
                        <div class="demo-avatar">${t.avatar || '🏛️'}</div>
                        <div style="flex: 1;">
                          <div class="demo-name" style="color: var(--uat-orange-dark);">${t.nombre} <span class="badge-role-admin">PERFIL MAESTRO</span></div>
                          <div class="demo-sub">Supervisión general de todos los profesores, materias y calificaciones</div>
                        </div>
                        <span class="demo-badge-enter" style="background: var(--uat-orange); color: white;">Entrar como Admin ➜</span>
                      </div>
                    `;
                  }
                  const subjectNames = (t.data && t.data.courses) ? t.data.courses.map(c => c.nombre).slice(0, 2).join(', ') : 'Sin materias';
                  return `
                    <div class="demo-teacher-card" onclick="App.quickLogin('${t.id}')">
                      <div class="demo-avatar">${t.avatar || '👨‍🏫'}</div>
                      <div style="flex: 1;">
                        <div class="demo-name">${t.nombre}</div>
                        <div class="demo-sub">${t.departamento} • ${subjectNames}</div>
                      </div>
                      <span class="demo-badge-enter">Entrar ➜</span>
                    </div>
                  `;
                }).join('')}
              </div>
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
                    <input type="password" id="regPassword" class="login-input" style="padding-left: 14px;" placeholder="Contraseña" value="123" required />
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

  switchLoginTab: function(tab) {
    this.loginTab = tab;
    const container = document.getElementById("tabContentContainer");
    if (container) this.renderLoginScreen(container);
  },

  handleLoginFormSubmit: function() {
    const identifier = document.getElementById("loginIdentifier")?.value.trim();
    const password = document.getElementById("loginPassword")?.value;
    if (!identifier) {
      alert("Por favor ingresa tu usuario o correo institucional.");
      return;
    }
    this.login(identifier, password);
  },

  handleRegisterFormSubmit: function() {
    const nombre = document.getElementById("regNombre")?.value.trim();
    const usuario = document.getElementById("regUsuario")?.value.trim().toLowerCase();
    const correo = document.getElementById("regCorreo")?.value.trim().toLowerCase();
    const depto = document.getElementById("regDepto")?.value.trim() || "Facultad de Ingeniería Tampico";
    const password = document.getElementById("regPassword")?.value || "123";

    if (!nombre || !usuario || !correo) {
      alert("Por favor completa los campos requeridos.");
      return;
    }

    if (this.teachers.some(t => t.usuario.toLowerCase() === usuario || t.correo.toLowerCase() === correo)) {
      alert("Ya existe un docente con ese usuario o correo.");
      return;
    }

    const newTeacher = {
      id: "prof-" + usuario + "-" + Date.now(),
      nombre: nombre,
      usuario: usuario,
      correo: correo,
      password: password,
      departamento: depto,
      avatar: "👨‍🏫",
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
    this.saveTeachers();
    if (typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) {
      FirebaseService.saveTeacher(newTeacher);
    }
    this.quickLogin(newTeacher.id);
    this.showToast(`¡Bienvenido, ${nombre}! Tu espacio docente ha sido creado.`);
  },

  quickLogin: function(teacherId) {
    const teacher = this.teachers.find(t => t.id === teacherId);
    if (teacher) {
      this.currentUser = teacher;
      localStorage.setItem("notion_active_teacher_id", teacher.id);
      this.isSupervising = false;
      this.supervisingTeacherId = null;

      if (teacher.role === 'admin') {
        this.data = null;
        this.activeTab = "admin_dashboard";
      } else {
        this.data = teacher.data;
        this.activeCourseId = (teacher.data && teacher.data.courses && teacher.data.courses[0]) ? teacher.data.courses[0].id : "";
        this.activeTab = "gradebook";
      }
      this.render();
      this.showToast(`Sesión iniciada como ${teacher.nombre}`);
    }
  },

  login: function(identifier, password) {
    const term = identifier.trim().toLowerCase();
    const teacher = this.teachers.find(t => 
      t.usuario.toLowerCase() === term || 
      t.correo.toLowerCase() === term
    );

    if (!teacher) {
      alert("No se encontró ningún usuario o correo institucional.");
      return;
    }

    if (teacher.password && password && teacher.password !== password) {
      alert("Contraseña incorrecta. (Para pruebas puedes usar 'admin' o '123')");
      return;
    }

    this.quickLogin(teacher.id);
  },

  logout: function() {
    if (typeof FirebaseService !== "undefined") {
      FirebaseService.stopListening();
    }
    this.currentUser = null;
    this.isSupervising = false;
    this.supervisingTeacherId = null;
    this.data = null;
    localStorage.removeItem("notion_active_teacher_id");
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

  superviseTeacher: function(teacherId) {
    const teacher = this.teachers.find(t => t.id === teacherId);
    if (!teacher) return;

    this.isSupervising = true;
    this.supervisingTeacherId = teacherId;
    this.data = teacher.data;
    this.activeCourseId = (teacher.data && teacher.data.courses && teacher.data.courses[0]) ? teacher.data.courses[0].id : "";
    this.activeTab = "gradebook";
    this.render();
    this.showToast(`Modo Supervisión: Auditando a ${teacher.nombre}`);

    // Suscripción en tiempo real a Firestore para ver las notas del profesor en vivo
    if (typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) {
      FirebaseService.listenToTeacher(teacherId, (updated) => {
        if (this.isSupervising && this.supervisingTeacherId === teacherId) {
          const idx = this.teachers.findIndex(t => t.id === teacherId);
          if (idx !== -1) this.teachers[idx] = updated;
          this.data = updated.data;
          this.saveTeachers();
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

  exitSupervision: function() {
    if (typeof FirebaseService !== "undefined") {
      FirebaseService.stopListening();
    }
    this.isSupervising = false;
    this.supervisingTeacherId = null;
    this.data = this.currentUser.data || null;
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
      const depto = teacher ? teacher.departamento : 'FIUAT';

      container.innerHTML = `
        <div class="supervision-banner">
          <div class="supervision-banner-info">
            <span class="supervision-pulse-icon">👁️</span>
            <span><b>Modo Supervisión Activo:</b> Auditando listas y calificaciones de <u>${name}</u> (${depto})</span>
          </div>
          <button type="button" class="btn-exit-supervision" onclick="App.exitSupervision()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            Volver al Panel Maestro
          </button>
        </div>
      `;
    } else {
      container.innerHTML = "";
    }
  },

  renderAdminDashboard: function(container) {
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
              <span>📐 ${c.nombre} (${c.grupo || 'Grupo A'})</span>
              <span style="color: var(--text-secondary); font-size: 11px;">${(c.records || []).length} alumnos</span>
            </div>
          `;
        });
        if (courses.length > 3) {
          coursesHtml += `<div style="font-size: 11px; color: var(--text-tertiary); text-align: right;">+${courses.length - 3} materias más...</div>`;
        }
      }

      teachersGridHtml += `
        <div class="admin-teacher-card">
          <div>
            <div class="admin-teacher-header">
              <div class="admin-teacher-avatar">${t.avatar || '👨‍🏫'}</div>
              <div style="flex: 1; min-width: 0;">
                <div class="admin-teacher-name">${t.nombre}</div>
                <div class="admin-teacher-email">${t.correo || t.usuario}</div>
                <span class="admin-teacher-depto">${t.departamento}</span>
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
            <button type="button" class="btn-supervise" onclick="App.superviseTeacher('${t.id}')">
              <span>👁️ Supervisar / Auditar Calificaciones</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="admin-dashboard-container">
        <div class="admin-header-area">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="font-size: 20px;">🏛️</span>
              <h1 style="font-size: 22px; font-weight: 800; color: var(--text-primary);">
                Panel Central de Control y Supervisión Docente
              </h1>
              <span class="badge-role-admin">DIRECCIÓN FIUAT</span>
            </div>
            <p style="font-size: 13.5px; color: var(--text-secondary); max-width: 800px;">
              Supervisión de actas, avance de firmas y calificaciones de todos los profesores de la <b>Facultad de Ingeniería Tampico</b>.
            </p>
          </div>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-default" onclick="App.downloadAllFacultyBackup()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Respaldo General (.json)
            </button>
            <button class="btn btn-primary" onclick="App.openRegisterTeacherModal()">
              + Dar de Alta Nuevo Docente
            </button>
          </div>
        </div>

        <!-- Métricas Generales de la Facultad -->
        <div class="admin-stats-grid">
          <div class="admin-stat-card">
            <div class="admin-stat-icon">👥</div>
            <div>
              <div class="admin-stat-value">${teachersList.length}</div>
              <div class="admin-stat-label">Profesores Registrados</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon">📚</div>
            <div>
              <div class="admin-stat-value">${totalMaterias}</div>
              <div class="admin-stat-label">Grupos y Materias Activas</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon">🎓</div>
            <div>
              <div class="admin-stat-value">${totalAlumnosMatriculados}</div>
              <div class="admin-stat-label">Estudiantes Registrados</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon">⭐</div>
            <div>
              <div class="admin-stat-value">${promedioGeneral} pts</div>
              <div class="admin-stat-label">Promedio General Facultad</div>
            </div>
          </div>
        </div>

        <!-- Directorio de Docentes para Supervisión -->
        <div class="admin-section-title">
          <span>👨‍🏫 Profesores y Cuentas Docentes (${teachersList.length})</span>
          <span style="font-size: 12.5px; font-weight: 500; color: var(--text-tertiary);">
            Haz clic en "Supervisar" en cualquier docente para auditar sus listas y actas oficiales
          </span>
        </div>

        <div class="admin-teachers-grid">
          ${teachersGridHtml}
        </div>
      </div>
    `;
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
    const dropdown = document.getElementById("teacherDropdown");
    if (dropdown) dropdown.classList.remove("open");

    const list = document.getElementById("switchTeacherList");
    if (list) {
      list.innerHTML = this.teachers.map(t => {
        const isCurrent = this.currentUser && this.currentUser.id === t.id;
        const coursesCount = (t.data && t.data.courses) ? t.data.courses.length : 0;
        const studentsCount = (t.data && t.data.students) ? t.data.students.length : 0;
        return `
          <div class="demo-teacher-card" style="margin-bottom: 0; ${isCurrent ? 'border-color: var(--uat-orange); background: var(--bg-hover);' : ''}" onclick="App.switchTeacher('${t.id}')">
            <div class="demo-avatar">${t.avatar || '👨‍🏫'}</div>
            <div style="flex: 1;">
              <div class="demo-name">${t.nombre} ${isCurrent ? '<span style="color: var(--uat-orange); font-size: 11px;">(Activo)</span>' : ''}</div>
              <div class="demo-sub">${t.departamento} • ${coursesCount} materias • ${studentsCount} alumnos</div>
            </div>
            <button class="btn btn-default btn-sm" style="pointer-events: none;">
              ${isCurrent ? 'Seleccionado' : 'Cambiar'}
            </button>
          </div>
        `;
      }).join('');
    }

    const modal = document.getElementById("switchTeacherModal");
    if (modal) modal.classList.add("open");
  },

  closeSwitchTeacherModal: function() {
    const modal = document.getElementById("switchTeacherModal");
    if (modal) modal.classList.remove("open");
  },

  switchTeacher: function(teacherId) {
    this.closeSwitchTeacherModal();
    this.quickLogin(teacherId);
  },

  openRegisterTeacherModal: function() {
    this.closeSwitchTeacherModal();
    const modal = document.getElementById("registerTeacherModal");
    if (modal) modal.classList.add("open");
  },

  closeRegisterTeacherModal: function() {
    const modal = document.getElementById("registerTeacherModal");
    if (modal) modal.classList.remove("open");
  },

  submitRegisterTeacher: function() {
    const nombre = document.getElementById("regTeacherNombre")?.value.trim();
    const usuario = document.getElementById("regTeacherUsuario")?.value.trim().toLowerCase();
    const correo = document.getElementById("regTeacherCorreo")?.value.trim().toLowerCase();
    const depto = document.getElementById("regTeacherDepto")?.value.trim() || "Facultad de Ingeniería Tampico";
    const password = document.getElementById("regTeacherPassword")?.value || "123";

    if (!nombre || !usuario || !correo) {
      alert("Por favor completa los campos requeridos.");
      return;
    }

    if (this.teachers.some(t => t.usuario.toLowerCase() === usuario || t.correo.toLowerCase() === correo)) {
      alert("Ya existe un docente con ese usuario o correo.");
      return;
    }

    const newTeacher = {
      id: "prof-" + usuario + "-" + Date.now(),
      nombre: nombre,
      usuario: usuario,
      correo: correo,
      password: password,
      departamento: depto,
      avatar: "👨‍🏫",
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
    this.saveTeachers();
    if (typeof FirebaseService !== "undefined" && FirebaseService.isInitialized) {
      FirebaseService.saveTeacher(newTeacher);
    }
    this.closeRegisterTeacherModal();
    this.quickLogin(newTeacher.id);
    this.showToast(`Profesor ${nombre} registrado con éxito.`);
  },

  setupEventListeners: function() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeBulkImportModal();
        this.closeNewCourseModal();
        this.closeManageCourseModal();
        this.closeSwitchTeacherModal();
        this.closeRegisterTeacherModal();
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
  }
};

window.addEventListener("DOMContentLoaded", () => {
  App.init();
});

