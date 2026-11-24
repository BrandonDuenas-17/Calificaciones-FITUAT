// tests/gradebook.test.mjs - Pruebas automáticas (node:test, cero dependencias)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MathEngine = require("../math_engine.js");
const Exporter = require("../exporter.js");
const App = require("../app.js");

test("calculateStudentGrades: evaluación clásica 50/50 + proyecto + puntos extra con tope 100", () => {
  const course = {
    unidadesCount: 2,
    firmasMaxConfig: { u1: 10, u2: 10 },
    gradingWeights: { firmas: 50, examen: 50, asistencia: 0, participacion: 0 }
  };
  const record = {
    matricula: "2213301101",
    firmas: { u1: 10, u2: 8 },
    examenes: { u1: 100, u2: 80 },
    proyecto: 90,
    puntosExtra: 2
  };
  const res = MathEngine.calculateStudentGrades(record, course);
  assert.equal(res.evalU[1], 100);
  assert.equal(res.evalU[2], 80);
  // Promedio(100, 80, 90) = 90 + (2 * 5) = 100
  assert.equal(res.evalFinal, 100);
  assert.equal(res.hasEvaluations, true);
});

test("calculateStudentGrades: ponderación con Asistencia y Participación + sanción perder_asistencia", () => {
  const course = {
    unidadesCount: 2,
    firmasMaxConfig: { u1: 10, u2: 10 },
    participacionMaxConfig: { u1: 5, u2: 5 },
    gradingWeights: { firmas: 30, examen: 40, asistencia: 15, participacion: 15 },
    asistenciaConfig: {
      limiteFaltasActivo: true,
      consecuenciaActiva: true,
      ambitoLimite: "unidad",
      maxFaltas: 2,
      modoExceder: "perder_asistencia"
    }
  };
  const record = {
    matricula: "2213301101",
    firmas: { u1: 10, u2: 10 },
    examenes: { u1: 100, u2: 100 },
    asistencia: { u1: 100, u2: 80 },
    participacion: { u1: 5, u2: 5 },
    faltas: { u1: 1, u2: 3 }
  };
  const res = MathEngine.calculateStudentGrades(record, course);
  // U1 sin sanción: 30 + 40 + 15 + 15 = 100
  assert.equal(res.evalU[1], 100);
  assert.equal(res.asistenciaPerdidaU[1], false);
  // U2 excede 2 faltas: asistencia = 0 -> 30 + 40 + 0 + 15 = 85
  assert.equal(res.evalU[2], 85);
  assert.equal(res.asistenciaPerdidaU[2], true);
});

test("calculateStudentGrades: límite semestral con reprobar_cero anula unidades evaluadas", () => {
  const course = {
    unidadesCount: 2,
    firmasMaxConfig: { u1: 10, u2: 10 },
    asistenciaConfig: {
      limiteFaltasActivo: true,
      consecuenciaActiva: true,
      ambitoLimite: "semestre",
      maxFaltas: 4,
      modoExceder: "reprobar_cero"
    }
  };
  const record = {
    matricula: "2213301101",
    firmas: { u1: 10, u2: 10 },
    examenes: { u1: 90, u2: 90 },
    faltas: { u1: 2, u2: 3 } // total = 5 > 4
  };
  const res = MathEngine.calculateStudentGrades(record, course);
  assert.equal(res.evalU[1], 0);
  assert.equal(res.evalU[2], 0);
  assert.equal(res.isSinDerechoU[1], true);
  assert.equal(res.evalFinal, 0);
});

test("getLocalDateISO usa la fecha local y no la UTC", () => {
  const d = new Date(2026, 7, 17, 23, 30, 0); // 17 ago 2026 23:30 local
  assert.equal(MathEngine.getLocalDateISO(d), "2026-08-17");
});

test("Exporter.sanitizeForSpreadsheet bloquea inyección de fórmulas (CWE-1236)", () => {
  assert.equal(Exporter.sanitizeForSpreadsheet("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");
  assert.equal(Exporter.sanitizeForSpreadsheet("+2+3"), "'+2+3");
  assert.equal(Exporter.sanitizeForSpreadsheet("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(Exporter.sanitizeForSpreadsheet(95), 95);
  assert.equal(Exporter.sanitizeForSpreadsheet("PEREZ LOPEZ JUAN"), "PEREZ LOPEZ JUAN");
});

test("App.escapeHtml neutraliza payloads XSS y App.currentUser bloquea escalación desde consola", () => {
  assert.equal(
    App.escapeHtml(`<img src=x onerror="alert('xss')">`),
    "&lt;img src=x onerror=&quot;alert(&#039;xss&#039;)&quot;&gt;"
  );

  // Intento de escalación directa desde consola (SEC-505)
  App.currentUser = { id: "admin-coordinacion", role: "admin", nombre: "Atacante" };
  assert.equal(App.currentUser, null);
  assert.equal(App.isAdmin(), false);
});

test("App.sanitizeBackupPayload preserva asistencias, sesiones, ponderaciones, límites y fechas", () => {
  const backup = {
    students: [{ matricula: "2213301101", nombre: "ALUMNO PRUEBA", carrera: "Sistemas" }],
    courses: [{
      id: "c-1",
      nombre: "Cálculo",
      grupo: "Grupo A",
      periodo: "2026 - 3 OTOÑO",
      unidadesCount: 3,
      gradingWeights: { firmas: 30, examen: 40, asistencia: 15, participacion: 15 },
      asistenciaConfig: { limiteFaltasActivo: true, consecuenciaActiva: true, ambitoLimite: "unidad", maxFaltas: 3, modoExceder: "alerta_sd" },
      participacionMaxConfig: { u1: 6, u2: 6, u3: 6 },
      unitDates: { u1: { inicio: "2026-08-17", fin: "2026-09-18" } },
      attendanceSessions: [{ id: "sess_1", unidad: 1, fecha: "2026-08-17", tema: "Clase 1" }],
      records: [{
        matricula: "2213301101",
        firmas: { u1: 8 },
        examenes: { u1: 90 },
        asistencia: { u1: 85 },
        faltas: { u1: 1 },
        participacion: { u1: 4 },
        attendanceDays: { sess_1: "P" },
        participationDays: { sess_1: 2 },
        proyecto: 95,
        puntosExtra: 1
      }]
    }]
  };

  const sanitized = App.sanitizeBackupPayload(backup);
  assert.ok(sanitized);
  assert.deepEqual(sanitized.courses[0].gradingWeights, backup.courses[0].gradingWeights);
  assert.deepEqual(sanitized.courses[0].asistenciaConfig, backup.courses[0].asistenciaConfig);
  assert.deepEqual(sanitized.courses[0].unitDates, backup.courses[0].unitDates);
  assert.equal(sanitized.courses[0].attendanceSessions.length, 1);
  assert.deepEqual(sanitized.courses[0].records[0].attendanceDays, { sess_1: "P" });
  assert.deepEqual(sanitized.courses[0].records[0].faltas, { u1: 1 });
  assert.deepEqual(sanitized.courses[0].records[0].participacion, { u1: 4 });
});
