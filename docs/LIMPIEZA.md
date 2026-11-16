# Estado de la limpieza — 13/11/2026

Este documento registra lo aplicado a partir de la propuesta de limpieza del 11/11/2026.

## Completado

- Retirada definitiva de la integración experimental de reportes: componente inactivo, cliente HTTP, cuatro rutas, tipos y campos de credenciales, pruebas exclusivas y referencias en el README. Las pruebas de las integraciones vigentes siguen presentes.
- Las configuraciones cifradas antiguas sólo aportan campos vigentes. Al volver a guardarlas, se omiten los campos retirados. No se ejecutó una migración ni se modificaron registros de la base existente.
- Worker común en `apps/api/src/worker.ts`, usado por servidor y demo. Conserva intervalos de 3 y 5 segundos, orden de operaciones y aislamiento de errores por negocio. No permite ciclos simultáneos y espera al ciclo activo antes del cierre.
- Descargas consolidadas en `apps/api/src/http/send-asset.ts`. Las rutas conservan la autorización por negocio o la comprobación de token, vencimiento y pago aprobado. Las entregas públicas mantienen `Referrer-Policy: no-referrer`.
- Acciones del panel e integraciones usan `useAsyncAction`. El panel conserva su refresco posterior al éxito; integraciones conserva sus refrescos explícitos.
- Estado de conexiones compartido por panel e integraciones mediante una sola instancia y un solo temporizador. Las consultas concurrentes se agrupan; el desmontaje cancela la petición y descarta respuestas viejas. Las acciones de conexión no se sobrescriben con un estado anterior todavía pendiente.
- Cancelación del ciclo de consulta del QR al desmontar la pantalla.
- La aprobación automática y su fallback ya se habían unificado en `completeAutomaticReview`; se conserva esa implementación.
- Ya se separaron componentes de `main.tsx`, rutas de `app.ts`, decisiones de ventas y piezas de webhooks e integraciones. Mover código no equivale a eliminarlo.

## Cierre de los cinco puntos

Los cinco puntos de esta vuelta están implementados y verificados. El detalle, mapa de archivos y límites están en [CIERRE-AUDITORIA.md](CIERRE-AUDITORIA.md).

1. Comprobantes: huella también en aprobación manual, detección de reutilización histórica y rechazo de decisiones sobre un archivo reemplazado. Panel, API, WhatsApp y verificación automática usan la identidad del comprobante observado.
2. Importes: céntimos conservados en panel, mensajes y vista previa. Preguntas frecuentes y frases de activación usan normalización consistente; se rechazan duplicados y frases vacías después de normalizar.
3. Archivos grandes: `main.tsx` queda en 350 líneas, `sales.ts` en 141 y `ProductEditor.tsx` en 61. Pantallas, estado y operaciones de ventas se separaron por responsabilidad conservando las transacciones.
4. Repeticiones: un único actualizador de packs y otro de respuestas, un único texto de presentación del producto y un único formato monetario compartido.
5. Validación: 71/71 pruebas correctas con bases PGlite efímeras; compilación completa correcta; comprobación visual de escritorio y móvil. CSS dividido en ocho archivos conservando exactamente el orden y contenido de las reglas. El CSS compilado conserva el identificador `index-DGeTFqcr.css`.

También se corrigió la carga de PDF de conocimiento: el parser recibe un Uint8Array independiente del Buffer de Node, y el PDF de prueba usa saltos de línea reales.

## Conservado a propósito

- Validaciones tanto en cliente como en servidor; controles de estado, autorización por negocio, propósito de archivos, migraciones y pruebas de recorridos distintos.
- Reglas CSS de distintos tamaños de pantalla: no son duplicados eliminables por coincidencia de selector. Se conserva la tabla de pagos con desplazamiento horizontal dentro de su contenedor en móvil.
- Archivos privados, credenciales, sesiones e instalación externa del gateway. Las pruebas y la revisión visual no usan la base real ni envían mensajes a proveedores. El arranque habitual solicitado al finalizar es una operación separada.
- Esta entrega cierra los cinco puntos de limpieza y las regresiones cubiertas; no constituye una certificación completa de seguridad ni sustituye una prueba de integración con teléfonos reales.
