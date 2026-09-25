import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { auth, db } from "../firebaseAdmin";
import { isNotificationsEnabled } from "../preferences";
import { mailCollection } from "./queue";
import { sendWithResend, SendError } from "./sender";
import type { MailDoc, SenderConfig } from "./types";

export const MAX_ATTEMPTS = 5;
/** Limite padrão do Resend é 2 req/s — a entrega é sequencial e espaçada. */
export const MIN_SEND_INTERVAL_MS = 600;

const PENDING_GRACE_MS = 5 * 60 * 1000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const SWEEP_LIMIT = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 5, 10, 20, 40 min (+ até 50% de variação para não chegarem todas juntas). */
function retryDelayMs(attempt: number) {
  const base = 5 * 60 * 1000 * 2 ** (attempt - 1);
  return base + Math.random() * base * 0.5;
}

async function resolveRecipient(mail: MailDoc): Promise<{ email?: string; reason?: string }> {
  if (!mail.toUid) {
    return mail.to ? { email: mail.to } : { reason: "no_recipient" };
  }

  if (mail.category !== "account" && !(await isNotificationsEnabled(mail.toUid))) {
    return { reason: "opted_out" };
  }

  if (mail.to) return { email: mail.to };

  const user = await db.collection("users").doc(mail.toUid).get();

  const email: unknown = user.get("email");
  if (typeof email === "string" && email.includes("@")) return { email };

  try {
    const authUser = await auth.getUser(mail.toUid);
    if (authUser.email) return { email: authUser.email };
  } catch {
    // usuário não existe no Auth
  }

  return { reason: "no_email" };
}

/**
 * Entrega um e-mail da fila. Seguro para chamar mais de uma vez: o doc é
 * "reservado" numa transação (pending/retry → processing), então só uma
 * execução envia.
 */
export async function processMail(mailId: string, config: SenderConfig): Promise<void> {
  const ref = mailCollection.doc(mailId);

  const claimed = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return null;

    const mail = snap.data() as MailDoc;
    const due =
      mail.status === "pending" ||
      (mail.status === "retry" && (mail.nextAttemptAt?.toMillis() ?? 0) <= Date.now());

    if (!due) return null;

    transaction.update(ref, {
      status: "processing",
      attempts: FieldValue.increment(1),
      processingStartedAt: FieldValue.serverTimestamp(),
    });

    return { ...mail, attempts: (mail.attempts ?? 0) + 1 };
  });

  if (!claimed) return;

  try {
    const recipient = await resolveRecipient(claimed);

    if (!recipient.email) {
      await ref.update({ status: "skipped", skipReason: recipient.reason ?? null });
      return;
    }

    const providerMessageId = await sendWithResend({
      apiKey: config.apiKey,
      from: config.from,
      to: recipient.email,
      subject: claimed.subject,
      html: claimed.html,
      text: claimed.text,
      idempotencyKey: `mail/${mailId}`,
    });

    await ref.update({
      status: "sent",
      to: recipient.email,
      sentAt: FieldValue.serverTimestamp(),
      providerMessageId,
      lastError: null,
      nextAttemptAt: null,
    });
  } catch (err) {
    const retryable = err instanceof SendError ? err.retryable : true;
    const willRetry = retryable && claimed.attempts < MAX_ATTEMPTS;
    const lastError = (err as Error).message ?? String(err);

    logger.warn("Falha ao enviar e-mail", { mailId, attempt: claimed.attempts, willRetry, lastError });

    await ref.update(
      willRetry
        ? {
            status: "retry",
            lastError,
            nextAttemptAt: Timestamp.fromMillis(Date.now() + retryDelayMs(claimed.attempts)),
          }
        : { status: "error", lastError, nextAttemptAt: null }
    );
  }
}

/** Entrega respeitando o intervalo mínimo entre envios. */
export async function processMailThrottled(mailId: string, config: SenderConfig) {
  const startedAt = Date.now();
  await processMail(mailId, config);
  await sleep(Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - startedAt)));
}

/**
 * Rede de segurança executada periodicamente: reenvia o que está em `retry`
 * e venceu, recupera `processing` travado (execução que morreu no meio) e
 * pega `pending` que nunca foi entregue (trigger perdido).
 */
export async function sweepMailQueue(config: SenderConfig): Promise<number> {
  const now = Date.now();

  const stale = await mailCollection.where("status", "==", "processing").get();
  for (const doc of stale.docs) {
    const startedAt = doc.get("processingStartedAt")?.toMillis?.() ?? 0;
    if (now - startedAt < STALE_PROCESSING_MS) continue;

    const exhausted = (doc.get("attempts") ?? 0) >= MAX_ATTEMPTS;
    await doc.ref.update(
      exhausted
        ? { status: "error", lastError: "Envio interrompido e sem novas tentativas." }
        : { status: "retry", nextAttemptAt: Timestamp.fromMillis(now) }
    );
  }

  const [retry, pending] = await Promise.all([
    mailCollection.where("status", "==", "retry").get(),
    mailCollection.where("status", "==", "pending").get(),
  ]);

  const due = [
    ...retry.docs.filter((doc) => (doc.get("nextAttemptAt")?.toMillis?.() ?? 0) <= now),
    ...pending.docs.filter((doc) => now - (doc.get("createdAt")?.toMillis?.() ?? now) >= PENDING_GRACE_MS),
  ].slice(0, SWEEP_LIMIT);

  for (const doc of due) {
    await processMailThrottled(doc.id, config);
  }

  return due.length;
}
