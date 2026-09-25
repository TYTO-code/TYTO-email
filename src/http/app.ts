import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../firebaseAdmin";
import { buildMailDoc, mailCollection } from "../mail/queue";
import { broadcastEmail } from "../templates";

interface AuthenticatedRequest extends Request {
  uid?: string;
}

const MAX_SUBJECT = 150;
const MAX_MESSAGE = 5000;

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

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

export function createApp(getAppUrl: () => string) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  /**
   * POST /api/email/broadcast — comunicado do Conselho por e-mail.
   * Body: { subject: string; message: string; userIds?: string[] }
   * Sem `userIds`, vai para todos os membros (quem desativou e-mails não recebe).
   */
  app.post("/api/email/broadcast", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const requester = await db.collection("users").doc(req.uid!).get();

      if (requester.get("admin") !== true) {
        return fail(res, 403, "Somente o Conselho pode enviar comunicados por e-mail.");
      }

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
        return fail(res, 400, "Lista de destinatários inválida.");
      }

      const recipients: string[] = userIds
        ? [...new Set<string>(userIds)]
        : (await db.collection("users").select().get()).docs.map((doc) => doc.id);

      if (recipients.length === 0) {
        return fail(res, 400, "Nenhum destinatário encontrado.");
      }

      const broadcastRef = db.collection("mail_broadcasts").doc();
      const rendered = broadcastEmail({ subject: subject.trim(), message: message.trim(), appUrl: getAppUrl() });

      await broadcastRef.create({
        subject: rendered.subject,
        message: message.trim(),
        sentBy: req.uid,
        recipients: recipients.length,
        allMembers: !userIds,
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

      return res.status(201).json({
        success: true,
        data: { broadcastId: broadcastRef.id, queued: recipients.length },
      });
    } catch (err) {
      console.error(err);
      return fail(res, 500, "Algo deu errado no servidor. Tente novamente em instantes.");
    }
  });

  app.use((_req: Request, res: Response) => fail(res, 404, "Rota não encontrada."));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      return fail(res, 400, "Dados da requisição inválidos.");
    }

    console.error(err);
    return fail(res, 500, "Algo deu errado no servidor. Tente novamente em instantes.");
  });

  return app;
}
