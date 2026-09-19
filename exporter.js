// exporter.js - Exportación para Teams, Excel (.xlsx), PDF y Portal de Consulta Alumno

const Exporter = {
  // Exportar a Excel utilizando SheetJS si está disponible, o fallback HTML/CSV
  exportToExcel: function(course, studentsMap, mode = 'docente', options = {}) {
    const records = course.records || [];
    const maxFirmas = course.firmasMaxConfig || {};
    
    // Preparar encabezados y filas
    let headers = [];
    let rows = [];

    if (mode === 'teams') {
      // Modo Publicación para Alumnos en Teams
      const includeNames = options.includeNames !== false;
      headers = includeNames 
        ? ["Matrícula", "Nombre del Alumno", "Eval U1", "Eval U2", "Eval U3", "Eval U4", "Eval U5", "Proyecto Final", "Puntos Extra", "Calificación Final", "Estatus"]
        : ["Matrícula (ID)", "Eval U1", "Eval U2", "Eval U3", "Eval U4", "Eval U5", "Proyecto Final", "Puntos Extra", "Calificación Final", "Estatus"];

      rows = records.map(rec => {
        const student = studentsMap[rec.matricula] || { nombre: "NO REGISTRADO" };
        const calcs = App.calculateStudentGrades(rec, course);
        const estatus = calcs.hasEvaluations 
          ? (calcs.evalFinal >= 70 ? "APROBADO" : "NO APROBADO") 
          : "PENDIENTE";
        const getEval = (u) => (calcs.evalU[u] !== null && calcs.evalU[u] !== undefined) ? calcs.evalU[u] : "-";

        const baseRow = includeNames ? [rec.matricula, student.nombre] : [rec.matricula];
        return [
          ...baseRow,
          getEval(1),
          getEval(2),
          getEval(3),
          getEval(4),
          getEval(5),
          rec.proyecto !== null && rec.proyecto !== undefined ? rec.proyecto : "-",
          rec.puntosExtra || 0,
          calcs.hasEvaluations ? calcs.evalFinal : "-",
          estatus
        ];
      });
    } else {
      // Modo Docente Completo
      headers = [
        "Matrícula", "Nombre Completo (Rollup)", "Calificación Final", "Estatus",
        "Firmas U1", "Firmas U2", "Firmas U3", "Firmas U4", "Firmas U5",
        "Examen U1", "Examen U2", "Examen U3", "Examen U4", "Examen U5",
        "Eval U1 (50%+50%)", "Eval U2", "Eval U3", "Eval U4", "Eval U5",
        "Proyecto Final", "Puntos Extra (+5 c/u)"
      ];

      rows = records.map(rec => {
        const student = studentsMap[rec.matricula] || { nombre: "NO REGISTRADO" };
        const calcs = App.calculateStudentGrades(rec, course);
        const estatus = calcs.hasEvaluations 
          ? (calcs.evalFinal >= 70 ? "APROBADO" : "NO APROBADO") 
          : "PENDIENTE";
        const getEval = (u) => (calcs.evalU[u] !== null && calcs.evalU[u] !== undefined) ? calcs.evalU[u] : "";

        const f = rec.firmas || {};
        const e = rec.examenes || {};

        return [
          rec.matricula,
          student.nombre,
          calcs.hasEvaluations ? calcs.evalFinal : "-",
          estatus,
          f.u1 ?? "",
          f.u2 ?? "",
          f.u3 ?? "",
          f.u4 ?? "",
          f.u5 ?? "",
          e.u1 ?? "",
          e.u2 ?? "",
          e.u3 ?? "",
          e.u4 ?? "",
          e.u5 ?? "",
          getEval(1),
          getEval(2),
          getEval(3),
          getEval(4),
          getEval(5),
          rec.proyecto ?? "",
          rec.puntosExtra || 0
        ];
      });
    }

    const grupoSuffix = course.grupo ? `_${course.grupo.replace(/\s+/g, '_')}` : '';
    const filename = `FIUAT_${course.nombre.replace(/\s+/g, '_')}${grupoSuffix}_${course.periodo}_${mode === 'teams' ? 'TEAMS_PUBLICACION' : 'CONTROL_DOCENTE'}.xlsx`;

    // Si la librería SheetJS (XLSX) está presente
    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...rows];
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
      Exporter.exportToCSV(headers, rows, filename.replace('.xlsx', '.csv'));
    }
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
      csvContent += row.map(val => `"${val !== null && val !== undefined ? val : ''}"`).join(",") + "\r\n";
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
  }
};
