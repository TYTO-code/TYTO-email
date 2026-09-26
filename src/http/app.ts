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
import { MessageKey, resolveLocale, t } from "../i18n";
import { broadcastEmail, passwordResetEmail } from "../templates";

interface AuthenticatedRequest extends Request {
  uid?: string;
}

const MAX_SUBJECT = 150;
const MAX_MESSAGE = 5000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_PER_EMAIL_PER_HOUR = 3;
const RESET_PER_IP_PER_HOUR = 10;

async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return fail(req, res, 401, "notAuthenticated");
    }

    const decoded = await auth.verifyIdToken(authHeader.split("Bearer ")[1]);
    req.uid = decoded.uid;

    next();
  } catch {
    return fail(req, res, 401, "sessionExpired");
  }
}

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const requester = await db.collection("users").doc(req.uid!).get();

    if (requester.get("admin") !== true) {
      return fail(req, res, 403, "councilOnly");
    }

    next();
  } catch (err) {
    next(err);
  }
}

/** Erro no envelope padrão, com a mensagem no idioma do usuário. */
const fail = async (
  req: Request,
  res: Response,
  status: number,
  key: MessageKey,
  params?: Record<string, string | number>
) => res.status(status).json({ success: false, message: t(await resolveLocale(req), key, params) });

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });

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
        return fail(req, res, 400, "invalidEmail");
      }

      const withinIpLimit = await consumeQuota(`reset_ip_${hashKey(req.ip ?? "unknown")}`, RESET_PER_IP_PER_HOUR);
      const withinEmailLimit =
        withinIpLimit && (await consumeQuota(`reset_email_${hashKey(email)}`, RESET_PER_EMAIL_PER_HOUR));

      if (!withinIpLimit || !withinEmailLimit) {
        return fail(req, res, 429, "tooManyAttempts");
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

      return ok(res, { message: t(await resolveLocale(req), "passwordResetSent") });
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
      const [enabled, locale] = await Promise.all([isNotificationsEnabled(req.uid!), resolveLocale(req)]);
      return ok(res, describePreferences(enabled, locale));
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/email/preferences — Body: { notifications: boolean } */
  app.put("/api/email/preferences", authenticate, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { notifications } = req.body ?? {};

      if (typeof notifications !== "boolean") {
        return fail(req, res, 400, "invalidPreference");
      }

      await setNotificationsEnabled(req.uid!, notifications);

      return ok(res, describePreferences(notifications, await resolveLocale(req)));
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
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const [users, optedOut, locale] = await Promise.all([
          db.collection("users").select("name", "email").get(),
          listOptedOutUids(),
          resolveLocale(req),
        ]);

        const recipients = users.docs
          .map((doc) => ({
            uid: doc.id,
            name: doc.get("name") || doc.get("email") || t(locale, "noName"),
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
        return fail(req, res, 400, "subjectRequired");
      }

      if (subject.length > MAX_SUBJECT) {
        return fail(req, res, 400, "subjectTooLong", { max: MAX_SUBJECT });
      }

      if (typeof message !== "string" || !message.trim()) {
        return fail(req, res, 400, "messageRequired");
      }

      if (message.length > MAX_MESSAGE) {
        return fail(req, res, 400, "messageTooLong", { max: MAX_MESSAGE });
      }

      if (
        userIds !== undefined &&
        (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every((id) => typeof id === "string" && id.trim()))
      ) {
        return fail(req, res, 400, "chooseRecipients");
      }

      const audience: string[] = userIds
        ? [...new Set<string>(userIds)]
        : (await db.collection("users").select().get()).docs.map((doc) => doc.id);

      const optedOut = await listOptedOutUids();
      const recipients = audience.filter((uid) => !optedOut.has(uid));
      const skippedOptedOut = audience.length - recipients.length;

      if (recipients.length === 0) {
        return fail(req, res, 400, "noRecipientReceives");
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

      const summary = t(await resolveLocale(req), "broadcastSummary", {
        queued: recipients.length,
        skipped: skippedOptedOut,
      });

      return ok(
        res,
        { broadcastId: broadcastRef.id, queued: recipients.length, skippedOptedOut, message: summary },
        201
      );
    } catch (err) {
      next(err);
    }
  });

  app.use((req: Request, res: Response) => fail(req, res, 404, "routeNotFound"));

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      return fail(req, res, 400, "invalidRequest");
    }

    logger.error(err);
    return fail(req, res, 500, "internalError");
  });

  return app;
}
