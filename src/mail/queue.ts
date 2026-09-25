import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type { MailCategory, MailStatus, RenderedMail } from "./types";

export const mailCollection = db.collection("mail");

const ALREADY_EXISTS = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export interface EnqueueInput extends RenderedMail {
  to?: string;
  toUid?: string;
  category: MailCategory;
  source?: { type: string; id: string };
}

export function buildMailDoc(input: EnqueueInput, status: MailStatus = "pending", skipReason?: string) {
  return {
    to: input.to ?? null,
    toUid: input.toUid ?? null,
    category: input.category,
    subject: input.subject,
    html: input.html,
    text: input.text,
    status,
    attempts: 0,
    lastError: null,
    skipReason: skipReason ?? null,
    source: input.source ?? null,
    createdAt: FieldValue.serverTimestamp(),
    nextAttemptAt: null,
  };
}

/**
 * Enfileira um e-mail com id determinístico, para que a reexecução de um
 * trigger (entrega "pelo menos uma vez") não gere e-mail duplicado.
 * Retorna false se o e-mail já estava na fila.
 */
export async function enqueueMail(mailId: string, input: EnqueueInput): Promise<boolean> {
  try {
    await mailCollection.doc(mailId).create(buildMailDoc(input));
    return true;
  } catch (err: any) {
    if (err?.code === ALREADY_EXISTS) return false;
    throw err;
  }
}

/**
 * Enfileira um e-mail de notificação respeitando o limite por membro por
 * hora. O excedente é gravado como `skipped` (motivo `rate_limited`) — a
 * notificação continua aparecendo no app normalmente.
 */
export async function enqueueRateLimitedMail(
  mailId: string,
  input: EnqueueInput & { toUid: string },
  maxPerHour: number
): Promise<MailStatus | null> {
  const mailRef = mailCollection.doc(mailId);
  const rateRef = db.collection("mail_rate").doc(input.toUid);

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(mailRef);
    if (existing.exists) return null;

    const rate = await transaction.get(rateRef);
    const now = Date.now();
    const windowStart: number = rate.get("windowStart")?.toMillis?.() ?? 0;
    const count: number = rate.get("count") ?? 0;
    const windowExpired = now - windowStart >= RATE_WINDOW_MS;

    if (!windowExpired && count >= maxPerHour) {
      transaction.create(mailRef, buildMailDoc(input, "skipped", "rate_limited"));
      return "skipped";
    }

    transaction.set(
      rateRef,
      windowExpired
        ? { windowStart: Timestamp.fromMillis(now), count: 1 }
        : { windowStart: Timestamp.fromMillis(windowStart), count: count + 1 }
    );
    transaction.create(mailRef, buildMailDoc(input));
    return "pending";
  });
}
