# Atención humana y entrega manual — 13/11/2026

Corrección del formato real del anuncio: el gateway instalado registra el saludo «¡Hola! ¿Cómo podemos ayudarte?» con `type: unknown`, no `text`. La excepción de texto exacto configurada por negocio admite ahora `text`, `chat` y `unknown`; no ignora mensajes desconocidos en general. Se agregó una regresión con webhook firmado `message.sent` de tipo `unknown`, activación posterior del producto y toma de control por un mensaje distinto. Suite: 83/83. Se verificó el tipo consultando el mensaje concreto en el gateway y se identificó el chat de la captura resolviendo su LID. Se reactivó sólo ese chat, cuyo único mensaje propio era el saludo; no se reenviaron mensajes ni se reactivaron chats con intervenciones humanas posteriores.

Actualización del saludo automático: los eventos propios del gateway también incluyen saludos de WhatsApp Business/anuncios. Se agregó `automaticOwnMessages` por negocio en la configuración cifrada de integraciones. Sólo los textos completos explícitamente configurados, comparados después de recortar espacios exteriores y normalizar Unicode NFC, se registran como `EXTERNAL_AUTO` sin tomar control. Una coincidencia no reactiva un chat que ya estaba atendido por una persona. Un texto distinto sigue tomando control normalmente. Si una persona escribe manualmente un texto idéntico al configurado, tampoco activa la pausa; puede usar «Tomar control».

Se configuró el saludo confirmado «¡Hola! ¿Cómo podemos ayudarte?» en el negocio afectado y se reactivó únicamente el chat cuya intervención registrada era ese saludo. No se reenviaron mensajes ni se reprodujo el mensaje entrante. La frase de calendarios, incluido su emoji, coincide correctamente con la campaña. Suite actualizada: 82/82 pruebas; compilación correcta y servicios locales HTTP 200. Reactivar o tomar control sin texto ya no invoca el despachador de mensajes desde esa ruta.

Cuando una persona responde desde el panel o desde el WhatsApp vinculado, Nexo toma esa intervención como control humano de la conversación. Se muestra «Atendida por vos · agente en silencio».

## Comportamiento

- Se cancelan los mensajes automáticos y entregas anteriores que todavía estaban pendientes. Los mensajes redactados por una persona se conservan.
- Antes de despachar cada respuesta automática se comprueba otra vez el control humano. Una conversación atendida por una persona no recibe respuestas automáticas, recordatorios ni entregas por análisis automático del comprobante.
- Se siguen registrando mensajes y comprobantes entrantes, sin contestarle automáticamente al cliente. Los avisos internos al administrador siguen disponibles.
- La intervención no vence por tiempo. «Reactivar agente» requiere una acción explícita. Durante revisión de pago no se permite reactivar; sí se puede tomar control durante una revisión todavía automática. Desde el 14/11/2026, después de una venta completada se puede liberar el control humano, pero se espera una nueva activación de un curso habilitado antes de volver a responder. Ver `CURSOS-ATENDIDOS.md`.
- Si la persona rechaza un comprobante mientras atiende el chat, se registra el rechazo y se conserva el silencio del agente.

## Aprobar un pago

**Aprobar y enviar curso:** registra el pago y encola una sola entrega. Es una autorización explícita de envío, incluso si la conversación está atendida por una persona.

**Aprobar: ya lo entregué:** registra el pago y la entrega manual, sin crear mensajes ni enlaces nuevos de descarga. No exige subir un archivo de entrega si ya se entregó por fuera, pero conserva las comprobaciones de producto, cotización y comprobante. Si falta la cotización, hay que seleccionar el producto/pack correspondiente.

Las aprobaciones repetidas con la misma modalidad son idempotentes. Intentar cambiar la modalidad de un pago ya aprobado devuelve un conflicto; no provoca un segundo envío.

En los avisos de WhatsApp al administrador:

- `APROBAR <pago>.<archivo>` aprueba y envía el curso.
- `ENTREGADO <pago>.<archivo>` aprueba y registra la entrega manual sin reenvío al cliente.
- `RECHAZAR <pago>.<archivo> <motivo>` registra el rechazo; si hay control humano no responde al cliente.

Hay que copiar el código completo del aviso vigente. Se conserva el rechazo de decisiones sobre un comprobante reemplazado.

## Implementación

- `Conversation.humanControlled` separa la atención humana de la pausa técnica por revisión de pago.
- `Message.origin` distingue respuestas automáticas, mensajes humanos y envíos de pago expresamente autorizados.
- `Payment.deliveryMode` registra `SEND` o `ALREADY_DELIVERED`; los pagos históricos sin esta información no se reinterpretan.
- `sales/human-control.ts` centraliza la pausa y cancelación de pendientes.
- `SalesService.observeOwnMessage` registra mensajes propios del teléfono. El webhook firmado `message.sent` se atiende al ingresar, sin esperar el siguiente ciclo del worker; también se acepta `message.received` con `fromMe` por compatibilidad.
- Los identificadores de WhatsApp se comparan con `providerMessageId` en la misma sesión y negocio. La comparación usa el mismo bloqueo transaccional del envío, de modo que un eco temprano del sistema espera a que se registre su identificador. Los eventos repetidos no vuelven a pausar una conversación ya reactivada.
- La revisión automática comprueba el control humano tanto al iniciar como antes de aprobar. Un resultado de IA que llega después de una intervención no habilita la entrega.
- La migración `202611130001_human_control` agrega los campos, reconoce pausas humanas anteriores del panel y cancela sus pendientes automáticos. No elimina conversaciones, pagos ni archivos.

## Verificación y activación local

- Suite completa con bases efímeras y proveedores ficticios: 80 pruebas correctas.
- Compilación de API y web correcta. Revisión visual de acciones, confirmación y estado final de entrega manual en escritorio y móvil con datos ficticios; sin errores de consola observados.
- Regresiones de intervención desde panel/teléfono, mensajes propios antes de crear un chat, audio, duplicados, eco temprano del bot, cancelación de cola, reactivación explícita, recepción silenciosa de comprobantes, carrera con análisis automático, ambas modalidades de entrega y comando `ENTREGADO` firmado.
- Copia fría de la base local guardada fuera del repositorio antes del reinicio. Migración aplicada al arrancar PGlite y modelos comprobados mediante la API autenticada.
- Se actualizaron cuatro suscripciones existentes del gateway para recibir `message.sent`. Una conexión histórica marcada `FAILED` corresponde a una sesión inexistente (404); se conservó sin recrearla.
- `scripts/upgrade-human-control.ts` permite repetir la actualización local de suscripciones mediante la API normal, sin imprimir credenciales ni enviar mensajes.

## Límites concretos

Un envío que el gateway ya aceptó antes de recibir/procesar la intervención humana no puede retirarse con esta pausa. Se cancelan los pendientes y se frenan los siguientes envíos. La detección desde el teléfono depende de que el gateway entregue el evento firmado; el panel permite tomar control directamente sin depender de ese evento.

Si un envío falla de forma ambigua y no devuelve identificador, no se deduce por similitud de texto que un eco pertenezca al bot: se mantiene una conducta conservadora y el envío queda sujeto a revisión. No se hizo una prueba con mensajes a teléfonos reales. La mejora no cambia el reconocimiento de intenciones del vendedor.

Estado final: panel (5173), API y base (3001/health) y gateway (2785) verificados con HTTP 200. API autenticada correcta; cuatro suscripciones actualizadas, una sesión histórica inexistente conservada y cero errores en las suscripciones válidas. Fue necesario reiniciar el worker de PGlite para recuperar la conexión; se conservaron los datos.

