import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { auth, db } from "../firebaseAdmin";
import { buildMailDoc, enqueueMail, mailCollection } from "../mail/queue";
import { consumeQuota, hashKey } from "../mail/rateLimit";
import { generatePasswordLink } from "../passwordLink";
import {
  describePreferences,
  isNotificationsEnabled,
  listOptedOutUids,
  setNotificationsEnabled,
} from "../preferences";
import { broadcastEmail, passwordResetEmail } from "../templates";

interface AuthenticatedRequest extends Request {
  uid?: string;
}

const MAX_SUBJECT = 150;
const MAX_MESSAGE = 5000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_PER_EMAIL_PER_HOUR = 3;
const RESET_PER_IP_PER_HOUR = 10;

const PASSWORD_RESET_MESSAGE =
  "Se existir uma conta com esse e-mail, você vai receber em instantes um link para criar uma nova senha.";

async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Você precisa estar autenticado." });
    }

    const decoded = await auth.verifyIdToken(authHeader.split("Bearer ")[1]);
    req.uid = decoded.uid;

    next();
  } catch {
    return res.status(401).json({ success: false, message: "Sua sessão expirou. Entre novamente." });
  }
}

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const requester = await db.collection("users").doc(req.uid!).get();

    if (requester.get("admin") !== true) {
      return fail(res, 403, "Somente o Conselho pode fazer isso.");
    }

    next();
  } catch (err) {
    next(err);
  }
}

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export function createApp(getAppUrl: () => string) {
  const app = express();

  // Atrás do proxy do Google: req.ip passa a ser o IP real do cliente.
  app.set("trust proxy", true);
  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  // -------------------------------------------------------------------------
  // Recuperação de senha (pública)
  // -------------------------------------------------------------------------

  /**
   * POST /api/email/password-reset — Body: { email }
   * Sempre responde a mesma mensagem, exista a conta ou não (não revela
   * quem é membro). Limite: 3 pedidos por e-mail e 10 por IP, por hora.
   */
  app.post("/api/email/password-reset", async (req, res, next) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

      if (!EMAIL_REGEX.test(email)) {
        return fail(res, 400, "Informe um e-mail válido.");
      }

      const withinIpLimit = await consumeQuota(`reset_ip_${hashKey(req.ip ?? "unknown")}`, RESET_PER_IP_PER_HOUR);
      const withinEmailLimit =
        withinIpLimit && (await consumeQuota(`reset_email_${hashKey(email)}`, RESET_PER_EMAIL_PER_HOUR));

      if (!withinIpLimit || !withinEmailLimit) {
        return fail(res, 429, "Muitas tentativas. Aguarde um pouco e tente novamente.");
      }

      try {
        const user = await auth.getUserByEmail(email);
        const profile = await db.collection("users").doc(user.uid).get();
        const name = profile.get("name") || user.displayName || "membro";

        await enqueueMail(`password_reset_${randomUUID()}`, {
          to: email,
          toUid: user.uid,
          category: "account",
          source: { type: "password_reset", id: user.uid },
          ...passwordResetEmail({ name, link: await generatePasswordLink(email, getAppUrl()) }),
        });
      } catch (err: any) {
        if (err?.code !== "auth/user-not-found" && err?.code !== "auth/email-not-found") throw err;
      }

      return ok(res, { message: PASSWORD_RESET_MESSAGE });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // Preferências do membro
  // -------------------------------------------------------------------------

  /** GET /api/email/preferences — preferências já com rótulos para renderizar. */
  app.get("/api/email/preferences", authenticate, async (req: AuthenticatedRequest, res, next) => {
    try {
      return ok(res, describePreferences(await isNotificationsEnabled(req.uid!)));
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/email/preferences — Body: { notifications: boolean } */
  app.put("/api/email/preferences", authenticate, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { notifications } = req.body ?? {};

      if (typeof notifications !== "boolean") {
        return fail(res, 400, "Preferência inválida.");
      }

      await setNotificationsEnabled(req.uid!, notifications);

      return ok(res, describePreferences(notifications));
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // Comunicado do Conselho (admin)
  // -------------------------------------------------------------------------

  /** GET /api/email/broadcast/recipients — membros que podem receber o comunicado. */
  app.get(
    "/api/email/broadcast/recipients",
    authenticate,
    requireAdmin,
    async (_req: AuthenticatedRequest, res, next) => {
      try {
        const [users, optedOut] = await Promise.all([
          db.collection("users").select("name", "email").get(),
          listOptedOutUids(),
        ]);

        const recipients = users.docs
          .map((doc) => ({
            uid: doc.id,
            name: doc.get("name") || doc.get("email") || "Sem nome",
            email: doc.get("email") ?? null,
            receivesEmail: !optedOut.has(doc.id),
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));

        return ok(res, { recipients });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/email/broadcast — Body: { subject, message, userIds? }
   * Sem `userIds`, vai para todos os membros. Quem desativou os e-mails de
   * notificação não entra na fila.
   */
  app.post("/api/email/broadcast", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { subject, message, userIds } = req.body ?? {};

      if (typeof subject !== "string" || !subject.trim()) {
        return fail(res, 400, "Informe o assunto do comunicado.");
      }

      if (subject.length > MAX_SUBJECT) {
        return fail(res, 400, `O assunto pode ter no máximo ${MAX_SUBJECT} caracteres.`);
      }

      if (typeof message !== "string" || !message.trim()) {
        return fail(res, 400, "Escreva a mensagem do comunicado.");
      }

      if (message.length > MAX_MESSAGE) {
        return fail(res, 400, `A mensagem pode ter no máximo ${MAX_MESSAGE} caracteres.`);
      }

      if (
        userIds !== undefined &&
        (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every((id) => typeof id === "string" && id.trim()))
      ) {
        return fail(res, 400, "Escolha pelo menos um membro.");
      }

      const audience: string[] = userIds
        ? [...new Set<string>(userIds)]
        : (await db.collection("users").select().get()).docs.map((doc) => doc.id);

      const optedOut = await listOptedOutUids();
      const recipients = audience.filter((uid) => !optedOut.has(uid));
      const skippedOptedOut = audience.length - recipients.length;

      if (recipients.length === 0) {
        return fail(res, 400, "Nenhum dos membros escolhidos recebe e-mails de comunicado.");
      }

      const broadcastRef = db.collection("mail_broadcasts").doc();
      const rendered = broadcastEmail({ subject: subject.trim(), message: message.trim(), appUrl: getAppUrl() });

      await broadcastRef.create({
        subject: rendered.subject,
        message: message.trim(),
        sentBy: req.uid,
        allMembers: !userIds,
        queued: recipients.length,
        skippedOptedOut,
        createdAt: FieldValue.serverTimestamp(),
      });

      const writer = db.bulkWriter();
      for (const uid of recipients) {
        writer.create(
          mailCollection.doc(`broadcast_${broadcastRef.id}_${uid}`),
          buildMailDoc({ ...rendered, toUid: uid, category: "broadcast", source: { type: "broadcast", id: broadcastRef.id } })
        );
      }
      await writer.close();

      const summary =
        `Comunicado enviado: ${plural(recipients.length, "e-mail na fila", "e-mails na fila")}.` +
        (skippedOptedOut > 0
          ? ` ${plural(skippedOptedOut, "membro desativou", "membros desativaram")} os e-mails e não vai receber.`
          : "");

      return ok(
        res,
        { broadcastId: broadcastRef.id, queued: recipients.length, skippedOptedOut, message: summary },
        201
      );
    } catch (err) {
      next(err);
    }
  });

  app.use((_req: Request, res: Response) => fail(res, 404, "Rota não encontrada."));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      return fail(res, 400, "Dados da requisição inválidos.");
    }

    logger.error(err);
    return fail(res, 500, "Algo deu errado no servidor. Tente novamente em instantes.");
  });

  return app;
}
