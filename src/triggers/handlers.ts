import type { DocumentData } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { auth } from "../firebaseAdmin";
import { enqueueMail, enqueueRateLimitedMail } from "../mail/queue";
import { generatePasswordLink } from "../passwordLink";
import {
  googleWelcomeEmail,
  loginEmailChangedNewEmail,
  loginEmailChangedOldEmail,
  notificationEmail,
  reactivationEmail,
  recruitWelcomeEmail,
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

/**
 * Boas-vindas conforme o jeito que a conta foi criada:
 * - recrutado pelo admin (conta com senha): link para criar a própria senha,
 *   assim a senha provisória não precisa ser repassada;
 * - login com Google: como entrar;
 * - Auth indisponível: boas-vindas genéricas.
 */
export async function handleUserCreated(uid: string, data: DocumentData | undefined, appUrl: string) {
  if (!data) return;

  const name = displayName(data);
  let rendered = welcomeEmail({ name, appUrl });

  try {
    const authUser = await auth.getUser(uid);
    const providers = authUser.providerData.map((provider) => provider.providerId);

    if (authUser.email && providers.includes("password")) {
      rendered = recruitWelcomeEmail({
        name,
        email: authUser.email,
        setPasswordLink: await generatePasswordLink(authUser.email, appUrl),
      });
    } else if (authUser.email && providers.includes("google.com")) {
      rendered = googleWelcomeEmail({ name, email: authUser.email, appUrl });
    }
  } catch (err) {
    logger.warn("Boas-vindas sem dados do Auth", { uid, error: (err as Error).message });
  }

  await enqueueMail(`welcome_${uid}`, {
    toUid: uid,
    category: "account",
    source: { type: "user", id: uid },
    ...rendered,
  });
}

/**
 * E-mails de conta disparados por mudanças em `users/{uid}`:
 * troca do e-mail de login e suspensão/reativação.
 */
export async function handleUserUpdated(
  uid: string,
  eventId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined,
  appUrl: string
) {
  if (!before || !after) return;

  await notifyLoginEmailChange(uid, eventId, before, after, appUrl);
  await notifySuspensionChange(uid, eventId, before, after, appUrl);
}

const normalizeEmail = (value: unknown) =>
  typeof value === "string" && value.includes("@") ? value.trim().toLowerCase() : null;

/** Avisa o endereço ANTIGO (alerta de segurança) e confirma no novo. */
async function notifyLoginEmailChange(
  uid: string,
  eventId: string,
  before: DocumentData,
  after: DocumentData,
  appUrl: string
) {
  const oldEmail = normalizeEmail(before.email);
  const newEmail = normalizeEmail(after.email);

  if (!oldEmail || !newEmail || oldEmail === newEmail) return;

  const name = displayName(after);
  const source = { type: "user", id: uid };

  await enqueueMail(`email_changed_old_${eventId}`, {
    to: oldEmail,
    category: "account",
    source,
    ...loginEmailChangedOldEmail({ name, newEmail }),
  });

  await enqueueMail(`email_changed_new_${eventId}`, {
    to: newEmail,
    category: "account",
    source,
    ...loginEmailChangedNewEmail({ name, appUrl }),
  });
}

async function notifySuspensionChange(
  uid: string,
  eventId: string,
  before: DocumentData,
  after: DocumentData,
  appUrl: string
) {
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
