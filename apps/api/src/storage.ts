import { mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@nexo/database";
import { HttpError } from "./security.js";
export function detectMime(data: Buffer) {
  if (data.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  throw new HttpError(400, "Sólo se aceptan archivos PDF, PNG y JPG válidos.");
}
export async function saveAsset(
  db: Pick<PrismaClient, "asset">,
  root: string,
  workspaceId: string,
  data: Buffer,
  name: string,
  purpose: string,
) {
  if (data.length > 8 * 1024 * 1024)
    throw new HttpError(413, "Máximo 8 MB por archivo.");
  const mime = detectMime(data);
  await mkdir(root, { recursive: true });
  const path = join(root, randomUUID());
  await writeFile(path, data, { mode: 0o600 });
  try {
    return await db.asset.create({
      data: {
        workspaceId,
        path,
        mime,
        size: data.length,
        originalName: name.slice(0, 180),
        purpose,
      },
    });
  } catch (error) {
    await unlink(path);
    throw error;
  }
}
