# Cierre de limpieza y correcciones — 13/11/2026

## Resultado y errores corregidos

- Una aprobación manual no registraba la huella del archivo. Ahora se calcula dentro de la operación protegida por negocio y se compara contra otros pagos. También se comparan los archivos originales de aprobaciones antiguas sin huella, sin modificar esos registros.
- Una decisión basada en un comprobante anterior podía afectar al reemplazo. API y comandos de aprobación ahora incluyen el identificador del archivo observado; la discrepancia devuelve 409. La verificación automática descarta resultados del archivo anterior y su fallback no marca el reemplazo como revisado.
- Los avisos al administrador se identifican por pago y archivo: un reemplazo puede emitir su propio aviso y los comandos antiguos dejan de ser válidos.
- Los importes perdían centavos en algunos textos. El formato compartido conserva la fracción monetaria; incluye pruebas ARS, USD y EUR.
- Las FAQ y campañas podían admitir variantes equivalentes por tildes, signos o espacios. Se comparan normalizadas, se rechazan entradas que quedan vacías y se serializa la creación de campañas con el mismo bloqueo usado para productos.
- La carga del PDF de conocimiento fallaba con el Buffer de Node. Se entrega al parser una copia Uint8Array; la prueba de carga y extracción pasa.

## Cómo leer el código

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `apps/web/src/main.tsx` | Entrada, límite de sesión, navegación y composición del panel. 350 líneas. |
| `apps/web/src/features/dashboard/useDashboard.ts` | Estado, carga de datos y acciones del panel. 210 líneas. |
| `apps/web/src/features/dashboard/*Page.tsx` | Resumen, productos, conversaciones, pagos, conexiones y configuración. |
| `apps/web/src/features/accounts/Login.tsx` | Acceso a la cuenta. |
| `apps/web/src/features/products/ProductEditor.tsx` | Contenedor del editor y selección de pestaña. 61 líneas. |
| `apps/web/src/features/products/useProductEditor.ts` | Borradores y actualizadores comunes de packs y respuestas. |
| `apps/web/src/features/products/Product*Form.tsx` | Formularios de datos, packs y respuestas. |
| `apps/web/src/features/products/ProductFilesPanel.tsx` | Conocimiento y archivos de entrega. |
| `apps/web/src/features/products/ProductConversationPreview.tsx` | Vista previa del diálogo. |
| `apps/api/src/sales.ts` | Fachada de ventas, bloqueo por negocio y delegación. 141 líneas. |
| `apps/api/src/sales/receiving.ts` | Recepción y transición de conversaciones. 464 líneas. |
| `apps/api/src/sales/receipts.ts` | Revisión manual y automática de comprobantes. 386 líneas. |
| `apps/api/src/sales/receipt-identity.ts` | Huella y detección de reutilización. |
| `apps/api/src/sales/outbox.ts` | Recordatorios y envío de mensajes pendientes. 202 líneas. |
| `apps/api/src/sales/context.ts` | Dependencias comunes; preserva el mismo bloqueo transaccional. |
| `packages/shared/src/product.ts` | Formato monetario y presentación del producto usados por vendedor y panel. |
| `apps/api/src/catalog/activation.ts` | Normalización y unicidad de frases de activación. |
| `apps/web/src/styles/` | Base, estructura, panel, formularios, editor, login, responsive e integraciones. |

La reducción de archivos principales es una separación de responsabilidades: el código necesario sigue existiendo. Se eliminó duplicación en los actualizadores, formato de dinero y texto de presentación. Se mantienen validaciones de cliente y servidor porque protegen fronteras distintas.

## Contrato de aprobación

`POST /api/payments/:id/review` requiere `expectedAssetId` además de la decisión y los campos ya existentes. Debe ser el identificador del comprobante que el administrador vio. Omitirlo produce 400; indicar un archivo reemplazado produce 409.

Por WhatsApp, copiar el comando completo del aviso nuevo: `APROBAR <paymentId>.<assetId>` o `RECHAZAR <paymentId>.<assetId> <motivo>`. Los comandos antiguos sin identificador del archivo no aprueban pagos.

La huella detecta reutilización de bytes idénticos, no equivalencia visual entre archivos modificados. Si faltan archivos de aprobaciones históricas sin huella, la comprobación no da por válida la aprobación: deben recuperarse esos archivos para poder verificar el historial. No se modificó el esquema ni se reescribieron pagos históricos.

## Manejo de errores

Sí hay `try/catch`. Se conserva donde permite una recuperación concreta: extracción de comprobantes que pasa a revisión manual, fallos de envío registrados para reintento, aislamiento del worker por negocio y acciones del panel que muestran el error. Las validaciones transaccionales propagan el error para revertir cambios. No se envolvió cada función con un catch que ocultara fallos.

## Evidencia de validación

- Suite completa: 71 pruebas, 71 correctas, 0 fallos y 0 omitidas. Bases PGlite nuevas en memoria y servidores ficticios locales; entorno sin credenciales heredadas ni `TEST_DATABASE_URL`.
- `npm run build`: TypeScript de API y web correctos; compilación Vite correcta.
- Regresiones específicas: reutilización tras aprobación manual e histórica; sustitución durante revisión HTTP, WhatsApp y extracción automática; avisos por versión; normalización de FAQ y campañas, incluidas creaciones concurrentes; importes con centavos; carga real de PDF de prueba.
- Navegación visual con datos ficticios en 1440 × 1000 y 390 × 844. Se revisaron las seis pantallas extraídas, las cinco pestañas del editor, conservación de borradores y confirmación/cancelación de pagos. Sin errores de consola observados. El documento no desborda horizontalmente; las tablas mantienen su desplazamiento interno.
- CSS dividido en secciones contiguas sin alterar su cascada; antes y después produce `index-DGeTFqcr.css`.
- Búsqueda sin coincidencias de la integración de cobros retirada en aplicaciones, paquetes, scripts, documentación y manifiestos. Los informes históricos externos no se reescribieron.

Capturas y registro de pruebas: directorio externo `finish-five-2026-11-12` en los artefactos locales de esta tarea (`full-tests.log`, `desktop-final.png`, `mobile-final.png`, `mobile-editor-final.png`). Las capturas muestran datos ficticios, no ventas reales.

## Alcance

Quedan cerrados los cinco puntos acordados para esta vuelta. No se afirma que el sistema carezca de vulnerabilidades ni que la auditoría formal anterior esté completa. La prueba con teléfonos y proveedores reales queda fuera de esta verificación. No se cambiaron credenciales ni se borraron datos persistentes.

## Servidor al finalizar

Se inició el stack habitual mediante scripts/start-local-stack.mjs, por pedido del usuario. Panel (5173), API con consulta de base (3001/health) y gateway (2785) respondieron HTTP 200. Se mantienen las credenciales y los datos existentes. No se vinculó un teléfono ni se enviaron mensajes de prueba.

