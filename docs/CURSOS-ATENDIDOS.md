# Cursos atendidos por Nexo — 14/11/2026

En **Producto y agente → Gestionar producto → Lo esencial**, el interruptor **Atendido por Nexo** habilita o deshabilita la atención automática. Hay que guardar el producto. Desactivarlo conserva el curso, sus archivos y las ventas; no equivale a eliminarlo.

## Comportamiento

- La atención empieza con un nombre de curso inequívoco, una frase específica configurada o un anuncio vinculado a ese curso. El curso debe existir, no estar eliminado y tener habilitada la atención.
- Palabras y frases genéricas como «precio», «comprar» o «hola quiero más información» no activan un curso por sí solas. Dentro de una conversación ya identificada se interpretan normalmente.
- Los mensajes y archivos de chats sin curso habilitado quedan en la bandeja, sin respuesta automática, creación de pago ni análisis de comprobantes. Tampoco se manda el aviso de archivo no descargable en esos chats.
- Una referencia a un curso deshabilitado, a un anuncio desconocido sin referencia de curso válida, o una consulta explícita «curso de …» no reconocida deja la conversación fuera de Nexo. Se cancelan las respuestas de venta pendientes y se descarta la cotización anterior. Una nueva activación válida puede iniciar otra venta.
- Cambiar a otro curso habilitado limpia el pack, la cotización y el mensaje de entrega seleccionados. Un archivo no puede iniciar ni cambiar de curso usando una cotización anterior.
- Una venta terminada permanece en silencio ante mensajes genéricos; una nueva consulta que identifica un curso habilitado puede iniciar otra venta. No se reenvía la entrega anterior.
- La intervención humana tiene prioridad y no vence automáticamente. Después de una venta completada se puede liberar expresamente el control humano con **Reactivar agente**, sin reabrir la venta aprobada ni enviar mensajes: se espera una nueva activación. Durante revisión de pago no se permite reactivar.
- Desactivar la atención cancela respuestas automáticas pendientes y bloquea nuevos análisis y aprobaciones automáticas, incluso si se desactiva durante el análisis. Los mensajes humanos y las decisiones manuales explícitas conservan su flujo.

## Límites

El reconocimiento utiliza nombres, frases y anuncios configurados; no es una clasificación semántica universal. Un mensaje ambiguo como «precio» no permite descubrir por sí solo que el cliente cambió de curso: si ya había una venta activa, se usa ese contexto. Configurá frases específicas y tomá el control cuando atiendas otra venta. Un envío que WhatsApp ya aceptó no se puede retirar.

En un curso identificado, un archivo sin cotización todavía puede registrarse para revisión manual, pero no puede aprobarse automáticamente sin los controles de pago existentes. Los archivos de chats no identificados se conservan en la conversación sin crear un pago.

## Implementación

`Product.agentEnabled` es independiente del indicador `active`, que ya se usaba para la eliminación lógica. La migración `202611140001_course_scope` conserva habilitados los productos existentes. `sales/course-scope.ts` centraliza el reconocimiento, y las restricciones se comprueban al recibir, despachar y verificar pagos. No se reactivan conversaciones humanas ni se reproducen mensajes históricos al instalar el cambio.

Validación: 95 pruebas correctas con bases efímeras y proveedores simulados; compilación de API y web correcta. Se guardó una copia de la base local detenida antes de migrar. Después del arranque se verificaron panel, API/base y gateway con HTTP 200, y la API autenticada expuso el interruptor en los seis productos existentes. No se enviaron mensajes de prueba a clientes ni se cambiaron sus estados desde herramientas de diagnóstico.
