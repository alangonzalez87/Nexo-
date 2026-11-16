# OpenWA: contrato implementado y prueba real

La instalación local en Windows ya incluye gateway, sesión vacía, clave por sesión y webhook verificados. Se obtuvo un QR real sin vincular ninguna cuenta. Para encender y usar esta instalación, ver [Inicio Windows](INICIO-WINDOWS.md). La prueba de conversación y OpenAI sigue pendiente de autorización del teléfono y credenciales.

Se consultó [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA) el 20 de octubre de 2026. Es un gateway externo; no es `open-wa/wa-automate-nodejs`. No se modificó ni incorporó su código en Nexo. Fijá y verificá la versión del gateway que despliegues: las referencias `main` pueden cambiar.

Fuentes primarias consultadas:

- [OpenAPI](https://github.com/rmyndharis/OpenWA/blob/main/openapi.json).
- [IncomingMessage](https://github.com/rmyndharis/OpenWA/blob/main/src/engine/interfaces/whatsapp-engine.interface.ts) y [proyección del mensaje recibido](https://github.com/rmyndharis/OpenWA/blob/main/src/modules/session/message-projector.service.ts).
- [Firmas HMAC](https://github.com/rmyndharis/OpenWA/blob/main/docs/examples/webhook-signature-verification.md).
- [Responses y Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Endpoints usados

Todas las llamadas al gateway llevan `X-API-Key` y no siguen redirects. Las consultas normales tienen timeout de 12 segundos; iniciar y detener una sesión admiten 45 segundos. El operador autoriza sus orígenes mediante `OPENWA_ALLOWED_ORIGINS`; por defecto sólo se permite `OPENWA_BASE_URL` (`http://localhost:2785`). El panel guarda un origen sin `/api`.

| Operación                       | Endpoint del gateway                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Estado                          | `GET /api/sessions/{sessionId}`                                                             |
| Detener sin desvincular         | `POST /api/sessions/{sessionId}/stop`                                                       |
| QR cuando status es qr_ready    | `GET /api/sessions/{sessionId}/qr`, campo `qrCode` como data URL PNG                        |
| Texto                           | `POST /api/sessions/{sessionId}/messages/send-text`, body `{chatId,text,linkPreview:false}` |
| Consultar suscripciones         | `GET /api/sessions/{sessionId}/webhooks`                                                    |
| Registrar webhook               | `POST /api/sessions/{sessionId}/webhooks`                                                   |
| Actualizar coincidencia por URL | `PUT /api/sessions/{sessionId}/webhooks/{id}`                                               |
| Medio omitido del webhook       | `GET /api/sessions/{sessionId}/messages/{chatId}/{messageId}/media`                         |

El UUID de sesión se crea/inicia desde el gateway; Nexo registra una sesión existente. El panel consulta estado real y muestra QR si corresponde. Registrar sesión o guardar claves no implica conectividad verificada. `CONNECTED` en la base guarda el último estado consultado o una entrada firmada. El panel consulta `/api/connections/live-status` periódicamente y muestra “No se puede comprobar” si el gateway no responde. La instalación local usa `AUTO_START_SESSIONS=true` para recuperar al arrancar las sesiones ya vinculadas; un QR sólo hace falta si WhatsApp pide vincularlas otra vez. Las conversaciones históricas se filtran por sesión sin borrarse.

**Desconectar** en el panel detiene esa sesión mediante `POST /stop`: deja de recibir y enviar, pero conserva el vínculo y los chats. OpenWA registra la parada para que el arranque automático no la reactive. **Mostrar QR** la puede volver a iniciar cuando el administrador lo decida. No se usa `POST /logout`, que sí desvincularía el teléfono.

El envío usa un `Idempotency-Key` estable (ID de la fila de salida) y exige `messageId` en la respuesta. Un 201/SENT significa aceptación por el adaptador, **no entrega ni lectura en el teléfono**. Los fallos ambiguos pasan a `NEEDS_REVIEW` con notificación interna y no se reenvían automáticamente. Hay que reconciliar con el gateway antes de reenviar manualmente. No se reintenta un envío pendiente después de 23 horas, dentro del límite de deduplicación documentado de 24 h del gateway.

## Webhook de entrada

`POST /api/webhooks/openwa/:workspaceId` no usa JWT. Exige `X-OpenWA-Signature: sha256=<hex>` calculado sobre el cuerpo exacto con el secreto de ese negocio; la comparación usa tiempo constante. Se verifica además que el UUID pertenezca a una conexión OPENWA del mismo negocio. El antiguo endpoint sin workspace ya no se usa.

Formato de `message.received`, según la interfaz y el código del gateway:

```json
{
  "event": "message.received",
  "timestamp": "2026-10-20T12:00:00.000Z",
  "sessionId": "UUID-de-la-sesion",
  "idempotencyKey": "clave-estable-del-evento",
  "deliveryId": "id-del-intento",
  "data": {
    "id": "id-estable-del-mensaje",
    "chatId": "5491100000000@c.us",
    "from": "5491100000000@c.us",
    "to": "5491100000001@c.us",
    "body": "Hola, me interesa CURSOIA",
    "type": "chat",
    "timestamp": 1792497600,
    "fromMe": false,
    "isGroup": false
  }
}
```

Este ejemplo es ilustrativo, no una captura real. El normalizador admite `chat`/`text`, `image` y `document`. Ignora mensajes propios, grupos, broadcasts y tipos no soportados con respuesta explícita `{ignored:true}`. Conserva el `chatId` para responder, incluidos IDs `@lid`; no los transforma en teléfonos. Los metadatos de anuncios no se inventan: para la prueba real usá el código de campaña en el texto.

La entrada válida se confirma con **202 sólo después de persistirla** en `WebhookInbox`. Se deduplica por negocio, conexión, evento y `data.id` (independiente de deliveryId o múltiples suscripciones). Un worker recupera entradas pendientes tras reinicio, reclama cada evento con lease de 120 segundos y procesa en orden por negocio. Una falla reintenta hasta 5 veces con espera creciente; después aparece FAILED en el panel con opción de reintento y notificación. La idempotencia del motor de ventas evita repetir respuestas si el proceso cae después de guardar una conversación y antes de cerrar el evento.

Se registran `message.received`, `session.status` y `session.disconnected`. Los eventos de sesión disparan consulta del estado actual para evitar aplicar una notificación vieja. La firma no lleva un timestamp separado; no se inventa un header. Replays de mensajes ya procesados no crean nuevos mensajes/ventas.

## Comprobantes y pagos

Se usa `data.media.data` en base64 si está presente; si el medio está omitido se consulta el endpoint de medios del mismo gateway y sesión. Nunca se descarga una URL enviada dentro del mensaje. Se limita a 8 MB y se valida la firma binaria PDF/PNG/JPEG antes de guardar un archivo privado.

El archivo entra en el flujo existente: comprobante PENDING, conversación REVIEW pausada, notificación y revisión humana. No hay OCR ni aprobación automática. Un archivo no disponible o no soportado deriva a HUMAN y no crea un pago aprobado. La aprobación sigue exigiendo cotización y archivo de entrega. El enlace de descarga usa la URL pública configurada para ese negocio.

El payload original se elimina del inbox al completar el procesamiento; se mantiene la clave de deduplicación y los datos necesarios en mensajes/archivos. Los eventos fallidos conservan el payload para reintentar; la política de retención global queda pendiente.

## Preparación y diagnóstico

El recorrido de configuración está en el [README](../README.md#conectar-whatsapp-de-prueba-y-openai-sin-docker). `npm run dev:local` usa la base PGlite existente y permite configuración real. `npm run dev:demo` fuerza simulación. Se puede seguir usando el simulador con conexiones MOCK incluso cuando se habilita OpenWA.

La API local escucha en `127.0.0.1:3001`. Un túnel puede apuntar a ella; para acceso directo por LAN configurá `HOST` y el acceso de red correspondiente. La URL guardada en el panel debe ser alcanzable desde OpenWA y desde el teléfono; **localhost se refiere a la máquina donde corre el cliente**. Si OpenWA rechaza una URL privada por su protección de red, usá un destino HTTPS público válido conforme a su configuración. Los links y webhooks no pasan por el servidor Vite.

| Síntoma                      | Revisar                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Webhook 401                  | Firma, secreto por negocio y cuerpo sin modificaciones; volver a registrar tras rotar secreto |
| Webhook 403                  | UUID de sesión y workspace en el destino                                                      |
| Webhook 409                  | OpenWA habilitado y proceso `dev:local`, no `dev:demo`                                        |
| No llega ningún evento       | Suscripción activa, URL alcanzable, sesión vinculada, mensaje de otro teléfono                |
| FAILED                       | Clave, disponibilidad del gateway/base; corregir y reintentar desde el panel                  |
| OpenAI falla con 401/403     | API key y permisos del proyecto/modelo                                                        |
| OpenAI falla con 429         | Cuota, saldo o límites de la cuenta                                                           |
| Mensaje marcado NEEDS_REVIEW | Comparar historial del gateway antes de responder manualmente                                 |
| La IA no usa PDF             | Producto identificado por código y modo AUTO; PDF con texto extraíble; OpenAI habilitado      |
| Descarga no abre en teléfono | URL pública de Nexo correcta, archivo de entrega, pago aprobado y token vigente               |

La IA selecciona IDs de texto aprobado mediante Responses API. Estricto evita llamadas al modelo; flexible usa respuestas aprobadas; automático agrega fragmentos de PDFs y campos del producto. Los errores o IDs inválidos conservan el fallback determinista, nunca se envía redacción inventada del modelo. El botón Probar OpenAI comprueba credenciales/modelo en una solicitud independiente, no confirma la calidad de todas las respuestas.

## Alcance de verificación

Las pruebas ejecutan Prisma, migraciones y PGlite reales, Fastify y el SDK de OpenAI contra servidores HTTP de contrato controlados. Cubren recepción, persistencia, firma, aislamiento, reinicio, deduplicación, medios, modos, solicitudes de Responses, envío, errores y pagos. **No hay evidencia de conversación con un número real ni de una llamada a OpenAI con credenciales reales hasta completar la prueba manual.**

Para la primera conexión usá un número dedicado de prueba. OpenWA documenta los riesgos de una conexión no oficial y posibles restricciones de cuenta en su [README](https://github.com/rmyndharis/OpenWA). Para un despliegue SaaS se mantiene pendiente validar PostgreSQL con múltiples procesos, operación HTTPS/backups y separar llamadas externas del bloqueo por negocio.
