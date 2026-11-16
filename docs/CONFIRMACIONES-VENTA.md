# Confirmaciones de venta — 13/11/2026

El bucle aparecía porque «sí» y «si si» llegaban a la respuesta genérica aunque la conversación ya tuviera un pack y una cotización guardados.

La resolución determinista está aislada en `apps/api/src/sales/confirmations.ts` y se aplica antes del clasificador de packs, después de las reglas obligatorias y de las protecciones de control humano.

- Con una compra pendiente de pago, confirma el pack guardado y pide el comprobante una vez. Más confirmaciones breves consecutivas quedan registradas sin generar respuestas repetidas.
- Si el último mensaje automático ofrece explícitamente un pack con «¿Querés llevarlo?», acepta ese pack.
- Si falta elegir pack, muestra las opciones con precios y pide el número. Si solo recibe otro «sí», aclara una vez que necesita el número; luego espera una respuesta concreta.
- Conserva el importe cotizado aunque después cambie el precio del catálogo. No crea pagos, aprueba comprobantes ni entrega cursos por recibir un «sí».
- Excluye mensajes cancelados del contexto. Las preguntas y las frases condicionales no se interpretan como confirmaciones breves. Las conversaciones bajo control humano siguen en pausa.

Validación: compilación de API y web correcta; suite aislada de 87 pruebas correcta, incluyendo cuatro regresiones nuevas de confirmaciones y persistencia. No se enviaron mensajes de prueba a clientes ni se reactivaron conversaciones humanas.

El cambio resuelve confirmaciones breves con contexto de packs y compras pendientes. No sustituye la interpretación general de todas las intenciones.
