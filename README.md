# Nexo · Vendedores para WhatsApp

## Revisión de comprobantes

### Revisión automática de comprobantes

En **Producto y agente → Venta → Revisión del comprobante**, cada producto puede elegir entre **Yo apruebo cada pago** (valor inicial) y **Entregar si la IA lee un comprobante compatible**. La segunda opción usa la clave OpenAI configurada para ese negocio, lee PDF/JPG/PNG y compara tipo de documento, estado completado, importe, moneda, alias del destinatario, fecha e ID de operación. Guarda el resultado en Pagos y evita reutilizar el mismo ID o archivo en el negocio. Si falta un dato, la IA falla o no hay clave, el comprobante queda pendiente para aprobación humana. Los pagos manuales y el aviso por WhatsApp siguen disponibles. En **Configuración → Conexiones avanzadas → Probar lectura de comprobante** se puede subir un archivo de muestra sin crear una venta ni entregar nada.

**Riesgo elegido por el administrador:** esta opción valida la apariencia y los datos del comprobante, pero no confirma que el dinero se haya acreditado. Un comprobante falso suficientemente convincente puede liberar el curso. Activala únicamente en los productos donde aceptes ese riesgo. Los productos existentes conservan revisión manual hasta que la cambies.

La transferencia sigue yendo al alias configurado. Cada producto conserva su elección entre revisión humana y lectura automática del comprobante.

**Instalación Windows preparada:** abrí `Iniciar Nexo y WhatsApp.cmd`. OpenWA está instalado por separado y conectado al panel. Cada teléfono se vincula desde WhatsApp mediante su QR. Instrucciones en [Inicio Windows](docs/INICIO-WINDOWS.md).

MVP SaaS multiempresa, independiente de EasyLeads. React + Vite + Tailwind, Fastify + TypeScript, PostgreSQL + Prisma. Sin n8n. Incluye simulador y conectores HTTP para OpenWA y OpenAI Responses API. **Se verificaron el gateway OpenWA instalado, su webhook firmado y la generación de QR; falta vincular un teléfono y configurar una clave real de OpenAI para probar una conversación.**

Los íconos de la interfaz son [Solar Icons](https://solar-icons.dev/), diseñados por 480 Design y distribuidos bajo CC BY 4.0 mediante `@solar-icons/react`.

## Probar ahora, sin Docker ni claves de IA

Requiere Node.js 22 y npm.

```sh
npm ci
npm run db:generate
npm run dev:demo
```

Abrí [localhost:5173](http://localhost:5173). La terminal muestra el correo y la contraseña aleatoria local. También se guardan en `.data/demo-secrets.json`, ignorado por Git. La demo usa **PGlite (PostgreSQL embebido), Prisma y archivos persistentes en `.data/`**. Es una alternativa sólo de desarrollo para equipos sin Docker; no es el despliegue SaaS ni una prueba de concurrencia multiproceso de PostgreSQL.

La demo crea un negocio, un producto, dos respuestas obligatorias, una campaña con código `CURSOIA` y una conexión simulada. No agrega ventas, clientes ni métricas ficticias. Los datos de transferencia del seed están rotulados como demostración.

### Recorrido completo

1. Productos → Gestionar producto → Archivos: subí un PDF de conocimiento y un archivo PDF, PNG o JPG de entrega digital (máximo 8 MB).
2. Agente y respuestas: editá las respuestas exactas y los hooks/CTA del producto. Guardá cada sección.
3. Conversaciones → Nueva prueba: enviá `Hola, me interesa CURSOIA`.
4. Preguntá `¿Necesito experiencia previa?`: se envía la respuesta obligatoria exacta.
5. Escribí `quiero comprar`: el agente guarda la cotización y comparte el alias configurado.
6. Adjuntá una imagen o PDF como comprobante. El archivo es privado, se crea una notificación en el panel y el agente queda pausado.
7. Pagos: descargá el comprobante. Para aprobar, confirmá que la transferencia llegó a tu cuenta. Si el cliente envió el comprobante antes de elegir, seleccioná el producto y el pack correspondiente; Nexo mostrará el importe esperado. Un rechazo solicita un nuevo archivo. **No hagas transferencias reales en la demo.**
8. La entrega configurada para el pack se envía al aprobar. Si el producto entrega un archivo, el enlace de descarga dura 24 horas. No se permite aprobar sin cotización y entrega configurada.
9. En otra conversación, escribí `humano`: se pausa el agente. El administrador puede responder y reactivarlo desde la bandeja.

## Conectar WhatsApp de prueba y OpenAI sin Docker

1. Detené el demo anterior e iniciá `npm run dev:local`. Usa la misma base persistente PGlite, usuarios y archivos. Aplica la migración adicional sin resetear datos. `npm run dev:demo` sigue forzando simulación, aunque existan claves guardadas.
2. Usá un gateway **[rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA)** instalado por separado, con una versión fijada. Necesitás su URL, API key y UUID de una sesión creada e iniciada en su panel. Esta integración no usa `open-wa/wa-automate-nodejs`.
3. Si el gateway no está en `http://localhost:2785`, configurá su origen en `OPENWA_ALLOWED_ORIGINS` en `.env` y reiniciá Nexo. Ejemplo: `OPENWA_ALLOWED_ORIGINS=https://wa.tudominio.com`. El origen no incluye `/api`. No hay que instalar Docker para Nexo; el gateway es un servicio independiente.
4. Abrí **Configuración → Conexiones avanzadas**. Los campos de URL, clave de OpenWA y dirección pública de la API Nexo están en **Configuración técnica**. La URL de API debe ser accesible desde OpenWA y desde el teléfono para descargar entregas. La pantalla principal no pide configurar el secreto HMAC: Nexo lo genera y conserva.
5. En la misma pantalla seleccioná **OpenAI**, ingresá una API key de proyecto con acceso y saldo y guardá. El modelo (`gpt-4.1-mini` por defecto) está en **Configuración técnica**. **Probar OpenAI** hace una llamada real, puede generar consumo y muestra éxito o fallo. Guardar una clave por sí solo no verifica la conexión.
6. Entrá en **WhatsApp** para ver qué número está conectado. En **Configuración → Conexiones avanzadas**, tocá **Mostrar QR** en la sesión que querés vincular y escanealo desde WhatsApp → Dispositivos vinculados. El QR aparece sólo cuando OpenWA lo solicita.
7. Al crear una sesión, Nexo registra la recepción de mensajes automáticamente. Si deja de recibir, abrí **Solucionar problemas → Reparar recepción** en esa sesión. No hace falta copiar el destino del webhook ni el secreto HMAC.
8. Configurá el producto, PDF de conocimiento, respuestas, hook/CTA, alias y archivo de entrega. Elegí **Automático** para consultar el PDF; **Flexible** para selección semántica de respuestas aprobadas; **Estricto** para respuestas informativas exactas. Si OpenAI está activo, la interpretación de la elección de packs usa IA en los tres modos; los precios y las entregas siempre se leen del producto configurado.
9. Desde **otro teléfono**, enviá `Hola, me interesa CURSOIA` al número vinculado (o el código de tu campaña). Preguntá algo del PDF. Verificá el evento `DONE`, los mensajes en Conversaciones y la respuesta en el teléfono. El trabajador local revisa entradas/salidas cada 5 segundos; una cola grande aumenta la demora.
10. Escribí `quiero comprar`, adjuntá un PDF/PNG/JPEG de prueba y comprobá el resultado en Pagos. Si el producto usa revisión humana, aprobá sólo después de comprobar el dinero en tu cuenta. Si usa lectura automática, Nexo puede entregar según los datos del comprobante sin confirmar la acreditación. No es necesario transferir dinero para probar el recorrido técnico.

Las claves se cifran con AES-256-GCM y contexto por negocio, y nunca se devuelven al panel. Se usa `CREDENTIALS_KEY` o, si está vacío, el JWT secreto estable (`.data/demo-secrets.json` en PGlite). Conservá esa clave con los backups y no la cambies sin migrar credenciales. Las antiguas variables `OPENAI_API_KEY`/`OPENWA_API_KEY` no se comparten automáticamente entre negocios; ingresalas explícitamente en la pantalla. Más detalles y diagnóstico en [docs/openwa.md](docs/openwa.md).

## Desarrollo con PostgreSQL y Docker Compose

```sh
# PowerShell: Copy-Item .env.example .env
cp .env.example .env
# Editá JWT_SECRET (32+ caracteres), ADMIN_EMAIL y ADMIN_PASSWORD (12+).
docker compose up --build
```

Panel: [localhost:5173](http://localhost:5173). API: [localhost:3001/health](http://localhost:3001/health).

Compose levanta PostgreSQL 16, aplica la migración inicial, crea el seed y arranca API + Vite. Los puertos se publican sólo en loopback. `postgres_data` y `private_files` son volúmenes persistentes. El contenedor de aplicación corre como usuario `node`. Es una configuración de **desarrollo**, no de producción. Nunca ejecutes `docker compose down -v` si querés conservar datos.

Para ejecutar API/frontend fuera de los contenedores:

```sh
docker compose up -d postgres
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

El seed no cambia contraseñas existentes ni vuelve a llenar un negocio existente. Sólo el administrador de plataforma configurado en `ADMIN_EMAIL` puede crear cuentas y negocios. Los nuevos negocios comienzan vacíos. El login limita los intentos por correo normalizado; el resto de las solicitudes autenticadas se limita por usuario, sin confiar en cabeceras de IP enviadas por el cliente.

## Qué funciona

- La cuenta de administración configurada mediante `ADMIN_EMAIL` puede crear cuentas y negocios independientes desde **Cuentas**. Cada usuario inicia sesión con su correo y contraseña y accede a sus propios negocios; el administrador también puede seleccionar los negocios que creó. Cada negocio debe configurar sus propias integraciones. En desarrollo local el administrador es `admin@nexo.local`.
- Con `OPENWA_MANAGED_ADMIN_KEY` configurada en el servidor, cada cuenta nueva intenta preparar una sesión OpenWA y una clave de operador limitada a esa sesión. El QR lo escanea la persona; ninguna cuenta se vincula automáticamente. Si falla, se conserva la cuenta y se puede reintentar desde Configuración → Conexiones avanzadas. En Windows local, `dev:local` carga la clave de administración desde el archivo privado de OpenWA. Las cuentas existentes y sus claves no se modifican.
- Login con contraseña hasheada con scrypt; JWT de ocho horas; permisos ADMIN/VIEWER y pertenencia verificada en cada operación.
- Catálogo: alta, edición y baja lógica, precios en centavos y moneda, beneficios, descripción, hooks, CTA, objeciones y modos por producto.
- Editor visual de preguntas/respuestas obligatorias. Coincidencia exacta normalizada, con prioridad sobre IA e intención de compra.
- PDFs privados con extracción de texto; rechazo de PDFs escaneados sin texto. El conocimiento puede seleccionarse en modo automático con OpenAI.
- Múltiples conexiones simuladas por negocio, identificación por códigos de campaña, historial y estados persistentes.
- Flujo de compra, cotización congelada por pago, recepción privada de comprobantes, pausa, notificaciones internas y revisión manual con autor/fecha/motivo.
- Entrega mediante token aleatorio de 256 bits, hash en base de datos, vencimiento de 24 horas y comprobación de pago aprobado.
- Idempotencia persistente de entradas; transacciones y bloqueo por negocio; bandeja de salida persistente recuperable tras reinicio.
- OpenWA: consulta de estado/QR, registro de webhook firmado, recepción persistente, deduplicación, medios privados y envío con `Idempotency-Key`. Configuración cifrada por negocio. El gateway instalado se verificó con estado, QR y webhook reales; el envío a un teléfono espera su vinculación autorizada.
- Contrato de mensajería intercambiable y feed de eventos versionados para una futura integración EasyLeads. No se modificó ni integró su repositorio.

## IA y límites deliberados

Por defecto cada negocio usa reglas: **no hay llamadas a OpenAI**. Habilitá Responses API y guardá su clave/modelo en **API e integraciones**, con `dev:local` (PGlite) o el servidor PostgreSQL normal. `dev:demo` fuerza reglas y WhatsApp simulado incluso si hay credenciales guardadas.

El modo estricto usa respuestas exactas y datos comerciales deterministas. El flexible selecciona respuestas aprobadas con sus preguntas como contexto. El automático también puede seleccionar fragmentos de conocimiento, descripción, beneficios, objeciones, hook y CTA. Se priorizan hasta 12 fragmentos de los PDFs mediante coincidencias de términos; no hay embeddings ni indexación vectorial. El SDK usa Responses API con salida estructurada y `store:false`. El texto relevante del PDF y el historial reciente se envían a OpenAI cuando está habilitado.

La IA sólo devuelve IDs de hechos; el servidor verifica esos IDs y envía el texto aprobado. **No se envía redacción libre del modelo.** Esto impide inventar números o condiciones en esta versión, a cambio de menor fluidez. El administrador es responsable de mantener correctos los textos y documentos aprobados. Ante error de OpenAI o falta de credenciales se usa una respuesta determinista. Sin OpenAI, los PDFs se almacenan y extraen, pero la búsqueda semántica no se ejecuta.

## Verificación

Actualización de contactos (21/10/2026): la bandeja separa WhatsApp y Simulador. Los contactos se registran al recibir su primer mensaje, sin importar toda la agenda. Se guardan nombre y teléfono cuando OpenWA los proporciona; el identificador `@lid` se conserva para enviar respuestas y nunca se interpreta como teléfono. Para contactos nuevos, la consulta opcional usa los endpoints verificados `GET /api/sessions/{sessionId}/contacts/{contactId}` y `GET /api/sessions/{sessionId}/contacts/{contactId}/phone`. Si no hay número disponible, se muestra esa condición sin bloquear la conversación. La migración es aditiva y conserva PGlite.

En esta corrección pasaron las 27 pruebas y el build. Se verificó visualmente la separación de canales y se recuperaron nombre y teléfono del contacto real ya recibido. Se conservaron las 2 conversaciones y los 12 mensajes existentes. Esto no verifica por sí solo una llamada nueva a OpenAI ni la entrega de un mensaje nuevo a otro teléfono.

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Las pruebas usan una base PostgreSQL embebida temporal, la migración SQL real y el cliente Prisma real, sin mocks del repositorio. Cubren aislamiento, concurrencia de solicitudes, entradas duplicadas, precedencia de respuestas, selección de hechos, PDFs, aprobación/rechazo, entrega privada, vencimiento, derivación y firma HMAC.

Para comprobar bloqueo y pooling en PostgreSQL 16 real, prepará una **base exclusiva de pruebas**, aplicá las migraciones y definí `TEST_DATABASE_URL` antes de `npm test`. El workflow `.github/workflows/ci.yml` ya contiene ese servicio. No apunta a una base de producción y no borra tablas existentes. El workflow queda preparado; no se ejecutó remotamente en esta entrega.

En esta actualización se verificaron tipos, build, 24 pruebas con PGlite y contratos HTTP locales, y el arranque de la API conservando los datos. La inspección visual de la pantalla nueva no pudo realizarse porque el navegador local está deshabilitado en Work. Docker no está instalado, por lo que **Compose no pudo ejecutarse aquí**. Tampoco se probaron llamadas reales a OpenAI ni un número real de WhatsApp.

## Pendiente antes de conectar un negocio real

- Completar una prueba con credenciales reales y dos teléfonos; la implementación y las pruebas de contrato no reemplazan la verificación de la versión de gateway instalada. Ver [OpenWA](docs/openwa.md).
- Validar conectividad real, versión fijada del gateway, eventos/medios de muestra y despliegue PostgreSQL. No habilitar campañas reales hasta terminar ese recorrido.
- Provisionar sesiones OpenWA desde la UI, migración Meta Cloud API, sincronización Meta Ads, OCR, enlaces de entrega renovables, más tipos de archivos y RAG con recuperación por relevancia en documentos grandes.
- Invitaciones, recuperación y cambio de contraseña, gestión de baja de cuentas, auditoría de todos los cambios administrativos, retención y eliminación de archivos huérfanos, escaneo antimalware y operación con HTTPS, backups, métricas y límites distribuidos.
- La bandeja muestra hasta 200 conversaciones y cada chat hasta 500 mensajes; falta paginación UI. Las notificaciones son internas, no email/push.
- Producción: dividir el bloqueo por conversación y mover llamadas lentas fuera de transacciones. El bloqueo por workspace prioriza corrección para el MVP y limita el throughput de cada negocio.
- La preparación automática de WhatsApp actualmente se coordina dentro de un único proceso de API. Usar una sola instancia; antes de habilitar varias réplicas se necesita coordinación entre procesos y recuperación de resultados ambiguos. Cada negocio preparado automáticamente tiene una sesión; agregar más números requiere ampliar el flujo de claves limitadas.
- Para Railway, guardar `OPENWA_MANAGED_ADMIN_KEY` como secreto del servicio API, configurar la URL privada de OpenWA y una URL pública HTTPS de Nexo, PostgreSQL y almacenamiento persistente. El Dockerfile y Vite actuales son de desarrollo y no constituyen un despliegue completo del panel. Verificar migración, copias de seguridad y conectividad antes de publicar.

## Mapa del código

```text
apps/api/src/         rutas, autenticación, venta, almacenamiento y adaptadores
apps/api/test/        pruebas de integración y contratos
apps/web/src/         panel React y cliente HTTP
packages/database/   esquema Prisma, migración PostgreSQL y seed
scripts/             base y arranque de demo local
docs/                decisiones, contrato EasyLeads y documentación OpenWA
```

Los secretos sólo se leen en el backend. No se usa ninguna variable `VITE_*` para credenciales. No se versionan archivos privados, contraseñas de demo ni bases de datos.
