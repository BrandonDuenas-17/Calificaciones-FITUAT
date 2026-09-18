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

      // Habilitar persistencia offline en el navegador (sin bloqueo de pestañas)
      try {
        await this.db.enablePersistence();
        console.log("Persistencia offline de Firestore activada.");
      } catch (err) {
        console.warn("Persistencia offline no disponible en esta sesión:", err.code || err.message);
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

  // Guardar o actualizar un profesor en Firestore (100% Cloud)
  saveTeacher: async function(teacher) {
    if (!this.isInitialized || !this.db || !teacher || !teacher.id) return false;

    try {
      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saving");
      }

      const cleanTeacher = JSON.parse(JSON.stringify(teacher));
      cleanTeacher.updatedAt = new Date().toISOString();

      await this.db.collection("teachers").doc(teacher.id).set(cleanTeacher, { merge: true });
      this.status = "connected";
      this.notifyStatusChange();

      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("saved");
      }
      return true;
    } catch (error) {
      console.error("Error al sincronizar directamente en Firestore:", error);
      if (!navigator.onLine) {
        this.status = "offline";
      } else {
        this.status = "error";
      }
      this.notifyStatusChange();

      if (typeof App !== "undefined" && App.setCloudSaveStatus) {
        App.setCloudSaveStatus("error", error.message);
      }
      return false;
    }
  },

  // Eliminar un profesor de Firestore
  deleteTeacher: async function(teacherId) {
    if (!this.isInitialized || !this.db || !teacherId) return false;

    try {
      await this.db.collection("teachers").doc(teacherId).delete();
      return true;
    } catch (error) {
      console.error("Error al eliminar profesor de Firestore:", error);
      return false;
    }
  },

  // Escuchar cambios en vivo de un profesor (Modo Supervisión para el Perfil Maestro)
  listenToTeacher: function(teacherId, onUpdate) {
    if (!this.isInitialized || !this.db || !teacherId) return null;

    // Si ya había un listener activo, cancelarlo primero
    this.stopListening();

    try {
      this.activeListenerUnsubscribe = this.db.collection("teachers").doc(teacherId)
        .onSnapshot({ includeMetadataChanges: true }, (doc) => {
          // Ignorar cambios locales que este mismo navegador acaba de escribir
          if (doc.metadata && doc.metadata.hasPendingWrites) return;
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
  },

  // Sincronizar el Roster Oficial completo en lotes (batch) a Firestore
  syncFullFacultyRoster: async function(roster, onProgress) {
    if (!this.isInitialized || !this.db || !roster || roster.length === 0) return false;

    try {
      const batchSize = 25;
      let totalSaved = 0;

      for (let i = 0; i < roster.length; i += batchSize) {
        const chunk = roster.slice(i, i + batchSize);
        const batch = this.db.batch();

        chunk.forEach(teacher => {
          const docRef = this.db.collection("teachers").doc(teacher.id);
          const cleanTeacher = JSON.parse(JSON.stringify(teacher));
          cleanTeacher.updatedAt = new Date().toISOString();
          batch.set(docRef, cleanTeacher, { merge: true });
        });

        await batch.commit();
        totalSaved += chunk.length;
        if (onProgress) {
          onProgress(totalSaved, roster.length);
        }
      }
      return true;
    } catch (e) {
      console.error("Error al sincronizar roster oficial en Firestore:", e);
      return false;
    }
  }
};
