import type { DocumentData } from "firebase-admin/firestore";
import { enqueueMail, enqueueRateLimitedMail } from "../mail/queue";
import {
  notificationEmail,
  reactivationEmail,
  suspensionEmail,
  welcomeEmail,
} from "../templates";

const MAX_NOTIFICATION_MESSAGE = 2000;

function displayName(user: DocumentData | undefined) {
  const name = user?.name;
  return typeof name === "string" && name.trim() ? name.trim() : "membro";
}

/**
 * Espelha uma notificação do app como e-mail.
 *
 * As regras do Firestore deixam qualquer membro autenticado criar
 * notificação para qualquer pessoa, então aqui: `userId: 'all'` não vira
 * e-mail (comunicado geral é pelo endpoint do Conselho), o conteúdo é
 * escapado no template e há limite de e-mails por destinatário por hora.
 * Um backend pode gravar `email: false` na notificação para não enviar e-mail.
 */
export async function handleNotificationCreated(
  notificationId: string,
  data: DocumentData | undefined,
  options: { appUrl: string; maxPerHour: number }
) {
  if (!data || data.email === false) return;

  const { userId, title, message } = data;

  if (typeof userId !== "string" || !userId.trim() || userId === "all") return;
  if (typeof title !== "string" || !title.trim() || typeof message !== "string") return;

  await enqueueRateLimitedMail(
    `notification_${notificationId}`,
    {
      toUid: userId,
      category: "notification",
      source: { type: "notification", id: notificationId },
      ...notificationEmail({
        title,
        message: message.slice(0, MAX_NOTIFICATION_MESSAGE),
        appUrl: options.appUrl,
      }),
    },
    options.maxPerHour
  );
}

export async function handleUserCreated(uid: string, data: DocumentData | undefined, appUrl: string) {
  if (!data) return;

  await enqueueMail(`welcome_${uid}`, {
    toUid: uid,
    category: "account",
    source: { type: "user", id: uid },
    ...welcomeEmail({ name: displayName(data), appUrl }),
  });
}

/** Avisa quando a conta é suspensa (`suspended` vira true) ou reativada. */
export async function handleUserUpdated(
  uid: string,
  eventId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined,
  appUrl: string
) {
  if (!before || !after) return;

  const wasSuspended = before.suspended === true;
  const isSuspended = after.suspended === true;

  if (wasSuspended === isSuspended) return;

  const rendered = isSuspended
    ? suspensionEmail({ name: displayName(after), reason: after.suspendedReason, appUrl })
    : reactivationEmail({ name: displayName(after), appUrl });

  await enqueueMail(`${isSuspended ? "suspended" : "reactivated"}_${eventId}`, {
    toUid: uid,
    category: "account",
    source: { type: "user", id: uid },
    ...rendered,
  });
}
