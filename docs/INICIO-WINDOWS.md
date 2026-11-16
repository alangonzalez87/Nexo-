# Nexo y WhatsApp en esta computadora

La instalación local está preparada sin Docker.

## Abrir el sistema

Hacé doble clic en **Iniciar Nexo y WhatsApp.cmd**, dentro de la carpeta del proyecto. Esperá el mensaje «listo» y abrí [Nexo](http://localhost:5173). Podés cerrar esa ventana: los servicios siguen encendidos. Si ya estaban funcionando, el acceso no los duplica.

El acceso a Nexo mantiene el correo y la contraseña anteriores. No hace falta entrar al panel técnico de OpenWA para preparar el QR.

## Vinculación pendiente

No se vinculó ningún teléfono ni se usó un número personal. Antes de escanear el QR, confirmá que autorizás usar un número dedicado de prueba.

Una vez autorizado, el QR se obtiene desde **API e integraciones → WhatsApp de prueba → Preparar QR**. Si la sesión ya está esperando, **Consultar estado / QR** muestra el QR vigente. Si venció y la sesión se detuvo, **Preparar QR** vuelve a iniciarla. Estos botones no cierran una sesión ya conectada.

Para recibir respuestas de IA todavía hace falta ingresar una clave propia de OpenAI en la misma pantalla y probarla. El simulador continúa disponible.

## Qué está verificado

- Nexo y OpenWA están encendidos y responden.
- Nexo consulta la sesión real del gateway.
- OpenWA envió una prueba firmada al webhook de Nexo y recibió HTTP 200.
- La sesión real generó un QR y Nexo lo recibió con estado QR_READY.
- No había una cuenta vinculada al terminar esa comprobación.
- Las 24 pruebas de Nexo y la compilación pasaron.
- Se conservaron los productos, conversaciones y ventas anteriores.

Todavía no se probó enviar o recibir mensajes de un teléfono, porque no se vinculó una cuenta. Ambos servicios se comunican dentro de esta computadora; no hace falta un túnel para ese intercambio local. Los enlaces de entrega que abra un comprador desde su teléfono sí necesitarán después una dirección accesible desde ese teléfono. La computadora debe estar encendida para responder.

## Datos para mantenimiento

OpenWA está separado en `.data/openwa`, versión 0.25.0, commit `a3fc0ae4056c704eb51125e44b6511b79a69d4f2`, descargado del [repositorio indicado](https://github.com/rmyndharis/OpenWA). Usa Node portátil 22.23.3, Chromium aislado, SQLite propio y sin Redis ni Docker. Su compilación incluye una modificación local mínima para escuchar sólo en `127.0.0.1`; no se abrió el servicio a la red. La protección de destinos de webhooks permanece activa con `localhost` autorizado para Nexo.

El gateway queda en [localhost:2785](http://localhost:2785), con clave administrativa propia en `.data/openwa/data/.api-key`. Nexo usa una clave distinta de operador limitada a la sesión `nexo-prueba`; su copia en Nexo está cifrada. No compartas estos archivos de credenciales.

Nexo mantiene su PGlite original en `.data/demo-db`. El respaldo consistente anterior a la conexión está en `.data/backups/nexo-cold-20261020-232252`, identificado por `BACKUP-COMPLETE.txt`. No borres `.data`: contiene las bases, archivos, credenciales y la instalación de OpenWA.

Los registros locales están en `.data/nexo-stdout.log`, `.data/nexo-stderr.log`, `.data/openwa-stdout.log` y `.data/openwa-stderr.log`. El primer arranque de OpenWA puede imprimir su clave administrativa: no compartas esos registros sin revisar y ocultar secretos.

La evidencia de comprobación sin secretos está en `.data/openwa-verification.json`. Al actualizar OpenWA, conservá sus datos y revisá tanto el cambio de escucha local como el contrato de API antes de reemplazar esta versión.
