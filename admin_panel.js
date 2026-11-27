// admin_panel.js - Panel Central de Coordinación, tarjetas 3D Moxen, alta de docentes y gestión de contraseñas

Object.assign(App, {
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

    const teachersList = this.teachers.filter(t => t.role !== "admin");

    let totalMaterias = 0;
    let totalAlumnosDirectorio = 0;
    let totalInscripciones = 0;

    teachersList.forEach(t => {
      const preview = Array.isArray(t.coursesPreview)
        ? t.coursesPreview
        : ((t.data && Array.isArray(t.data.courses)) ? t.data.courses : []);
      const cCount = (t.coursesCount !== undefined) ? Number(t.coursesCount) : preview.length;
      const sCount = (t.studentsCount !== undefined) ? Number(t.studentsCount) : ((t.data && t.data.students) ? t.data.students.length : 0);
      totalMaterias += cCount;
      totalAlumnosDirectorio += sCount;
      preview.forEach(c => {
        totalInscripciones += (c.recordsCount !== undefined)
          ? Number(c.recordsCount)
          : ((c.records && c.records.length) ? c.records.length : 0);
      });
    });

    let teachersGridHtml = "";
    teachersList.forEach(t => {
      const courses = Array.isArray(t.coursesPreview)
        ? t.coursesPreview
        : ((t.data && Array.isArray(t.data.courses)) ? t.data.courses : []);
      const studentsCount = (t.studentsCount !== undefined)
        ? Number(t.studentsCount)
        : ((t.data && t.data.students) ? t.data.students.length : 0);
      const totalInscTeacher = courses.reduce((sum, c) => {
        const rc = (c.recordsCount !== undefined) ? Number(c.recordsCount) : ((c.records && c.records.length) ? c.records.length : 0);
        return sum + rc;
      }, 0) || studentsCount;
      const totalHorasSemana = courses.length * 4;

      // 1. Vista previa frontal (máximo 2 materias)
      let previewFrontHtml = "";
      if (courses.length === 0) {
        previewFrontHtml = `<div class="vo-empty-courses">Sin materias registradas aún</div>`;
      } else {
        courses.slice(0, 2).forEach(c => {
          const cNom = this.escapeHtml(c.nombre || "");
          const cGrp = this.escapeHtml(c.grupo || "Grupo A");
          const cRec = (c.recordsCount !== undefined) ? Number(c.recordsCount) : ((c.records && c.records.length) ? c.records.length : 0);
          previewFrontHtml += `
            <div class="admin-course-pill">
              <span class="pill-cname" title="${cNom}">${cNom} (${cGrp})</span>
              <span class="pill-cmeta">${cRec} al.</span>
            </div>
          `;
        });
        if (courses.length > 2) {
          previewFrontHtml += `<div class="vo-more-courses">+${courses.length - 2} más en el reverso ↻</div>`;
        }
      }

      // 2. Desglose detallado en el dorso
      let coursesBackHtml = "";
      if (courses.length === 0) {
        coursesBackHtml = `<div class="vo-empty-courses">No hay materias asignadas en este periodo</div>`;
      } else {
        courses.forEach((c, idx) => {
          const diasTexto = idx % 2 === 0 ? "Lun - Mié - Vie" : "Mar - Jue";
          const aulaTexto = this.escapeHtml(c.aula ? c.aula : "Aula por asignar");
          const cNom = this.escapeHtml(c.nombre || "");
          const cGrp = this.escapeHtml(c.grupo || "Grupo A");
          const cRec = (c.recordsCount !== undefined) ? Number(c.recordsCount) : ((c.records && c.records.length) ? c.records.length : 0);
          coursesBackHtml += `
            <div class="vo-course-item">
              <div class="vo-course-title" title="${cNom}">${cNom} (${cGrp})</div>
              <div class="vo-course-meta">
                <span class="vo-badge-aula">${aulaTexto}</span>
                <span class="vo-badge-dias">${diasTexto} • 4 hrs/sem</span>
                <span style="margin-left: auto; font-weight: 600;">${cRec} alumnos</span>
              </div>
            </div>
          `;
        });
      }

      const coursesSearchStr = this.escapeHtml(courses.map(c => (c.nombre || "") + " " + (c.grupo || "")).join(" ").toLowerCase());
      const cardAvatar = t.role === "admin"
        ? `<img src="Logos/Escudo Imagotipo.png" alt="UAT" width="38" height="38" decoding="async" />`
        : `<img src="Logos/FI-SOLO-COLOR.png" alt="FI" width="38" height="38" decoding="async" />`;
      const rawDepto = (t.departamento && !t.departamento.includes("Ã")) ? t.departamento : "Facultad de Ingeniería Tampico";
      const escName = this.escapeHtml(t.nombre || "");
      const escNameLower = this.escapeHtml((t.nombre || "").toLowerCase());
      const escEmail = this.escapeHtml(t.correo || t.usuario || "");
      const escDepto = this.escapeHtml(rawDepto);
      const escId = this.escapeHtml(t.id || "");

      teachersGridHtml += `
        <div class="admin-teacher-card vo-tarjeta"
             data-teacher-name="${escNameLower}"
             data-teacher-courses="${coursesSearchStr}"
             role="button"
             tabindex="0"
             aria-pressed="false"
             aria-label="Ficha del docente ${escName}. Haz clic para girar y ver opciones de supervisión">
          <div class="vo-sombra" aria-hidden="true"></div>
          <div class="vo-giro">
            <i class="vo-canto" aria-hidden="true"></i>

            <!-- CARA FRONTAL -->
            <section class="vo-cara vo-frente">
              <i class="vo-brillo" aria-hidden="true"></i>

              <div>
                <div class="admin-teacher-header">
                  <div class="admin-teacher-avatar">${cardAvatar}</div>
                  <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                      <div class="admin-teacher-name" title="${escName}">${escName}</div>
                      <span class="admin-card-badge-status">● Activo</span>
                    </div>
                    <div class="admin-teacher-email">${escEmail}</div>
                    <span class="admin-teacher-depto">${escDepto}</span>
                  </div>
                </div>

                <div class="admin-kpi-row">
                  <div class="admin-kpi-item">
                    <span class="admin-kpi-val">${courses.length}</span>
                    <span class="admin-kpi-lbl">Materias</span>
                  </div>
                  <div class="admin-kpi-item">
                    <span class="admin-kpi-val">${totalInscTeacher}</span>
                    <span class="admin-kpi-lbl">Alumnos</span>
                  </div>
                  <div class="admin-kpi-item">
                    <span class="admin-kpi-val">${totalHorasSemana}h</span>
                    <span class="admin-kpi-lbl">Carga/Sem</span>
                  </div>
                </div>

                <div class="admin-teacher-courses-preview">
                  <div style="font-weight: 700; font-size: 11.5px; color: var(--text-primary); margin-bottom: 5px; display: flex; justify-content: space-between;">
                    <span>Materias Activas</span>
                    <span style="color: var(--text-tertiary);">${courses.length} asignadas</span>
                  </div>
                  <div class="admin-teacher-courses-list">
                    ${previewFrontHtml}
                  </div>
                </div>
              </div>

              <div>
                <button type="button" class="btn-flip-trigger vo-btn-flip" data-flip-dir="next">
                  <span>Ver detalles, grupos y acciones</span>
                  <span class="vo-icon-spin" aria-hidden="true">↻</span>
                </button>
              </div>
            </section>

            <!-- CARA POSTERIOR (DORSO) -->
            <section class="vo-cara vo-dorso" aria-hidden="true">
              <i class="vo-brillo" aria-hidden="true"></i>

              <div>
                <div class="vo-dorso-header">
                  <div class="vo-dorso-title">
                    <span>Gestión Académica</span>
                    <span class="badge-role-tag">${t.role === "admin" ? "Coordinación" : "Docente"}</span>
                  </div>
                  <div class="vo-dorso-name" title="${escName}">${escName}</div>
                </div>

                <div class="vo-dorso-courses-scroll">
                  ${coursesBackHtml}
                </div>
              </div>

              <div class="vo-dorso-actions">
                <button type="button" class="btn-supervise" data-teacher-id="${escId}" onclick="event.stopPropagation(); App.superviseTeacher(this.dataset.teacherId)">
                  <span>Supervisar / Auditar Calificaciones</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button type="button" class="btn btn-default btn-sm btn-manage-account" data-teacher-id="${escId}" onclick="event.stopPropagation(); App.openAdminManageTeacherModal(this.dataset.teacherId)" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; font-size: 11.5px; padding: 7px 10px; border-radius: var(--radius-md); color: var(--text-secondary);" title="Administrar cuenta y restablecer clave del docente">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  <span>Administrar Cuenta / Clave</span>
                </button>
                <button type="button" class="btn-flip-back vo-btn-flip" data-flip-dir="prev">
                  <span>↺ Volver al frente</span>
                </button>
              </div>
            </section>
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
            <button class="btn btn-default" onclick="App.openChangePasswordModal()" style="display: inline-flex; align-items: center; gap: 7px; font-weight: 700; color: var(--uat-orange); border-color: rgba(224, 90, 43, 0.4); background: rgba(224, 90, 43, 0.05); padding: 8px 14px; border-radius: var(--radius-sm);" title="Cambiar la clave de acceso de la Cuenta Maestra de Coordinación">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>Mi Clave de Coordinación</span>
            </button>
            <button class="btn btn-default" onclick="App.downloadAllFacultyBackup()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Respaldo (.json)</span>
            </button>
            <button class="btn btn-primary" onclick="App.openRegisterTeacherModal()">
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
              <div class="admin-stat-value">${totalAlumnosDirectorio}</div>
              <div class="admin-stat-label">Estudiantes en Directorios</div>
            </div>
          </div>

          <div class="admin-stat-card">
            <div class="admin-stat-icon" style="color: var(--uat-orange);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
            </div>
            <div>
              <div class="admin-stat-value">${totalInscripciones > 0 ? totalInscripciones : "--"}</div>
              <div class="admin-stat-label">Inscripciones en Grupos</div>
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
    this.initTeacherCardsVolteo();
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

  initTeacherCardsVolteo: function() {
    const grid = document.getElementById("adminTeachersGrid");
    if (!grid) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const RAD = Math.PI / 180;
    const plano = a => { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; };

    const cards = grid.querySelectorAll(".admin-teacher-card");
    cards.forEach(card => {
      if (card._moxenVolteo) return;

      const giroEl = card.querySelector(".vo-giro");
      const sombra = card.querySelector(".vo-sombra");
      const frente = card.querySelector(".vo-frente");
      const dorso = card.querySelector(".vo-dorso");
      const brillos = [frente, dorso].map(c => c ? c.querySelector(".vo-brillo") : null);
      const canto = card.querySelector(".vo-canto");
      if (frente) frente.classList.add("vo-oscura");
      if (dorso) dorso.classList.add("vo-oscura");

      let giro = 0, vel = 0, meta = 0, raf = 0, previo = null;

      function pinta() {
        const a = giro * RAD, s = Math.abs(Math.sin(a)), c = Math.cos(a);
        const alza = 50 * s;
        if (giroEl) giroEl.style.transform = "translateZ(" + alza.toFixed(1) + "px) rotateY(" + giro.toFixed(1) + "deg)";
        if (sombra) {
          sombra.style.transform = "scale(" + (1 + alza / 200).toFixed(3) + ")";
          sombra.style.opacity = (0.85 - alza / 150).toFixed(2);
        }
        if (canto) canto.style.opacity = Math.max(0, Math.min(1, (s - 0.75) / 0.2)).toFixed(2);
        if (frente) frente.style.setProperty("--o", ((1 - Math.max(0, c)) * 0.5).toFixed(2));
        if (dorso) dorso.style.setProperty("--o", ((1 - Math.max(0, -c)) * 0.5).toFixed(2));
        if (brillos[0] || brillos[1]) {
          [plano(giro), plano(giro - 180)].forEach((tAngle, k) => {
            if (brillos[k]) {
              const p = Math.max(-1, Math.min(1, tAngle / 90));
              brillos[k].style.transform = "translateX(" + (-100 + (p + 1) / 2 * 267).toFixed(1) + "%)";
              brillos[k].style.opacity = (Math.abs(tAngle) < 90 ? Math.sin(Math.abs(tAngle) * RAD) : 0).toFixed(2);
            }
          });
        }
        card.classList.toggle("is-dorso", Math.abs(plano(giro - 180)) < 55);
      }

      function paso(t) {
        const dt = previo === null ? 1 / 60 : Math.min(0.032, (t - previo) / 1000);
        previo = t;
        for (let i = 0; i < 4; i++) {
          const h = dt / 4;
          vel += (-95 * (giro - meta) - 11.5 * vel) * h;
          giro += vel * h;
        }
        pinta();
        if (Math.abs(giro - meta) < 0.05 && Math.abs(vel) < 0.5) {
          giro = meta;
          pinta();
          raf = 0;
          previo = null;
          card.classList.remove("is-flipping");
          if (meta % 360 === 0 && giroEl) giroEl.style.transform = "";
          return;
        }
        raf = requestAnimationFrame(paso);
      }

      const arranca = () => {
        card.classList.add("is-flipping");
        if (!raf) raf = requestAnimationFrame(paso);
      };

      function voltea(lado) {
        meta += 180 * (lado < 0 ? -1 : 1);
        const atras = Math.round(meta / 180) % 2 !== 0;
        card.setAttribute("aria-pressed", String(atras));
        if (frente) frente.setAttribute("aria-hidden", String(atras));
        if (dorso) dorso.setAttribute("aria-hidden", String(!atras));
        if (reduce) {
          giro = meta;
          pinta();
          card.classList.remove("is-flipping");
          if (meta % 360 === 0 && giroEl) giroEl.style.transform = "";
          return;
        }
        arranca();
      }

      card.addEventListener("click", e => {
        if (e.target.closest("button, a, input, select, textarea, .btn-supervise, .btn-manage-account, .no-flip")) {
          return;
        }
        const r = card.getBoundingClientRect();
        voltea(e.detail === 0 || e.clientX > r.left + r.width / 2 ? 1 : -1);
      });

      card.querySelectorAll(".vo-btn-flip").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          e.preventDefault();
          const dir = btn.getAttribute("data-flip-dir") === "prev" ? -1 : 1;
          voltea(dir);
        });
      });

      card.addEventListener("keydown", e => {
        if (e.target.closest("button, a, input, select, textarea")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          voltea(1);
        }
      });

      card._moxenVolteo = { voltea, atras: () => Math.round(meta / 180) % 2 !== 0 };
    });
  },

  downloadAllFacultyBackup: async function() {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Solo Coordinación Académica puede descargar el respaldo global.");
      return;
    }
    this.showToast("Descargando respaldo completo desde Supabase...", "info");
    const allTeachers = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized)
      ? await SupabaseService.exportAllTeachers()
      : null;

    if (!allTeachers) {
      alert("No se pudo obtener el respaldo global desde Supabase.");
      return;
    }

    const dataStr = JSON.stringify(allTeachers, null, 2);
    const filename = `Respaldo_Facultad_FIUAT_${MathEngine.getLocalDateISO()}.json`;
    await Exporter.saveFileSafe(
      dataStr,
      filename,
      "application/json",
      "Respaldo Global de Profesores (*.json)",
      ".json"
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

    this.renderSwitchTeacherList(this.teachers.filter(t => t.role !== "admin"));

    const modal = document.getElementById("switchTeacherModal");
    if (modal) modal.classList.add("open");
  },

  renderSwitchTeacherList: function(teachers) {
    const list = document.getElementById("switchTeacherList");
    if (!list) return;

    list.innerHTML = teachers.map(t => {
      const isCurrent = this.isSupervising && this.supervisingTeacherId === t.id;
      const coursesCount = (t.coursesCount !== undefined) ? t.coursesCount : ((t.data && t.data.courses) ? t.data.courses.length : 0);
      const studentsCount = (t.studentsCount !== undefined) ? t.studentsCount : ((t.data && t.data.students) ? t.data.students.length : 0);
      const cardAvatar = t.role === "admin"
        ? `<img src="Logos/Escudo Imagotipo.png" alt="UAT" width="38" height="38" decoding="async" />`
        : `<img src="Logos/FI-SOLO-COLOR.png" alt="FI" width="38" height="38" decoding="async" />`;
      const escId = this.escapeHtml(t.id);
      const escNombre = this.escapeHtml(t.nombre);
      const escUsuario = this.escapeHtml(t.usuario);
      return `
        <div class="demo-teacher-card" style="margin-bottom: 0; ${isCurrent ? "border-color: var(--uat-orange); background: var(--bg-hover);" : ""}" data-teacher-id="${escId}" onclick="App.switchTeacher(this.dataset.teacherId)">
          <div class="demo-avatar">${cardAvatar}</div>
          <div style="flex: 1; min-width: 0;">
            <div class="demo-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escNombre} ${isCurrent ? '<span style="color: var(--uat-orange); font-size: 11px;">(Supervisando)</span>' : ""}
            </div>
            <div class="demo-sub">
              ${escUsuario} • ${coursesCount} materias • ${studentsCount} alumnos
            </div>
          </div>
          <button class="btn btn-default btn-sm" style="pointer-events: none;">
            ${isCurrent ? "Activo" : "Supervisar"}
          </button>
        </div>
      `;
    }).join("");
  },

  filterSwitchTeacherList: function(query) {
    const term = (query || "").trim().toLowerCase();
    const filtered = this.teachers.filter(t =>
      t.role !== "admin" && (
        !term ||
        (t.nombre || "").toLowerCase().includes(term) ||
        (t.usuario || "").toLowerCase().includes(term) ||
        (t.departamento && t.departamento.toLowerCase().includes(term))
      )
    );
    this.renderSwitchTeacherList(filtered);
  },

  closeSwitchTeacherModal: function() {
    const modal = document.getElementById("switchTeacherModal");
    if (modal) modal.classList.remove("open");
  },

  switchTeacher: async function(teacherId) {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Solo Coordinación Académica puede supervisar profesores.");
      return;
    }
    this.closeSwitchTeacherModal();
    await this.superviseTeacher(teacherId);
  },

  openRegisterTeacherModal: function() {
    if (!this.isAdmin()) {
      alert("Acceso restringido: Solo Coordinación Académica puede registrar nuevos docentes.");
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
    if (!this.isAdmin()) {
      alert("Acceso restringido: Solo Coordinación Académica puede registrar docentes.");
      return;
    }

    const nombre = document.getElementById("regTeacherNombre")?.value.trim();
    const usuario = document.getElementById("regTeacherUsuario")?.value.trim().toLowerCase();
    const correo = document.getElementById("regTeacherCorreo")?.value.trim().toLowerCase();
    const depto = document.getElementById("regTeacherDepto")?.value.trim() || "Facultad de Ingeniería Tampico";
    const password = document.getElementById("regTeacherPassword")?.value;

    if (!nombre || !usuario || !correo || !password) {
      alert("Por favor completa todos los campos requeridos, incluyendo la contraseña.");
      return;
    }

    if (password.trim().length < 4) {
      alert("La contraseña inicial debe tener al menos 4 caracteres.");
      return;
    }

    if (this.teachers.some(t => (t.usuario || "").toLowerCase() === usuario || (t.correo || "").toLowerCase() === correo)) {
      alert("Ya existe un docente registrado con ese usuario o correo institucional.");
      return;
    }

    const newTeacher = {
      id: "prof-" + usuario.replace(/[^a-z0-9]/g, "") + "-" + Date.now(),
      nombre: nombre,
      usuario: usuario,
      correo: correo,
      password: password.trim(),
      departamento: depto,
      role: "docente",
      avatar: "",
      data: {
        students: [],
        courses: [
          {
            id: "materia-" + Date.now(),
            nombre: "Materia 1",
            grupo: "Grupo A",
            periodo: "2026 - 3 OTOÑO",
            unidadesCount: 5,
            firmasMaxConfig: { u1: 10, u2: 10, u3: 10, u4: 10, u5: 10 },
            records: []
          }
        ]
      }
    };

    const ok = (typeof SupabaseService !== "undefined" && SupabaseService.isInitialized)
      ? await SupabaseService.createTeacher(newTeacher)
      : false;

    if (!ok) {
      alert("Error al registrar docente en Supabase: " + (SupabaseService.lastError || "Verifica tu conexión."));
      return;
    }

    // Refrescar lista ligera desde Supabase
    const summary = await SupabaseService.fetchAdminTeachersSummary();
    if (Array.isArray(summary)) {
      this.teachers = summary.map(t => this.sanitizeTeacher(t));
    }

    ["regTeacherNombre", "regTeacherUsuario", "regTeacherCorreo", "regTeacherPassword", "regTeacherDepto"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    this.closeRegisterTeacherModal();
    this.render();
    this.showToast(`Profesor ${nombre} registrado con éxito en Supabase.`);
  },

  // =========================================================================
  // MÓDULO DE GESTIÓN DE CONTRASEÑA PERSONAL (DOCENTES Y ADMINISTRACIÓN)
  // =========================================================================

  openChangePasswordModal: function(mandatory = false) {
    const dropdown = document.getElementById("teacherDropdown");
    if (dropdown) dropdown.classList.remove("open");

    this._mustChangePasswordModal = !!mandatory;

    const cur = document.getElementById("changePassCurrent");
    const nw = document.getElementById("changePassNew");
    const conf = document.getElementById("changePassConfirm");
    if (cur) cur.value = "";
    if (nw) nw.value = "";
    if (conf) conf.value = "";

    const banner = document.getElementById("forcePasswordChangeBanner");
    const closeBtn = document.getElementById("btnCloseChangePassModal");
    const cancelBtn = document.getElementById("btnCancelChangePassModal");
    if (banner) banner.style.display = this._mustChangePasswordModal ? "block" : "none";
    if (closeBtn) closeBtn.style.display = this._mustChangePasswordModal ? "none" : "";
    if (cancelBtn) cancelBtn.style.display = this._mustChangePasswordModal ? "none" : "";

    const modal = document.getElementById("changePasswordModal");
    if (modal) modal.classList.add("open");
  },

  closeChangePasswordModal: function(force = false) {
    if (this._mustChangePasswordModal && !force) {
      this.showToast("Debes actualizar tu contraseña inicial ('123') para continuar.", "warning");
      return;
    }
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

    if (newPass.length < 6) {
      alert("La nueva contraseña debe contener al menos 6 caracteres.");
      return;
    }

    if (newPass === "123") {
      alert("Por seguridad, debes elegir una contraseña personal distinta a '123'.");
      return;
    }

    if (newPass !== confirmPass) {
      alert("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    if (typeof SupabaseService === "undefined" || !SupabaseService.isInitialized) {
      alert("Se requiere conexión activa con Supabase para actualizar tu contraseña.");
      return;
    }

    this.showToast("Actualizando contraseña cifrada en Supabase...", "info");
    const updatedInCloud = await SupabaseService.updatePassword(currentPass, newPass);

    if (!updatedInCloud) {
      alert(SupabaseService.lastError || "Error al actualizar la contraseña en Supabase. Verifica tu contraseña actual.");
      return;
    }

    // Sincronizar marca de tiempo tras actualizar contraseña en teachers
    if (!this.isSupervising) {
      this._lastServerUpdatedAt = null;
    }

    this._mustChangePasswordModal = false;
    this.mustChangePassword = false;

    ["changePassCurrent", "changePassNew", "changePassConfirm"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    this.closeChangePasswordModal(true);
    this.showToast("¡Tu contraseña ha sido actualizada y cifrada con éxito en Supabase!");
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
    if (userDiv) userDiv.textContent = `Usuario: @${teacher.usuario} • ${teacher.correo || "Sin correo registrado"}`;
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
    this.showToast("Contraseña preestablecida en '123' (el docente deberá cambiarla al entrar). Confirma con tu clave de Admin.");
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

    if (typeof SupabaseService === "undefined" || !SupabaseService.isInitialized) {
      alert("Se requiere conexión activa con Supabase para restablecer contraseñas.");
      return;
    }

    const teacher = this.teachers.find(t => t.id === teacherId);
    const teacherName = teacher ? teacher.nombre : "del docente";

    this.showToast("Validando credenciales de administrador y actualizando contraseña...", "info");
    const saved = await SupabaseService.adminResetTeacherPassword(adminPass, teacherId, newPass);

    if (!saved) {
      alert("Error al restablecer contraseña: " + (SupabaseService.lastError || "Credenciales de administrador incorrectas."));
      return;
    }

    this.closeAdminManageTeacherModal();
    this.showToast(`¡Contraseña de ${teacherName} restablecida y cifrada exitosamente!`);
  }
});
