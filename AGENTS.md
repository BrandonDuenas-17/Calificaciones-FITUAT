# AGENTS.md — Reglas Operativas Estrictas del Proyecto: Calificaciones FIUAT

Este archivo rige el comportamiento mandatorio de cualquier agente de Inteligencia Artificial que opere en este repositorio.

---

## 1. Preservación Absoluta de Datos Existentes
* **CERO pérdida de datos:** Queda estrictamente prohibido vaciar, reiniciar, sembrar de cero o sobrescribir los datos ya establecidos en la base de datos de Supabase.
* **Calificaciones y Registros:** Las calificaciones, materias, listas de alumnos y evaluaciones (columna `data`) de todos los docentes no deben ser alteradas bajo ninguna circunstancia a menos que el usuario lo solicite expresamente para un registro específico.
* **Usuarios y Contraseñas:** Las contraseñas personalizadas y los usuarios del catálogo no deben ser reseteados masivamente. Toda actualización debe ser quirúrgica sobre el registro que corresponda.
* **Validación Previa:** Antes y después de cualquier mutación en base de datos, se debe comprobar que el conteo de profesores (154 docentes) y la integridad de los datos permanezca intacta.

---

## 2. Preservación y Fortalecimiento de la Seguridad
* **Cero Bypasses o Claves Hardcodeadas:** Jamás introducir contraseñas por defecto o bypasses (como `"admin"` o `"123"`) que eludan la validación criptográfica contra la base de datos. Si una contraseña se cambia, únicamente esa contraseña real debe ser aceptada.
* **Defensa en Profundidad Intacta:** No debilitar ni retirar ninguna de las medidas de seguridad ya implementadas:
  - Control de acceso estricto por rol (`role === 'admin'`).
  - Protección contra escalación de privilegios desde la consola (`_currentSessionUser` y `Object.freeze`).
  - Firmas criptográficas de sesión efímeras (SEC-02).
  - Bloqueo por fuerza bruta (5 intentos fallidos = 60 segundos de bloqueo).
  - Cierre automático de sesión por inactividad tras 20 minutos.
  - Sanitización estricta contra inyección de fórmulas en CSV/Excel (CWE-1236 - SEC-07).
* **Confirmación de Persistencia:** Las funciones de actualización de credenciales deben verificar que la base de datos remota haya confirmado la operación afirmativamente antes de notificar éxito en la interfaz.

---

## 3. GitOps y Despliegue Limpio en GitHub
* **Commits Semánticos y Verificados:** Todo cambio debe registrarse con mensajes de commit claros, concisos y descriptivos del problema resuelto.
* **Push Obligatorio a GitHub:** Los cambios deben subirse (`git push origin main`) de manera inmediata y limpia.
* **Comprobación de Sincronización:** Se debe verificar que la rama remota `origin/main` y la rama local `main` tengan exactamente el mismo hash de commit y que el árbol de trabajo quede completamente limpio (`working tree clean`).
* **Cache-Busting Sistemático:** Cada actualización de archivos estáticos (`app.js`, `styles.css`, `supabase_service.js`) debe acompañarse de un incremento de versión (`vXX`) en `index.html` para garantizar que los usuarios reciban los cambios en vivo sin problemas de caché.
