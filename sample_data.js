// sample_data.js - Datos iniciales basados en las capturas reales de Notion

const INITIAL_DATA = {
  // Base de datos maestra de alumnos (Directorio)
  students: [
    { matricula: "2171275010", nombre: "HERNANDEZ GUTIERREZ ALAN", carrera: "Ingeniería" },
    { matricula: "2183207005", nombre: "CASTILLO LUCAS YULISSA YOELI MARIBEL", carrera: "Ingeniería" },
    { matricula: "2183228140", nombre: "TORRES PEGO NICOLAS ANTONIO", carrera: "Ingeniería" },
    { matricula: "2183390510", nombre: "AGUILAR SILVA CARLOS ENRIQUE", carrera: "Ingeniería" },
    { matricula: "2191390325", nombre: "ALVAREZ CARDENAS GABRIELA ABIGAIL", carrera: "Ingeniería" },
    { matricula: "2191390489", nombre: "SANCHEZ ZAVALA VICTOR HAMALIEL", carrera: "Ingeniería" },
    { matricula: "2193270008", nombre: "MARTINEZ RAMIREZ JOBERICK YUNKA", carrera: "Ingeniería" },
    { matricula: "2203217009", nombre: "GUERRERO ESPRIELLA GABRIEL ALFONSO", carrera: "Ingeniería" },
    { matricula: "2203274004", nombre: "GAMEZ ARREDONDO HECTOR EDUARDO", carrera: "Ingeniería" },
    { matricula: "2203283017", nombre: "SEGURA OLVERA JORGE", carrera: "Ingeniería" },
    { matricula: "2213216002", nombre: "BALLESTEROS HERNANDEZ NATALIA", carrera: "Ingeniería" },
    { matricula: "2213267102", nombre: "VILLARREAL ESPINOZA JULIO CESAR", carrera: "Ingeniería" },
    { matricula: "2213270099", nombre: "CARTAGENA GUZMAN ALAN GABRIEL", carrera: "Ingeniería" },
    { matricula: "2213275057", nombre: "MARTINEZ SANCHEZ PAOLO", carrera: "Ingeniería" }
  ],

  // Cursos / Materias
  courses: [
    {
      id: "algebra-lineal-ga",
      nombre: "Álgebra Lineal",
      grupo: "Grupo A",
      periodo: "2026-1",
      unidadesCount: 5,
      // Máximos de firmas por unidad fijados o calculados
      firmasMaxConfig: { u1: 6, u2: 14, u3: 17, u4: 23, u5: 10 },
      records: [
        {
          matricula: "2171275010",
          firmas: { u1: null, u2: null, u3: null, u4: null, u5: null },
          examenes: { u1: null, u2: null, u3: null, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2183207005",
          firmas: { u1: 5, u2: 4, u3: 12, u4: null, u5: null },
          examenes: { u1: null, u2: 70, u3: 85, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2183228140",
          firmas: { u1: null, u2: null, u3: null, u4: 15, u5: null },
          examenes: { u1: 45, u2: null, u3: null, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2183390510",
          firmas: { u1: 5, u2: 2, u3: 6, u4: null, u5: null },
          examenes: { u1: 30, u2: null, u3: 70, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2191390325",
          firmas: { u1: 5, u2: 5, u3: 12, u4: 20, u5: 6 },
          examenes: { u1: null, u2: null, u3: null, u4: 100, u5: 90 },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2191390489",
          firmas: { u1: 2, u2: null, u3: 4, u4: null, u5: null },
          examenes: { u1: 10, u2: 0, u3: 10, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2193270008",
          firmas: { u1: 6, u2: 4, u3: 16, u4: null, u5: null },
          examenes: { u1: 95, u2: 70, u3: 100, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2203217009",
          firmas: { u1: 6, u2: 3, u3: 7, u4: 20, u5: 6 },
          examenes: { u1: 100, u2: 100, u3: 100, u4: 60, u5: 60 },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2203274004",
          firmas: { u1: 6, u2: 5, u3: 15, u4: null, u5: null },
          examenes: { u1: 80, u2: 0, u3: 60, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2203283017",
          firmas: { u1: 6, u2: 3, u3: 7, u4: null, u5: null },
          examenes: { u1: 95, u2: 65, u3: 85, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2213216002",
          firmas: { u1: null, u2: null, u3: null, u4: null, u5: null },
          examenes: { u1: null, u2: null, u3: null, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2213267102",
          firmas: { u1: null, u2: 2, u3: null, u4: null, u5: null },
          examenes: { u1: null, u2: 35, u3: null, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2213270099",
          firmas: { u1: null, u2: null, u3: null, u4: null, u5: null },
          examenes: { u1: null, u2: null, u3: null, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        },
        {
          matricula: "2213275057",
          firmas: { u1: 6, u2: 3, u3: 7, u4: null, u5: null },
          examenes: { u1: 85, u2: 40, u3: 20, u4: null, u5: null },
          proyecto: null,
          puntosExtra: 0
        }
      ]
    },
    {
      id: "algebra-lineal-gb",
      nombre: "Álgebra Lineal",
      grupo: "Grupo B",
      periodo: "2026-1",
      unidadesCount: 5,
      firmasMaxConfig: { u1: 6, u2: 14, u3: 17, u4: 23, u5: 10 },
      records: []
    },
    {
      id: "calculo-integral-ga",
      nombre: "Cálculo Integral",
      grupo: "Grupo A",
      periodo: "2026-1",
      unidadesCount: 5,
      firmasMaxConfig: { u1: 8, u2: 12, u3: 15, u4: 18, u5: 12 },
      records: [
        {
          matricula: "2191390325",
          firmas: { u1: 8, u2: 11, u3: 14, u4: 17, u5: 12 },
          examenes: { u1: 90, u2: 95, u3: 88, u4: 92, u5: 96 },
          proyecto: 95,
          puntosExtra: 1
        },
        {
          matricula: "2203217009",
          firmas: { u1: 8, u2: 12, u3: 15, u4: 18, u5: 12 },
          examenes: { u1: 95, u2: 90, u3: 92, u4: 85, u5: 90 },
          proyecto: 90,
          puntosExtra: 0
        },
        {
          matricula: "2203283017",
          firmas: { u1: 7, u2: 10, u3: 12, u4: 15, u5: 10 },
          examenes: { u1: 80, u2: 75, u3: 70, u4: 85, u5: 80 },
          proyecto: 85,
          puntosExtra: 0
        }
      ]
    }
  ]
};

// Perfil Maestro de Coordinación / Administrador
const INITIAL_ADMIN = {
  id: "admin-coordinacion",
  nombre: "Coordinación Académica FIUAT",
  usuario: "admin",
  correo: "coordinacion@ingenieria.uat.edu.mx",
  password: "admin",
  departamento: "Dirección y Gestión Docente",
  role: "admin",
  avatar: "DIR"
};

// Catálogo inicial de profesores con sus materias y directorios aislados
const INITIAL_TEACHERS = [
  {
    id: "prof-roberto",
    nombre: "Ing. Roberto García M.",
    usuario: "rgarcia",
    correo: "rgarcia@docentes.uat.edu.mx",
    password: "123",
    departamento: "Ciencias Básicas (FIUAT)",
    role: "docente",
    avatar: "RG",
    data: INITIAL_DATA
  },
  {
    id: "prof-martha",
    nombre: "Dra. Martha Elena Sánchez",
    usuario: "msanchez",
    correo: "msanchez@docentes.uat.edu.mx",
    password: "123",
    departamento: "Ingeniería en Sistemas",
    role: "docente",
    avatar: "MS",
    data: {
      students: [
        { matricula: "2213301101", nombre: "CRUZ MORALES SEBASTIAN", carrera: "Ing. en Sistemas" },
        { matricula: "2213302202", nombre: "DOMINGUEZ LARA VALERIA", carrera: "Ing. en Sistemas" },
        { matricula: "2213303303", nombre: "FLORES MENDEZ EMILIANO", carrera: "Ing. en Sistemas" },
        { matricula: "2213304404", nombre: "GOMEZ NAVARRO SOFIA", carrera: "Ing. en Sistemas" },
        { matricula: "2213305505", nombre: "LOPEZ RIVERA RODRIGO", carrera: "Ing. en Sistemas" }
      ],
      courses: [
        {
          id: "programacion-web-ga",
          nombre: "Programación Web",
          grupo: "Grupo A",
          periodo: "2026-1",
          unidadesCount: 5,
          firmasMaxConfig: { u1: 10, u2: 12, u3: 15, u4: 10, u5: 8 },
          records: [
            {
              matricula: "2213301101",
              firmas: { u1: 10, u2: 11, u3: 14, u4: 9, u5: 8 },
              examenes: { u1: 95, u2: 90, u3: 85, u4: 90, u5: 95 },
              proyecto: 95,
              puntosExtra: 1
            },
            {
              matricula: "2213302202",
              firmas: { u1: 8, u2: 10, u3: 12, u4: 8, u5: 7 },
              examenes: { u1: 85, u2: 80, u3: 75, u4: 85, u5: 88 },
              proyecto: 88,
              puntosExtra: 0
            },
            {
              matricula: "2213303303",
              firmas: { u1: 9, u2: 12, u3: 15, u4: 10, u5: 8 },
              examenes: { u1: 100, u2: 95, u3: 90, u4: 95, u5: 100 },
              proyecto: 98,
              puntosExtra: 2
            }
          ]
        },
        {
          id: "bases-datos-ga",
          nombre: "Bases de Datos Avanzadas",
          grupo: "Grupo A",
          periodo: "2026-1",
          unidadesCount: 5,
          firmasMaxConfig: { u1: 8, u2: 10, u3: 12, u4: 12, u5: 10 },
          records: [
            {
              matricula: "2213304404",
              firmas: { u1: 7, u2: 9, u3: 11, u4: 10, u5: 9 },
              examenes: { u1: 90, u2: 85, u3: 92, u4: 88, u5: 90 },
              proyecto: 92,
              puntosExtra: 0
            },
            {
              matricula: "2213305505",
              firmas: { u1: 8, u2: 10, u3: 12, u4: 12, u5: 10 },
              examenes: { u1: 95, u2: 90, u3: 95, u4: 92, u5: 96 },
              proyecto: 95,
              puntosExtra: 1
            }
          ]
        }
      ]
    }
  }
];

