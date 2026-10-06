// exporter.js - Exportación para Teams, Excel (.xlsx), PDF y Portal de Consulta Alumno

const Exporter = {
  // Exportar a Excel utilizando SheetJS si está disponible, o fallback HTML/CSV
  exportToExcel: function(course, studentsMap, mode = 'docente', options = {}) {
    const records = course.records || [];
    const maxFirmas = course.firmasMaxConfig || {};
    
    // Preparar encabezados y filas
    let headers = [];
    let rows = [];

    const numUnits = Number(course.unidadesCount) || 5;
    const unitIndices = Array.from({ length: numUnits }, (_, i) => i + 1);

    if (mode === 'teams') {
      // Modo Publicación para Alumnos en Teams
      const includeNames = options.includeNames !== false;
      const evalHeaders = unitIndices.map(u => `Eval U${u}`);
      headers = includeNames 
        ? ["Matrícula", "Nombre del Alumno", ...evalHeaders, "Proyecto Final", "Puntos Extra", "Calificación Final", "Estatus"]
        : ["Matrícula (ID)", ...evalHeaders, "Proyecto Final", "Puntos Extra", "Calificación Final", "Estatus"];

      rows = records.map(rec => {
        const student = studentsMap[rec.matricula] || { nombre: "NO REGISTRADO" };
        const calcs = App.calculateStudentGrades(rec, course);
        const estatus = calcs.hasEvaluations 
          ? (calcs.evalFinal >= 70 ? "APROBADO" : "NO APROBADO") 
          : "PENDIENTE";
        const getEval = (u) => (calcs.evalU[u] !== null && calcs.evalU[u] !== undefined) ? calcs.evalU[u] : "-";
        const evalVals = unitIndices.map(u => getEval(u));

        const baseRow = includeNames ? [rec.matricula, student.nombre] : [rec.matricula];
        return [
          ...baseRow,
          ...evalVals,
          rec.proyecto !== null && rec.proyecto !== undefined ? rec.proyecto : "-",
          rec.puntosExtra || 0,
          calcs.hasEvaluations ? calcs.evalFinal : "-",
          estatus
        ];
      });
    } else {
      // Modo Docente Completo
      const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
      const showAsist = Number(weights.asistencia) > 0;
      const showPart = Number(weights.participacion) > 0;

      const firmasHeaders = unitIndices.map(u => `Firmas U${u}`);
      const examenesHeaders = unitIndices.map(u => `Examen U${u}`);
      const asistHeaders = showAsist ? unitIndices.map(u => `Asist U${u} (${weights.asistencia}%)`) : [];
      const partHeaders = showPart ? unitIndices.map(u => `Part U${u} (${weights.participacion}%)`) : [];
      const evalHeaders = unitIndices.map(u => `Eval U${u}`);

      headers = [
        "Matrícula", "Nombre Completo (Rollup)", "Calificación Final", "Estatus",
        ...firmasHeaders,
        ...examenesHeaders,
        ...asistHeaders,
        ...partHeaders,
        ...evalHeaders,
        "Proyecto Final", "Puntos Extra (+5 c/u)"
      ];

      rows = records.map(rec => {
        const student = studentsMap[rec.matricula] || { nombre: "NO REGISTRADO" };
        const calcs = App.calculateStudentGrades(rec, course);
        const estatus = calcs.hasEvaluations 
          ? (calcs.evalFinal >= 70 ? "APROBADO" : "NO APROBADO") 
          : "PENDIENTE";
        const getEval = (u) => {
          if (calcs.isSinDerechoU && calcs.isSinDerechoU[u]) return "SD";
          return (calcs.evalU[u] !== null && calcs.evalU[u] !== undefined) ? calcs.evalU[u] : "";
        };

        const f = rec.firmas || {};
        const e = rec.examenes || {};
        const a = rec.asistencia || {};
        const p = rec.participacion || {};

        const firmasVals = unitIndices.map(u => f[`u${u}`] ?? "");
        const examenesVals = unitIndices.map(u => e[`u${u}`] ?? "");
        const asistVals = showAsist ? unitIndices.map(u => (a[`u${u}`] !== undefined && a[`u${u}`] !== "") ? `${a[`u${u}`]}%` : "") : [];
        const partVals = showPart ? unitIndices.map(u => p[`u${u}`] ?? "") : [];
        const evalVals = unitIndices.map(u => getEval(u));

        return [
          rec.matricula,
          student.nombre,
          calcs.hasEvaluations ? calcs.evalFinal : "-",
          estatus,
          ...firmasVals,
          ...examenesVals,
          ...asistVals,
          ...partVals,
          ...evalVals,
          rec.proyecto ?? "",
          rec.puntosExtra || 0
        ];
      });
    }

    const grupoSuffix = course.grupo ? `_${course.grupo.replace(/\s+/g, '_')}` : '';
    const filename = `FIUAT_${course.nombre.replace(/\s+/g, '_')}${grupoSuffix}_${course.periodo}_${mode === 'teams' ? 'TEAMS_PUBLICACION' : 'CONTROL_DOCENTE'}.xlsx`;

    // Sanitización contra inyección de fórmulas en Excel (CWE-1236 - SEC-07)
    const sanitizedRows = rows.map(r => r.map(cell => Exporter.sanitizeForSpreadsheet(cell)));

    // Si la librería SheetJS (XLSX) está presente
    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...sanitizedRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Anchos de columna optimizados
      ws['!cols'] = headers.map((h, i) => {
        if (i === 0) return { wch: 15 };
        if (i === 1 && (mode !== 'teams' || options.includeNames !== false)) return { wch: 35 };
        return { wch: 12 };
      });

      // Añadir la hoja al libro
      XLSX.utils.book_append_sheet(wb, ws, "FIUAT Calificaciones");
      const u8 = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      // Guardado garantizado con extensión .xlsx (evita que el navegador use un UUID en file://)
      Exporter.saveFileSafe(
        u8, 
        filename, 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Libro de Excel (*.xlsx)',
        '.xlsx'
      );
    } else {
      // Fallback a CSV compatible con Excel
      Exporter.exportToCSV(headers, sanitizedRows, filename.replace('.xlsx', '.csv'));
    }
  },

  // Sanitización de celdas contra inyección de fórmulas CSV/Excel (CWE-1236 - SEC-07)
  sanitizeForSpreadsheet: function(val) {
    if (val === null || val === undefined) return "";
    if (typeof val === 'number') return val;
    const str = String(val);
    if (/^[=+@\-\t\r]/.test(str)) {
      return "'" + str;
    }
    return str;
  },

  // Método seguro de guardado que funciona tanto en protocolo file:// como en web
  saveFileSafe: function(data, filename, mimeType, description, extension) {
    // 1. Prioridad: File System Access API nativa (Abre "Guardar como..." con el nombre y extensión exactos)
    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: description || 'Archivo',
          accept: { [mimeType]: [extension] }
        }]
      }).then(handle => {
        return handle.createWritable().then(writable => {
          return writable.write(data).then(() => {
            return writable.close();
          });
        });
      }).then(() => {
        App.showToast(`Excel guardado con éxito: ${filename}`);
      }).catch(err => {
        if (err && err.name === 'AbortError') return; // Usuario canceló
        console.warn('showSaveFilePicker no completado, usando fallback:', err);
        Exporter.fallbackDownload(data, filename, mimeType);
      });
      return;
    }

    // 2. Fallback
    Exporter.fallbackDownload(data, filename, mimeType);
  },

  // Fallback con Data URI o Blob URL
  fallbackDownload: function(data, filename, mimeType) {
    try {
      let dataUri = '';
      if (typeof data === 'string') {
        dataUri = `data:${mimeType};charset=utf-8,` + encodeURIComponent(data);
      } else {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        dataUri = `data:${mimeType};base64,` + btoa(binary);
      }

      const a = document.createElement('a');
      a.href = dataUri;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      App.showToast(`Archivo descargado: ${filename}`);
      return;
    } catch (e) {
      console.warn('Fallback Data URI falló, usando Blob URL:', e);
    }

    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    App.showToast(`Archivo descargado: ${filename}`);
  },

  // Fallback CSV en caso de no contar con conexión a CDN de SheetJS
  exportToCSV: function(headers, rows, filename) {
    let csvContent = "\uFEFF"; // BOM para acentos en Excel
    csvContent += headers.map(h => `"${h}"`).join(",") + "\r\n";
    rows.forEach(row => {
      csvContent += row.map(val => {
        const clean = Exporter.sanitizeForSpreadsheet(val !== null && val !== undefined ? val : '');
        return `"${String(clean).replace(/"/g, '""')}"`;
      }).join(",") + "\r\n";
    });

    Exporter.saveFileSafe(
      csvContent, 
      filename, 
      'text/csv', 
      'Archivo CSV (*.csv)', 
      '.csv'
    );
  },

  // Imprimir reporte formal o guardar como PDF
  printReport: function(course, studentsMap) {
    window.print();
  },

  // Exportar Sábana Completa de Asistencias a Excel (.xlsx)
  exportAttendanceToExcel: function(course, studentsMap, unit) {
    if (!course) return;
    const currentUnit = Number(unit) || 1;
    const sessions = (course.attendanceSessions || [])
      .filter(s => s.unidad === currentUnit)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    const records = course.records || [];

    const dateHeaders = sessions.map(s => {
      const parts = (s.fecha || '').split('-');
      const d = parts.length === 3 ? `${parts[2]}/${parts[1]}` : s.fecha;
      return `${d} (${s.tema || 'Clase'})`;
    });

    const headers = [
      "No.",
      "Matrícula",
      "Nombre Completo (Rollup)",
      ...dateHeaders,
      "Tot. Presentes (P)",
      "Tot. Faltas (F)",
      "Tot. Retardos (R)",
      "Tot. Justificados (J)",
      "% Asistencia",
      "Estatus Derecho"
    ];

    const asistCfg = course.asistenciaConfig || {};
    const limiteFaltasActivo = !!asistCfg.limiteFaltasActivo;
    const ambitoLimite = asistCfg.ambitoLimite || "unidad";
    const maxFaltas = Number(asistCfg.maxFaltas) || Number(asistCfg.maxFaltasPorUnidad) || 3;
    const modoExceder = asistCfg.modoExceder || "alerta_sd";
    const isSemestre = (ambitoLimite === "semestre");

    const rows = records.map((rec, idx) => {
      const student = studentsMap[rec.matricula] || { nombre: "NO REGISTRADO" };
      let p = 0, f = 0, r = 0, j = 0;
      const sessionVals = sessions.map(s => {
        const st = (rec.attendanceDays && rec.attendanceDays[s.id]) || 'P';
        if (st === 'P') p++;
        else if (st === 'F') f++;
        else if (st === 'R') r++;
        else if (st === 'J') j++;
        return st;
      });

      const effectiveP = p + (r * 0.5) + j;
      const pct = sessions.length > 0 ? Math.round((effectiveP / sessions.length) * 100) : 100;
      const effectiveF = f + Math.floor(r / 2);

      let semFaltas = 0;
      const numU = Number(course?.unidadesCount) || 5;
      for (let u = 1; u <= numU; u++) {
        if (u === currentUnit) {
          semFaltas += effectiveF;
        } else if (rec.faltas && rec.faltas[`u${u}`] !== undefined && rec.faltas[`u${u}`] !== "") {
          semFaltas += Number(rec.faltas[`u${u}`]) || 0;
        }
      }

      const faltasEvaluadas = isSemestre ? semFaltas : effectiveF;
      const isExceeded = limiteFaltasActivo && (faltasEvaluadas > maxFaltas);

      let estatus = "APROBADO";
      if (isExceeded) {
        if (modoExceder === "perder_asistencia") estatus = "SIN PUNTOS ASISTENCIA";
        else if (modoExceder === "alerta_sd") estatus = "SIN DERECHO (SD)";
        else if (modoExceder === "reprobar_cero") estatus = "SIN DERECHO (CALIF 0)";
        else estatus = "SIN DERECHO / SIN ASIST";
      }

      return [
        idx + 1,
        rec.matricula,
        student.nombre,
        ...sessionVals,
        p,
        f,
        r,
        j,
        `${pct}%`,
        estatus
      ];
    });

    const grupoSuffix = course.grupo ? `_${course.grupo.replace(/\s+/g, '_')}` : '';
    const filename = `FIUAT_ASISTENCIAS_${(course.nombre || 'Materia').replace(/\s+/g, '_')}${grupoSuffix}_${course.periodo}_U${currentUnit}.xlsx`;

    // Sanitización SEC-07
    const sanitizedRows = rows.map(r => r.map(cell => Exporter.sanitizeForSpreadsheet(cell)));

    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...sanitizedRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      ws['!cols'] = [
        { wch: 6 },
        { wch: 15 },
        { wch: 35 },
        ...sessions.map(() => ({ wch: 14 })),
        { wch: 16 },
        { wch: 14 },
        { wch: 14 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, `Asistencia U${currentUnit}`);
      const u8 = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      Exporter.saveFileSafe(
        u8, 
        filename, 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Libro de Excel (*.xlsx)',
        '.xlsx'
      );
    } else {
      Exporter.exportToCSV(headers, sanitizedRows, filename.replace('.xlsx', '.csv'));
    }
  }
};
