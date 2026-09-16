// firebase_service.js - Módulo de integración con Firebase Firestore
// Permite sincronización en tiempo real y persistencia offline ("Local-First")

const firebaseConfig = {
  apiKey: "AIzaSyD0QmIKjqrcblDJFoel30OGdSuslvwJnuM",
  authDomain: "calificaciones-fiuat.firebaseapp.com",
  projectId: "calificaciones-fiuat",
  storageBucket: "calificaciones-fiuat.firebasestorage.app",
  messagingSenderId: "983122398688",
  appId: "1:983122398688:web:2c2542cdedaa3d5c4baf85",
  measurementId: "G-FTMGHMR7QM"
};

const FirebaseService = {
  app: null,
  db: null,
  isInitialized: false,
  isOnline: navigator.onLine,
  status: "connecting", // "connected", "offline", "error"
  activeListenerUnsubscribe: null,

  init: async function() {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK no detectado. Operando en modo local.");
      this.status = "offline";
      return false;
    }

    try {
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(firebaseConfig);
      } else {
        this.app = firebase.app();
      }

      this.db = firebase.firestore();

      // Habilitar persistencia offline en el navegador
      try {
        await this.db.enablePersistence({ synchronizeTabs: true });
        console.log("Persistencia offline de Firestore activada.");
      } catch (err) {
        if (err.code === "failed-precondition") {
          console.warn("Persistencia falló: múltiples pestañas abiertas simultáneamente.");
        } else if (err.code === "unimplemented") {
          console.warn("El navegador actual no soporta persistencia offline.");
        }
      }

      this.isInitialized = true;
      this.status = navigator.onLine ? "connected" : "offline";

      // Monitorear cambios en la conexión a internet
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
    } catch (error) {
      console.error("Error al inicializar Firebase Firestore:", error);
      this.status = "error";
      return false;
    }
  },

  notifyStatusChange: function() {
    if (typeof App !== "undefined" && App.updateCloudStatusBadge) {
      App.updateCloudStatusBadge();
    }
  },

  // Obtener todos los profesores desde Firestore
  fetchTeachers: async function() {
    if (!this.isInitialized || !this.db) return null;

    try {
      const snapshot = await this.db.collection("teachers").get();
      if (snapshot.empty) {
        return [];
      }

      const teachers = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        teachers.push({
          id: doc.id,
          ...data
        });
      });

      return teachers;
    } catch (error) {
      console.error("Error al obtener profesores de Firestore:", error);
      return null;
    }
  },

  // Sembrar datos iniciales si la colección de Firestore está vacía
  seedInitialDataIfEmpty: async function(initialTeachers) {
    if (!this.isInitialized || !this.db || !initialTeachers || initialTeachers.length === 0) return;

    try {
      const snapshot = await this.db.collection("teachers").limit(1).get();
      if (snapshot.empty) {
        console.log("Firestore vacío. Sembrando profesores y catálogo inicial...");
        const batch = this.db.batch();

        initialTeachers.forEach(teacher => {
          const docRef = this.db.collection("teachers").doc(teacher.id);
          batch.set(docRef, {
            ...teacher,
            updatedAt: new Date().toISOString()
          });
        });

        await batch.commit();
        console.log("Semillero inicial cargado con éxito en Firestore.");
      }
    } catch (error) {
      console.error("Error al sembrar datos iniciales en Firestore:", error);
    }
  },

  // Guardar o actualizar un profesor en Firestore
  saveTeacher: async function(teacher) {
    if (!this.isInitialized || !this.db || !teacher || !teacher.id) return;

    try {
      const cleanTeacher = JSON.parse(JSON.stringify(teacher));
      cleanTeacher.updatedAt = new Date().toISOString();

      await this.db.collection("teachers").doc(teacher.id).set(cleanTeacher, { merge: true });
      this.status = "connected";
      this.notifyStatusChange();
    } catch (error) {
      console.warn("No se pudo sincronizar con Firestore (guardado en caché local):", error);
      if (!navigator.onLine) {
        this.status = "offline";
        this.notifyStatusChange();
      }
    }
  },

  // Eliminar un profesor de Firestore
  deleteTeacher: async function(teacherId) {
    if (!this.isInitialized || !this.db || !teacherId) return;

    try {
      await this.db.collection("teachers").doc(teacherId).delete();
    } catch (error) {
      console.error("Error al eliminar profesor de Firestore:", error);
    }
  },

  // Escuchar cambios en vivo de un profesor (Modo Supervisión para el Perfil Maestro)
  listenToTeacher: function(teacherId, onUpdate) {
    if (!this.isInitialized || !this.db || !teacherId) return null;

    // Si ya había un listener activo, cancelarlo primero
    this.stopListening();

    try {
      this.activeListenerUnsubscribe = this.db.collection("teachers").doc(teacherId)
        .onSnapshot((doc) => {
          if (doc.exists && onUpdate) {
            const data = doc.data();
            onUpdate({ id: doc.id, ...data });
          }
        }, (error) => {
          console.warn("Error en el listener en vivo de Firestore:", error);
        });

      return this.activeListenerUnsubscribe;
    } catch (error) {
      console.error("Error al iniciar listener de Firestore:", error);
      return null;
    }
  },

  // Detener la escucha en tiempo real
  stopListening: function() {
    if (this.activeListenerUnsubscribe) {
      this.activeListenerUnsubscribe();
      this.activeListenerUnsubscribe = null;
    }
  }
};
