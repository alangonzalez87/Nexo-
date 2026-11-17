# Nexo en Railway: imagen de prueba aislada

Esta imagen es **solo para pruebas**. No usar con una base, archivos, credenciales, sesiones o webhooks de producción. No despliega ni migra datos por sí misma. El panel funciona en modo de consulta: se permite iniciar sesión con un usuario que ya exista en la base de prueba, pero se bloquean las operaciones de escritura, incluidos pagos, envíos, simulador, registro de webhooks y cambios de configuración. No se crean usuarios automáticamente.

## Funcionamiento

- El Dockerfile instala dependencias de desarrollo explícitamente para que `tsx` esté disponible, genera el cliente Prisma y compila el frontend. Su comando final ejecuta `apps/api/src/preview-server.ts`; no ejecuta seed ni migraciones.
- Esa entrada fuerza `NEXO_PREVIEW=true`, `NEXO_REQUIRE_PREVIEW=true` y `FORCE_SIMULATION=true` antes de iniciar el servidor, incluso si el entorno suministra otros valores. Para producción real hará falta un diseño y una imagen independientes, no sobrescribir el comando de esta prueba.
- El worker no se inicia. La API bloquea métodos que pueden modificar datos salvo el inicio de sesión; también bloquea la consulta de estado de conexiones que puede actualizar la base. No se arrancan servicios OpenWA ni se aceptan webhooks. Las rutas de solo lectura permanecen protegidas por la autenticación existente.
- Fastify sirve el panel compilado y `/api` bajo el mismo origen. El endpoint `GET /health` no requiere autenticación y devuelve solo `{ "status": "ok" }` cuando puede ejecutar `SELECT 1`. Verifica conectividad, **no** confirma que existan tablas, un usuario, migraciones o que el sistema esté listo para producción.
- No se genera una cuenta inicial. Para entrar al panel, la base aislada debe tener el esquema y un usuario de prueba creados previamente mediante un procedimiento explícito y revisado. Esa preparación queda fuera de este cambio; una base PostgreSQL vacía no permite iniciar sesión aunque `/health` responda.

## Variables del servicio de prueba

Configurar en Railway sin poner valores secretos en Git ni en capturas:

| Variable | Requisito |
| --- | --- |
| `DATABASE_URL` | Obligatoria para `/health` y la API. Debe apuntar a un PostgreSQL **exclusivo de pruebas**, sin datos reales. |
| `JWT_SECRET` | Obligatoria, aleatoria y exclusiva de prueba; mínimo 32 caracteres. |
| `CREDENTIALS_KEY` | Recomendable como clave distinta y estable para una futura configuración cifrada de prueba. No copiar la clave local ni credenciales reales. |
| `PUBLIC_URL` | URL HTTPS del servicio de prueba, sin barra final, si se inspeccionan URLs generadas. No registrar esa URL en el gateway real. |
| `WEB_ORIGIN` | Mismo origen HTTPS del panel de prueba. |
| `STORAGE_DIR` | Directorio persistente destinado solo a archivos ficticios, por ejemplo `/app/.data/private`; debe ser escribible por el usuario no privilegiado de la imagen. La prueba actual bloquea cargas y demás escrituras por API. |
| `ADMIN_EMAIL` | Opcional; habilita la identificación del administrador de plataforma existente. No crea el usuario. |
| `PORT` | Railway lo asigna; el servidor lo utiliza. |
| `HOST` | El Dockerfile define `0.0.0.0`. |

El Dockerfile fija `NEXO_WEB_DIST` y activa el modo aislado; el punto de entrada también lo fuerza. No configurar claves de OpenWA, OpenAI ni webhooks reales para esta prueba. El uso de volúmenes requiere revisar permisos, disponibilidad y costos del plan de Railway.

## Puesta en marcha futura, aún no realizada

1. Crear una base PostgreSQL aislada y un destino de archivos de prueba. No conectar la base ni el directorio de la demo local.
2. Preparar por separado el esquema y un usuario ficticio, tras revisar y autorizar ese procedimiento. Nunca ejecutar seed o migraciones de forma automática en el arranque.
3. Configurar las variables, construir la imagen y verificar `/health`, el panel, el inicio de sesión de prueba y el bloqueo de las operaciones prohibidas.
4. Mantener esta instalación separada de WhatsApp real y verificar el consumo y los límites de Railway.

El entorno no resuelve la migración PGlite → PostgreSQL, las rutas Windows de archivos existentes, el manejo de sesiones OpenWA, los respaldos ni la incidencia de confirmaciones de envío. Esos temas requieren trabajo y validación antes de atender clientes reales.
