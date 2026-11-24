// attendance_importer.js - Módulo de importación inteligente de asistencias desde Excel (.xlsx, .xls, .csv)

Object.assign(App, {
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
      mode: 'multi_unit',
      unitRanges: {},
      rawRows: [],
      headerRowIndex: -1,
      detectedColumns: null,
      matches: []
    };

    const modeSelect = document.getElementById("excelImportModeSelect");
    if (modeSelect) modeSelect.value = "multi_unit";

    const targetUnitContainer = document.getElementById("excelImportTargetUnitContainer");
    if (targetUnitContainer) targetUnitContainer.style.display = "none";

    const delimContainer = document.getElementById("excelImportUnitDelimitationContainer");
    if (delimContainer) delimContainer.style.display = "none";

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

  onExcelImportModeChanged: function(mode) {
    if (!this._excelAttendanceState) return;
    this._excelAttendanceState.mode = mode;
    const targetUnitContainer = document.getElementById("excelImportTargetUnitContainer");
    const delimContainer = document.getElementById("excelImportUnitDelimitationContainer");
    const dateColumns = (this._excelAttendanceState.detectedColumns && this._excelAttendanceState.detectedColumns.dateColumns)
      ? this._excelAttendanceState.detectedColumns.dateColumns
      : [];

    if (mode === "single_unit") {
      if (targetUnitContainer) targetUnitContainer.style.display = "block";
      if (delimContainer) delimContainer.style.display = "none";
    } else {
      if (targetUnitContainer) targetUnitContainer.style.display = "none";
      if (delimContainer) {
        delimContainer.style.display = (dateColumns.length > 0) ? "block" : "none";
        this.renderExcelUnitRangesInputs();
      }
    }
    this.analyzeCurrentExcelSheet();
  },

  autoDistributeExcelDatesEvenly: function() {
    const state = this._excelAttendanceState;
    if (!state || !state.detectedColumns) return;
    const dateColumns = state.detectedColumns.dateColumns || [];
    if (dateColumns.length === 0) return;

    const course = this.getActiveCourse();
    const numUnits = Math.max(1, Number(course ? course.unidadesCount : 3) || 3);
    const totalDates = dateColumns.length;

    const baseCount = Math.floor(totalDates / numUnits);
    const remainder = totalDates % numUnits;

    state.unitRanges = {};
    let currStart = 0;
    for (let u = 1; u <= numUnits; u++) {
      const count = baseCount + (u <= remainder ? 1 : 0);
      const startIdx = currStart;
      const endIdx = Math.min(totalDates - 1, currStart + Math.max(0, count - 1));
      state.unitRanges[u] = {
        startIdx: startIdx,
        endIdx: endIdx
      };
      currStart += count;
    }

    this.renderExcelUnitRangesInputs();
    this.analyzeCurrentExcelSheet();
  },

  renderExcelUnitRangesInputs: function() {
    const state = this._excelAttendanceState;
    if (!state || !state.detectedColumns) return;
    const dateColumns = state.detectedColumns.dateColumns || [];
    const container = document.getElementById("excelImportUnitRangesRows");
    const totalBadge = document.getElementById("excelImportDatesTotalBadge");
    if (!container) return;

    if (totalBadge) {
      totalBadge.textContent = `(${dateColumns.length} fechas detectadas)`;
    }

    if (dateColumns.length === 0) {
      container.innerHTML = `<span style="font-size: 11.5px; color: var(--text-tertiary);">No se detectaron columnas con formato de fecha en esta hoja.</span>`;
      return;
    }

    const course = this.getActiveCourse();
    const numUnits = Math.max(1, Number(course ? course.unidadesCount : 3) || 3);

    if (!state.unitRanges || Object.keys(state.unitRanges).length === 0) {
      let matchedAny = false;
      const cDates = (course && course.unitDates) ? course.unitDates : {};
      const newRanges = {};

      for (let u = 1; u <= numUnits; u++) {
        const uCfg = cDates[`u${u}`];
        if (uCfg && uCfg.inicio && uCfg.fin) {
          let sIdx = -1;
          let eIdx = -1;
          dateColumns.forEach((dc, idx) => {
            if (dc.label >= uCfg.inicio && dc.label <= uCfg.fin) {
              if (sIdx === -1) sIdx = idx;
              eIdx = idx;
            }
          });
          if (sIdx !== -1 && eIdx !== -1) {
            newRanges[u] = { startIdx: sIdx, endIdx: eIdx };
            matchedAny = true;
          }
        }
      }

      if (matchedAny) {
        state.unitRanges = newRanges;
      } else {
        const baseCount = Math.floor(dateColumns.length / numUnits);
        const remainder = dateColumns.length % numUnits;
        let cStart = 0;
        state.unitRanges = {};
        for (let u = 1; u <= numUnits; u++) {
          const count = baseCount + (u <= remainder ? 1 : 0);
          state.unitRanges[u] = {
            startIdx: cStart,
            endIdx: Math.min(dateColumns.length - 1, cStart + Math.max(0, count - 1))
          };
          cStart += count;
        }
      }
    }

    let html = "";
    for (let u = 1; u <= numUnits; u++) {
      const range = state.unitRanges[u] || { startIdx: 0, endIdx: 0 };
      const count = Math.max(0, range.endIdx - range.startIdx + 1);

      const startOptions = dateColumns.map((dc, idx) =>
        `<option value="${idx}" ${idx === range.startIdx ? 'selected' : ''}>${this.escapeHtml(dc.label)} (Col ${dc.colIdx + 1})</option>`
      ).join('');

      const endOptions = dateColumns.map((dc, idx) =>
        `<option value="${idx}" ${idx === range.endIdx ? 'selected' : ''}>${this.escapeHtml(dc.label)} (Col ${dc.colIdx + 1})</option>`
      ).join('');

      html += `
        <div class="excel-range-unit-card">
          <div style="font-weight: 800; font-size: 12.5px; color: var(--uat-blue-night);">
            Unidad ${u}:
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 11px; color: var(--text-tertiary); font-weight: 600;">Desde:</span>
            <select class="form-control" style="font-size: 11.5px; padding: 3px 6px; height: 28px;" onchange="App.onExcelUnitRangeChanged(${u}, true, this.value)">
              ${startOptions}
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 11px; color: var(--text-tertiary); font-weight: 600;">Hasta:</span>
            <select class="form-control" style="font-size: 11.5px; padding: 3px 6px; height: 28px;" onchange="App.onExcelUnitRangeChanged(${u}, false, this.value)">
              ${endOptions}
            </select>
          </div>
          <div>
            <span id="excelUnitRangeBadge_${u}" class="status-badge status-aprobado" style="font-size: 11px; font-weight: 700;">
              ${count} fechas
            </span>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  },

  onExcelUnitRangeChanged: function(unitIdx, isStart, val) {
    const state = this._excelAttendanceState;
    if (!state || !state.unitRanges) return;
    const numVal = parseInt(val, 10) || 0;
    if (!state.unitRanges[unitIdx]) {
      state.unitRanges[unitIdx] = { startIdx: 0, endIdx: 0 };
    }
    if (isStart) {
      state.unitRanges[unitIdx].startIdx = numVal;
      if (state.unitRanges[unitIdx].endIdx < numVal) {
        state.unitRanges[unitIdx].endIdx = numVal;
      }
    } else {
      state.unitRanges[unitIdx].endIdx = numVal;
      if (state.unitRanges[unitIdx].startIdx > numVal) {
        state.unitRanges[unitIdx].startIdx = numVal;
      }
    }
    this.renderExcelUnitRangesInputs();
    this.analyzeCurrentExcelSheet();
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
    const courseTokens = course && (course.nombre || course.name) ? this._getNameTokens(course.nombre || course.name) : [];
    const groupClean = course && (course.grupo || course.group) ? this._cleanMatchText(course.grupo || course.group) : "";

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
    let maxHeaderScore = -1;

    for (let r = 0; r < Math.min(25, rawRows.length); r++) {
      const row = rawRows[r] || [];
      let score = 0;
      let hasMat = false;
      let hasNom = false;
      let isMetadataOrLegend = false;

      row.forEach(cell => {
        const str = String(cell || "").trim();
        if (!str) return;
        const txt = this._cleanMatchText(str);
        if (!txt) return;

        // Descartar si es un bloque de leyenda, título o metadatos de la materia
        if (str.length > 45 || /^materia\s*:|^periodo\s*:|^leyenda\s*:|^lista de asistencia/i.test(str)) {
          isMetadataOrLegend = true;
          return;
        }

        if (/matr|clave|control|cuenta|id|no\s*cuenta/.test(txt) && !/grupo|materia|prof/.test(txt)) {
          score += 25;
          hasMat = true;
        }
        if (/nom|alum|estud/.test(txt) && !/docente|profesor|materia/.test(txt)) {
          score += 25;
          hasNom = true;
        }
        if (/asis|presente/.test(txt)) score += 5;
        if (/falt|inasist|ausenc/.test(txt)) score += 5;
        if (/ret|retard/.test(txt)) score += 3;
        if (/just|justif/.test(txt)) score += 3;
        if (/%\s*asis|pct|porcentaje/.test(txt)) score += 4;
        if (/^u\d|unidad/.test(txt)) score += 3;
        if (/\d{1,2}[/-]\d{1,2}|clase|sesion/.test(txt)) score += 3;
      });

      if (hasMat && hasNom && !isMetadataOrLegend) {
        score += 60;
      } else if (isMetadataOrLegend) {
        score = -10;
      }

      if (score > maxHeaderScore) {
        maxHeaderScore = score;
        headerRowIdx = r;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 0;
    state.headerRowIndex = headerRowIdx;

    const headers = rawRows[headerRowIdx] || [];
    const nextRow = rawRows[headerRowIdx + 1] || [];

    let colMatricula = -1;
    let colNombre = -1;
    let colFaltas = -1;
    let colAsist = -1;
    let colPct = -1;
    let colRetardos = -1;
    let colJustif = -1;
    const dateColumns = [];

    const monthMap = {
      "agosto": "08", "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12",
      "enero": "01", "febrero": "02", "marzo": "03", "abril": "04", "mayo": "05", "junio": "06", "julio": "07"
    };

    headers.forEach((cell, cIdx) => {
      const hText = this._cleanMatchText(cell);
      if (!hText) return;

      if (colMatricula === -1 && /matr|clave|control|cuenta|id|no\s*cuenta/.test(hText) && !/grupo|materia|prof/.test(hText)) {
        colMatricula = cIdx;
      } else if (colNombre === -1 && /nom|alum|estud/.test(hText) && !/docente|profesor|materia/.test(hText)) {
        colNombre = cIdx;
      } else if (colPct === -1 && (/^pct|%\s*asis|porcentaje/.test(hText) || hText === "% asis" || hText === "asis")) {
        colPct = cIdx;
      } else if (colFaltas === -1 && (/total\s*f|falt|inasist|ausenc/.test(hText) || hText === "falt") && !/fecha|dia/.test(hText)) {
        colFaltas = cIdx;
      } else if (colAsist === -1 && (/total\s*a|total\s*p|asis|presentes?/.test(hText) || hText === "asis") && !/fecha|dia/.test(hText)) {
        colAsist = cIdx;
      } else if (colRetardos === -1 && (/ret|retard/.test(hText) || hText === "ret")) {
        colRetardos = cIdx;
      } else if (colJustif === -1 && (/just|justif/.test(hText) || hText === "just")) {
        colJustif = cIdx;
      }
    });

    // 1. Método Estándar: Detección de fechas directas en la fila de encabezados
    headers.forEach((cell, cIdx) => {
      if (cIdx === colMatricula || cIdx === colNombre || cIdx === colFaltas || cIdx === colAsist || cIdx === colPct || cIdx === colRetardos || cIdx === colJustif) return;
      const hText = this._cleanMatchText(cell);
      if (/\d{1,2}[/-]\d{1,2}|\d{1,2}-[a-z]{3}|clase\s*\d+|sesi[oó]n\s*\d+|dia\s*\d+/.test(hText) || (typeof cell === 'number' && cell > 44000)) {
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

    // 2. Método Institucional UAT: Mes en fila superior y día numérico en la fila siguiente
    if (dateColumns.length === 0 && nextRow && nextRow.length > 0) {
      let activeMonth = "";
      const maxCol = Math.max(headers.length, nextRow.length);
      for (let c = 0; c < maxCol; c++) {
        if (c === colMatricula || c === colNombre || c === colFaltas || c === colAsist || c === colPct || c === colRetardos || c === colJustif) continue;

        const hVal = String(headers[c] || "").trim().toLowerCase();
        for (const mKey of Object.keys(monthMap)) {
          if (hVal.includes(mKey)) {
            activeMonth = mKey;
            break;
          }
        }

        const nextCellVal = String(nextRow[c] || "").trim();
        if (/^\d{1,2}$/.test(nextCellVal)) {
          const dayNum = parseInt(nextCellVal, 10);
          if (dayNum >= 1 && dayNum <= 31) {
            const mCode = monthMap[activeMonth] || "";
            const dStr = String(dayNum).padStart(2, "0");
            let label = mCode ? `2026-${mCode}-${dStr}` : `Día ${dStr}`;
            dateColumns.push({ colIdx: c, label: label });
          }
        }
      }
    }

    const sampleRows = rawRows.slice(headerRowIdx + 1, headerRowIdx + 40);

    // Fallback matricula y nombre
    if (colMatricula === -1) {
      for (let c = 0; c < 15; c++) {
        let numericIds = 0;
        sampleRows.forEach(r => {
          const v = String(r[c] || "").trim();
          if (/^\d{7,11}$/.test(v)) numericIds++;
        });
        if (numericIds >= Math.min(3, sampleRows.length)) {
          colMatricula = c;
          break;
        }
      }
    }

    if (colNombre === -1) {
      for (let c = 0; c < 15; c++) {
        if (c === colMatricula) continue;
        let nameLike = 0;
        sampleRows.forEach(r => {
          const v = String(r[c] || "").trim();
          if (v.length > 5 && v.includes(" ") && !/\d{5}/.test(v) && !/^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)$/i.test(v)) nameLike++;
        });
        if (nameLike >= Math.min(3, sampleRows.length)) {
          colNombre = c;
          break;
        }
      }
    }

    // Fallback: Si todavía no hay dateColumns, buscar columnas con marcas de asistencia
    if (dateColumns.length === 0) {
      const maxCol = Math.max(headers.length, (rawRows[headerRowIdx + 3] || []).length);
      for (let c = 0; c < maxCol; c++) {
        if (c === colMatricula || c === colNombre || c === colFaltas || c === colAsist || c === colPct || c === colRetardos || c === colJustif) continue;
        let attendanceMarks = 0;
        sampleRows.forEach(r => {
          const val = String(r[c] || "").trim().toUpperCase();
          if (/^[AFPRJ10✓✗]$/.test(val)) attendanceMarks++;
        });
        if (attendanceMarks >= 2) {
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
    const numUnits = Math.max(1, Number(course ? course.unidadesCount : 3) || 3);

    const modeContainer = document.getElementById("excelImportModeContainer");
    const targetUnitContainer = document.getElementById("excelImportTargetUnitContainer");
    const delimContainer = document.getElementById("excelImportUnitDelimitationContainer");

    if (dateColumns.length > 0) {
      if (modeContainer) modeContainer.style.display = "block";
      if (!state.unitRanges || Object.keys(state.unitRanges).length === 0) {
        this.autoDistributeExcelDatesEvenly();
      }
      if (state.mode === "multi_unit") {
        if (targetUnitContainer) targetUnitContainer.style.display = "none";
        if (delimContainer) {
          delimContainer.style.display = "block";
          this.renderExcelUnitRangesInputs();
        }
      } else {
        if (targetUnitContainer) targetUnitContainer.style.display = "block";
        if (delimContainer) delimContainer.style.display = "none";
      }
    } else {
      state.mode = "single_unit";
      if (modeContainer) modeContainer.style.display = "none";
      if (targetUnitContainer) targetUnitContainer.style.display = "block";
      if (delimContainer) delimContainer.style.display = "none";
    }

    const excelRowsData = [];
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const rawMat = colMatricula !== -1 ? String(row[colMatricula] || "").trim() : "";
      const cleanMat = rawMat.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
      const rawName = colNombre !== -1 ? String(row[colNombre] || "").trim() : "";
      const nameTokens = this._getNameTokens(rawName);

      // Descartar filas de sub-encabezados (números de día o días de la semana)
      if (rawName && /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)$/i.test(rawName)) continue;
      if (!cleanMat && nameTokens.length < 2) continue;

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
        const unitStats = {};

        if (dateColumns.length > 0) {
          let pCnt = 0, fCnt = 0, rCnt = 0, jCnt = 0;
          dateColumns.forEach((col, dIdx) => {
            const rawVal = String(row[col.colIdx] || "").trim().toUpperCase();
            let mark = "";
            if (rawVal === "A" || rawVal === "P" || rawVal === "1" || rawVal === "✓") {
              mark = "P";
              pCnt++;
            } else if (rawVal === "F" || rawVal === "0" || rawVal === "✗") {
              mark = "F";
              fCnt++;
            } else if (rawVal === "R") {
              mark = "R";
              rCnt++;
            } else if (rawVal === "J") {
              mark = "J";
              jCnt++;
            }
            sessionsData[`date_${dIdx}`] = { mark: mark, label: col.label };
          });

          const totalClases = pCnt + fCnt + rCnt + jCnt;
          detectedF = fCnt + Math.floor(rCnt / 2);
          detectedPct = totalClases > 0 ? Math.round(((pCnt + (rCnt * 0.5) + jCnt) / totalClases) * 100) : 100;

          // Si el alumno no tuvo marcas de clase individuales pero el Excel tiene columnas de totales (ASIS/FALT)
          if (totalClases === 0 && (colFaltas !== -1 || colPct !== -1 || colAsist !== -1)) {
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
            }
          }

          // Estadísticas independientes por unidad según delimitación
          for (let u = 1; u <= numUnits; u++) {
            const range = (state.unitRanges && state.unitRanges[u]) ? state.unitRanges[u] : { startIdx: -1, endIdx: -1 };
            let uP = 0, uF = 0, uR = 0, uJ = 0;
            if (range.startIdx !== -1 && range.endIdx !== -1 && range.startIdx <= range.endIdx) {
              for (let d = range.startIdx; d <= range.endIdx; d++) {
                if (d < dateColumns.length) {
                  const m = sessionsData[`date_${d}`] ? sessionsData[`date_${d}`].mark : "";
                  if (m === "P") uP++;
                  else if (m === "F") uF++;
                  else if (m === "R") uR++;
                  else if (m === "J") uJ++;
                }
              }
            }
            const uTot = uP + uF + uR + uJ;
            const uFaltas = uF + Math.floor(uR / 2);
            const uPct = uTot > 0 ? Math.min(100, Math.max(0, Math.round(((uP + (uR * 0.5) + uJ) / uTot) * 100))) : 100;
            unitStats[u] = { faltas: uFaltas, pct: uPct, totalClases: uTot };
          }
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
          unitStats: unitStats,
          sessionsData: sessionsData,
          status: "ok"
        });
      } else {
        const uKey = `u${state.targetUnit || 1}`;
        const currF = (rec.faltas && rec.faltas[uKey] !== undefined) ? rec.faltas[uKey] : "-";
        const currA = (rec.asistencia && rec.asistencia[uKey] !== undefined) ? rec.asistencia[uKey] : "-";
        const emptyUnitStats = {};
        for (let u = 1; u <= numUnits; u++) {
          emptyUnitStats[u] = {
            faltas: (rec.faltas && rec.faltas[`u${u}`] !== undefined) ? Number(rec.faltas[`u${u}`]) : 0,
            pct: (rec.asistencia && rec.asistencia[`u${u}`] !== undefined) ? Number(rec.asistencia[`u${u}`]) : 100,
            totalClases: 0
          };
        }
        matches.push({
          recIndex: recIdx,
          matricula: rec.matricula,
          nombre: student.nombre,
          matchType: "none",
          matchLabel: "No localizado en Excel",
          faltas: currF,
          asistenciaPct: currA,
          unitStats: emptyUnitStats,
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

    const isMultiUnit = (state.mode === "multi_unit" && dateColumns.length > 0);
    const previewContainer = document.getElementById("excelImportPreviewContainer");
    const previewTbody = document.getElementById("excelImportPreviewTbody");
    const matchBadge = document.getElementById("excelImportMatchCountBadge");

    if (previewContainer && previewTbody) {
      previewContainer.style.display = "block";
      if (matchBadge) {
        matchBadge.textContent = `${matchCount} / ${records.length} Vinculados`;
        matchBadge.className = matchCount > 0 ? "status-badge status-aprobado" : "status-badge status-reprobado";
      }

      const previewThead = previewContainer.querySelector("table thead");
      if (previewThead) {
        previewThead.innerHTML = `
          <tr style="background: var(--bg-hover); position: sticky; top: 0; z-index: 2;">
            <th style="padding: 6px 8px; width: 34px; text-align: center;">#</th>
            <th style="padding: 6px 8px;">Alumno en la Materia</th>
            <th style="padding: 6px 8px; width: 130px;">Vinculado Por</th>
            <th style="padding: 6px 8px; width: ${isMultiUnit ? '140px' : '70px'}; text-align: center;">${isMultiUnit ? 'Faltas / Unidad' : 'Faltas'}</th>
            <th style="padding: 6px 8px; width: ${isMultiUnit ? '160px' : '80px'}; text-align: center;">${isMultiUnit ? '% Asist. / Unidad' : '% Asist.'}</th>
            <th style="padding: 6px 8px; width: 95px; text-align: center;">Estado</th>
          </tr>
        `;
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
        let faltasCell = "";
        let pctCell = "";

        if (isMultiUnit) {
          const fArr = [];
          const pArr = [];
          for (let u = 1; u <= numUnits; u++) {
            const st = item.unitStats && item.unitStats[u];
            const fVal = st ? st.faltas : 0;
            const pVal = st ? st.pct : 100;
            fArr.push(`U${u}: <b style="${fVal > 0 ? 'color: var(--color-red);' : ''}">${fVal}</b>`);
            pArr.push(`U${u}: <b style="color: var(--uat-orange);">${pVal}%</b>`);
          }
          faltasCell = `<div style="font-size: 11px;">${fArr.join(" • ")}</div>`;
          pctCell = `<div style="font-size: 11px;">${pArr.join(" • ")}</div>`;
        } else {
          faltasCell = `<span style="font-weight: 700; ${isOk && item.faltas > 0 ? 'color: var(--color-red);' : ''}">${item.faltas !== undefined ? item.faltas : '-'}</span>`;
          pctCell = `<span style="font-weight: 700; ${isOk ? 'color: var(--uat-orange);' : ''}">${item.asistenciaPct !== undefined ? item.asistenciaPct + '%' : '-'}</span>`;
        }

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
            <td style="text-align: center;">
              ${faltasCell}
            </td>
            <td style="text-align: center;">
              ${pctCell}
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
      if (isMultiUnit) {
        btnApply.innerHTML = `⚡ Aplicar Asistencias a las ${numUnits} Unidades (${matchCount} alumnos)`;
      } else {
        btnApply.innerHTML = `⚡ Aplicar Asistencias a Unidad ${state.targetUnit || 1} (${matchCount} alumnos)`;
      }
    }

    const summaryFooter = document.getElementById("excelImportFooterSummary");
    if (summaryFooter) {
      if (isMultiUnit) {
        summaryFooter.textContent = matchCount > 0
          ? `${matchCount} alumnos listos para sincronizar a las ${numUnits} unidades.`
          : "Revisa que el archivo contenga nombres o matrículas de este grupo.";
      } else {
        summaryFooter.textContent = matchCount > 0
          ? `${matchCount} alumnos listos para sincronizar a la Unidad ${state.targetUnit || 1}.`
          : "Revisa que el archivo contenga nombres o matrículas de este grupo.";
      }
    }
  },

  applyExcelAttendanceImport: function() {
    const state = this._excelAttendanceState;
    if (!state || !state.matches || state.matches.length === 0) return;

    const course = this.getActiveCourse();
    if (!course) return;

    const numUnits = Math.max(1, Number(course.unidadesCount) || 3);
    const syncSessions = document.getElementById("excelImportSyncSessionsCheckbox")?.checked;
    const dateColumns = state.detectedColumns ? state.detectedColumns.dateColumns : [];
    const isMultiUnit = (state.mode === "multi_unit" && dateColumns.length > 0);

    let appliedCount = 0;

    if (isMultiUnit) {
      if (!course.attendanceSessions) course.attendanceSessions = [];

      // Mapear cada columna de fecha a su unidad según state.unitRanges
      const dateToUnitMap = {};
      for (let u = 1; u <= numUnits; u++) {
        const range = (state.unitRanges && state.unitRanges[u]) ? state.unitRanges[u] : { startIdx: -1, endIdx: -1 };
        if (range.startIdx !== -1 && range.endIdx !== -1 && range.startIdx <= range.endIdx) {
          for (let d = range.startIdx; d <= range.endIdx; d++) {
            if (d < dateColumns.length) {
              dateToUnitMap[d] = u;
            }
          }
        }
      }

      // Si syncSessions está activo, crear o reutilizar las sesiones para cada unidad
      if (syncSessions) {
        const createdSessionIds = [];
        dateColumns.forEach((dCol, dIdx) => {
          const assignedUnit = dateToUnitMap[dIdx] || 1;
          let fechaStr = MathEngine.getLocalDateISO();
          if (/^\d{4}-\d{2}-\d{2}$/.test(dCol.label)) fechaStr = dCol.label;

          // Buscar sesión existente por fecha exacta o por tema/etiqueta
          let existingSess = course.attendanceSessions.find(s => s.fecha === fechaStr || s.tema === dCol.label);
          if (!existingSess) {
            const sessId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + dIdx;
            existingSess = {
              id: sessId,
              unidad: assignedUnit,
              fecha: fechaStr,
              tema: dCol.label
            };
            course.attendanceSessions.push(existingSess);
          } else {
            existingSess.unidad = assignedUnit;
            if (!existingSess.fecha) existingSess.fecha = fechaStr;
          }
          createdSessionIds.push({ dIdx: dIdx, id: existingSess.id, unit: assignedUnit, fecha: fechaStr });
        });

        // Remover sesiones fantasma sin marcas que no están en el Excel (ej. viernes inhábil)
        const excelDates = new Set(createdSessionIds.map(cs => cs.fecha));
        course.attendanceSessions = course.attendanceSessions.filter(s => {
          if (excelDates.has(s.fecha)) return true;
          return (course.records || []).some(r => r.attendanceDays && r.attendanceDays[s.id]);
        });

        // Deduplicar sesiones
        this.deduplicateCourseAttendanceSessions(course);

        // Guardar marcas P, F, R, J de cada alumno
        state.matches.forEach(item => {
          if (item.status !== "ok") return;
          const rec = course.records[item.recIndex];
          if (!rec) return;
          if (!rec.attendanceDays) rec.attendanceDays = {};

          createdSessionIds.forEach(sessInfo => {
            const sessKey = `date_${sessInfo.dIdx}`;
            const sData = (item.sessionsData && item.sessionsData[sessKey]);
            const markVal = sData ? sData.mark : "";
            if (markVal) {
              rec.attendanceDays[sessInfo.id] = markVal;
            } else {
              delete rec.attendanceDays[sessInfo.id];
            }
          });
        });
      }

      // Asignar faltas y porcentajes calculados para cada una de las unidades
      state.matches.forEach(item => {
        if (item.status !== "ok") return;
        const rec = course.records[item.recIndex];
        if (!rec) return;

        if (!rec.faltas) rec.faltas = {};
        if (!rec.asistencia) rec.asistencia = {};
        if (!rec.asistenciaAuto) rec.asistenciaAuto = {};

        for (let u = 1; u <= numUnits; u++) {
          const uKey = `u${u}`;
          const uStats = (item.unitStats && item.unitStats[u]) ? item.unitStats[u] : null;
          if (uStats) {
            rec.faltas[uKey] = uStats.faltas;
            rec.asistencia[uKey] = uStats.pct;
            rec.asistenciaAuto[uKey] = true;
          }
        }
        appliedCount++;
      });

      // Recalcular métricas de cada unidad
      for (let u = 1; u <= numUnits; u++) {
        this.recalculateAttendanceForUnit(course, u);
      }

      this.saveData();
      this.closeExcelAttendanceImportModal();
      this.render();
      this.showToast(`🎉 ¡Asistencias y porcentajes calculados y asignados exitosamente a las ${numUnits} unidades para ${appliedCount} alumnos!`);
      return;
    }

    // Modo Unidad Única (single_unit)
    const targetUnit = state.targetUnit || 1;
    const uKey = `u${targetUnit}`;

    if (syncSessions && dateColumns.length > 0) {
      if (!course.attendanceSessions) course.attendanceSessions = [];

      const createdSessionIds = [];
      dateColumns.forEach((dCol, dIdx) => {
        let fechaStr = MathEngine.getLocalDateISO();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dCol.label)) fechaStr = dCol.label;

        let existingSess = course.attendanceSessions.find(s => s.fecha === fechaStr || s.tema === dCol.label);
        if (!existingSess) {
          const sessId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + dIdx;
          existingSess = {
            id: sessId,
            unidad: targetUnit,
            fecha: fechaStr,
            tema: dCol.label
          };
          course.attendanceSessions.push(existingSess);
        } else {
          existingSess.unidad = targetUnit;
          if (!existingSess.fecha) existingSess.fecha = fechaStr;
        }
        createdSessionIds.push({ dIdx: dIdx, id: existingSess.id, fecha: fechaStr });
      });

      const excelDates = new Set(createdSessionIds.map(cs => cs.fecha));
      course.attendanceSessions = course.attendanceSessions.filter(s => {
        if (s.unidad !== targetUnit) return true;
        if (excelDates.has(s.fecha)) return true;
        return (course.records || []).some(r => r.attendanceDays && r.attendanceDays[s.id]);
      });

      this.deduplicateCourseAttendanceSessions(course);

      state.matches.forEach(item => {
        if (item.status !== "ok") return;
        const rec = course.records[item.recIndex];
        if (!rec) return;

        if (!rec.attendanceDays) rec.attendanceDays = {};
        createdSessionIds.forEach(sessInfo => {
          const sessKey = `date_${sessInfo.dIdx}`;
          const sData = (item.sessionsData && item.sessionsData[sessKey]);
          const markVal = sData ? sData.mark : "";
          if (markVal) {
            rec.attendanceDays[sessInfo.id] = markVal;
          } else {
            delete rec.attendanceDays[sessInfo.id];
          }
        });
      });
    }

    state.matches.forEach(item => {
      if (item.status !== "ok") return;
      const rec = course.records[item.recIndex];
      if (!rec) return;

      if (!rec.faltas) rec.faltas = {};
      if (!rec.asistencia) rec.asistencia = {};
      if (!rec.asistenciaAuto) rec.asistenciaAuto = {};

      rec.faltas[uKey] = item.faltas;
      rec.asistencia[uKey] = item.asistenciaPct;
      rec.asistenciaAuto[uKey] = true;
      appliedCount++;
    });

    this.recalculateAttendanceForUnit(course, targetUnit);
    this.saveData();
    this.closeExcelAttendanceImportModal();
    this.render();
    this.showToast(`📥 ¡Éxito! Se actualizaron las faltas y asistencias de ${appliedCount} alumnos en la Unidad ${targetUnit}.`);
  },

});
