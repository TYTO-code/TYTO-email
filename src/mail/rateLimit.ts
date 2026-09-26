import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";

const WINDOW_MS = 60 * 60 * 1000;

export const hashKey = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** Janela fixa de 1 hora em `mail_rate/{key}`. Retorna false se o limite estourou. */
export async function consumeQuota(key: string, maxPerHour: number): Promise<boolean> {
  const ref = db.collection("mail_rate").doc(key);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const now = Date.now();
    const windowStart: number = snap.get("windowStart")?.toMillis?.() ?? 0;
    const count: number = snap.get("count") ?? 0;

    if (now - windowStart >= WINDOW_MS) {
      transaction.set(ref, { windowStart: Timestamp.fromMillis(now), count: 1 });
      return true;
    }

    if (count >= maxPerHour) return false;

    transaction.set(ref, { windowStart: Timestamp.fromMillis(windowStart), count: count + 1 });
    return true;
  });
}
