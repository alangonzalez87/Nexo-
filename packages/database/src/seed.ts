import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { hashPassword } from "../../../apps/api/src/security.js";
export async function seed(db: PrismaClient, email: string, password: string) {
  if (password.length < 12)
    throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: hashPassword(password) },
  });
  const membership = await db.membership.findFirst({
    where: { userId: user.id },
  });
  if (membership)
    return { workspaceId: membership.workspaceId, userId: user.id };
  const workspace = await db.workspace.create({
    data: {
      name: "Estudio Nexo",
      paymentAlias: "demo.nexo.ventas",
      paymentInstructions:
        "Datos de demostración. No realizar transferencias reales.",
      memberships: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  const product = await db.product.create({
    data: {
      workspaceId: workspace.id,
      name: "Curso de IA para emprendedores",
      priceCents: 2990000,
      currency: "ARS",
      description:
        "Aprendé a incorporar inteligencia artificial en las tareas de tu negocio con un curso práctico, a tu ritmo.",
      benefits:
        "Lecciones prácticas, ejemplos de uso y una guía de implementación para tu negocio.",
      hook: "¡Hola! Demos el próximo paso para simplificar tu negocio.",
      cta: "¿Querés empezar? Escribí «quiero comprar» y te comparto los datos de pago.",
      objections:
        "Podés avanzar a tu propio ritmo. No necesitás conocimientos previos de programación.",
      mode: "AUTO",
      rules: {
        create: [
          {
            question: "¿Necesito experiencia previa?",
            answer:
              "No necesitás experiencia previa. El curso empieza desde cero y está pensado para emprendedores.",
            mandatory: true,
          },
          {
            question: "¿Cómo recibo el curso?",
            answer:
              "Después de que el equipo revise y apruebe tu pago, recibirás un enlace privado de descarga válido por 24 horas.",
            mandatory: true,
          },
        ],
      },
    },
  });
  await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      productId: product.id,
      name: "Lanzamiento · Curso de IA",
      code: "CURSOIA",
    },
  });
  await db.connection.create({
    data: {
      workspaceId: workspace.id,
      name: "Ventas · Simulador",
      provider: "MOCK",
      sessionId: `mock-${workspace.id}`,
      status: "CONNECTED",
    },
  });
  return { workspaceId: workspace.id, userId: user.id };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)
    throw new Error("Configurá ADMIN_EMAIL y ADMIN_PASSWORD.");
  const db = new PrismaClient();
  try {
    await seed(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    console.log(
      "Negocio inicial creado. Las credenciales existentes no se modifican.",
    );
  } finally {
    await db.$disconnect();
  }
}
