// math_engine.js - Motor matemático de calificaciones, fechas locales y políticas de asistencia

const MathEngine = {
  // Fecha local en formato YYYY-MM-DD (evita salto al día siguiente tras las 18:00 en UTC-6)
  getLocalDateISO: function(date) {
    const d = date instanceof Date ? date : new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  },

  normalizePeriodo: function(p) {
    if (!p || typeof p !== "string" || !p.trim()) return "2026 - 3 OTOÑO";
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

  // Fuente única de verdad para interpretar las reglas de límite de faltas (elimina 5 copias)
  getAttendancePolicy: function(course) {
    const asistCfg = (course && course.asistenciaConfig) ? course.asistenciaConfig : {};
    const limiteFaltasActivo = !!asistCfg.limiteFaltasActivo;
    const consecuenciaActiva = (asistCfg.consecuenciaActiva !== undefined)
      ? !!asistCfg.consecuenciaActiva
      : (!!asistCfg.modoExceder && asistCfg.modoExceder !== "ninguna");
    const ambitoLimite = asistCfg.ambitoLimite || "unidad";
    const maxFaltas = Number(asistCfg.maxFaltas) || Number(asistCfg.maxFaltasPorUnidad) || 3;
    const modoExceder = consecuenciaActiva ? (asistCfg.modoExceder || "alerta_sd") : "ninguna";
    const isSemestre = (ambitoLimite === "semestre");
    const pierdeAsistencia = consecuenciaActiva && (
      modoExceder === "perder_asistencia" ||
      modoExceder === "ambas_alerta" ||
      modoExceder === "ambas_cero"
    );
    const esSinDerecho = consecuenciaActiva && (
      modoExceder === "alerta_sd" ||
      modoExceder === "reprobar_cero" ||
      modoExceder === "ambas_alerta" ||
      modoExceder === "ambas_cero"
    );
    const esReprobarCero = consecuenciaActiva && (
      modoExceder === "reprobar_cero" ||
      modoExceder === "ambas_cero"
    );

    return {
      raw: asistCfg,
      limiteFaltasActivo,
      consecuenciaActiva,
      ambitoLimite,
      maxFaltas,
      modoExceder,
      isSemestre,
      pierdeAsistencia,
      esSinDerecho,
      esReprobarCero
    };
  },

  getStudentSemesterFaltas: function(record, course, currentUnitOverride, currentUnitFaltasVal) {
    if (!record) return 0;
    let total = 0;
    const numUnits = Number(course && course.unidadesCount) || 5;
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

  // Fórmulas de cálculo con ponderaciones personalizadas y asistencia/participación opcionales
  calculateStudentGrades: function(record, course) {
    const maxFirmasConfig = course.firmasMaxConfig || {};
    const maxPartConfig = course.participacionMaxConfig || {};
    const evalU = {};
    const validUnitsForMean = [];
    let evaluatedUnitsCount = 0;

    const weights = course.gradingWeights || { firmas: 50, examen: 50, asistencia: 0, participacion: 0 };
    const wFirmas = Number(weights.firmas) || 0;
    const wExamen = Number(weights.examen) || 0;
    const wAsist = Number(weights.asistencia) || 0;
    const wPart = Number(weights.participacion) || 0;

    const policy = MathEngine.getAttendancePolicy(course);

    const isSinDerechoU = {};
    const asistenciaPerdidaU = {};
    const faltasU = {};
    let hasAnySinDerecho = false;

    let totalFaltasSemestre = 0;
    const totalUnitsCount = Number(course.unidadesCount) || 5;
    for (let u = 1; u <= totalUnitsCount; u++) {
      const uKey = `u${u}`;
      const fNum = (record.faltas && record.faltas[uKey] !== undefined && record.faltas[uKey] !== "")
        ? Number(record.faltas[uKey])
        : 0;
      faltasU[u] = fNum;
      totalFaltasSemestre += fNum;
    }
    const excedeSemestre = policy.limiteFaltasActivo && policy.consecuenciaActiva && policy.isSemestre && (totalFaltasSemestre > policy.maxFaltas);

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

      if (hasFirmas || hasExamen || hasAsist || hasPart) {
        const excedeUnidad = policy.limiteFaltasActivo && policy.consecuenciaActiva && !policy.isSemestre && (faltas > policy.maxFaltas);
        const estaSancionado = policy.isSemestre ? excedeSemestre : excedeUnidad;

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
          if (estaSancionado && policy.pierdeAsistencia) {
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

        if (estaSancionado && policy.esSinDerecho) {
          isSinDerechoU[u] = true;
          hasAnySinDerecho = true;
          if (policy.esReprobarCero) {
            totalU = 0;
          }
        } else {
          isSinDerechoU[u] = false;
        }

        evalU[u] = totalU;
        validUnitsForMean.push(totalU);
        evaluatedUnitsCount++;
      } else {
        evalU[u] = null;
        isSinDerechoU[u] = false;
        asistenciaPerdidaU[u] = false;
      }
    }

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
      asistenciaConfig: policy.raw
    };
  },

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

      const firmasVals = records
        .map(r => r.firmas ? r.firmas[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.maxFirmas[uKey] = firmasVals.length > 0 ? Math.max(...firmasVals.map(Number)) : 0;
      stats.avgFirmas[uKey] = firmasVals.length > 0 ? (firmasVals.reduce((a, b) => a + Number(b), 0) / firmasVals.length).toFixed(1) : 0;

      const examenVals = records
        .map(r => r.examenes ? r.examenes[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.avgExamenes[uKey] = examenVals.length > 0 ? (examenVals.reduce((a, b) => a + Number(b), 0) / examenVals.length).toFixed(2) : "0.00";

      const asistVals = records
        .map(r => r.asistencia ? r.asistencia[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.avgAsistencia[uKey] = asistVals.length > 0 ? Math.round(asistVals.reduce((a, b) => a + Number(b), 0) / asistVals.length) : 0;

      const partVals = records
        .map(r => r.participacion ? r.participacion[uKey] : null)
        .filter(v => v !== null && v !== undefined && v !== "");
      stats.avgParticipacion[uKey] = partVals.length > 0 ? (partVals.reduce((a, b) => a + Number(b), 0) / partVals.length).toFixed(1) : 0;
    }

    let sumFinal = 0;
    let finalCount = 0;
    const evalSums = {};
    const evalCounts = {};
    for (let u = 1; u <= numUnits; u++) {
      evalSums[u] = 0;
      evalCounts[u] = 0;
    }

    records.forEach(r => {
      const c = MathEngine.calculateStudentGrades(r, course);
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
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = MathEngine;
}
