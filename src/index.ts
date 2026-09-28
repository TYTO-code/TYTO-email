import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { APP_URL, NOTIFICATION_EMAILS_PER_HOUR, RATE_LIMIT_PEPPER, RESEND_API_KEY, senderConfig } from "./config";
import { createApp } from "./http/app";
import { processMailThrottled, sweepMailQueue } from "./mail/processor";
import { handleNotificationCreated, handleUserCreated, handleUserUpdated } from "./triggers/handlers";

// A região precisa ser a mesma do banco Firestore (ver .env.example).
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || "us-central1", maxInstances: 10 });

// --- Produtores: transformam eventos do app em e-mails na fila `mail` ---

export const mirrorNotificationToEmail = onDocumentCreated("notifications/{notificationId}", (event) =>
  handleNotificationCreated(event.params.notificationId, event.data?.data(), {
    appUrl: APP_URL.value(),
    maxPerHour: NOTIFICATION_EMAILS_PER_HOUR.value(),
  })
);

export const sendWelcomeEmail = onDocumentCreated("users/{uid}", (event) =>
  handleUserCreated(event.params.uid, event.data?.data(), APP_URL.value())
);

export const sendAccountStatusEmail = onDocumentUpdated("users/{uid}", (event) =>
  handleUserUpdated(
    event.params.uid,
    event.id,
    event.data?.before.data(),
    event.data?.after.data(),
    APP_URL.value()
  )
);

export const emailApi = onRequest(
  { secrets: [RATE_LIMIT_PEPPER] },
  createApp(() => APP_URL.value(), () => RATE_LIMIT_PEPPER.value())
);

// --- Consumidor: entrega pelo Resend, um por vez (limite de 2 req/s do Resend) ---

export const deliverMail = onDocumentCreated(
  { document: "mail/{mailId}", secrets: [RESEND_API_KEY], maxInstances: 1, concurrency: 1 },
  (event) => processMailThrottled(event.params.mailId, senderConfig())
);

export const sweepMail = onSchedule(
  { schedule: "every 10 minutes", secrets: [RESEND_API_KEY], timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    await sweepMailQueue(senderConfig());
  }
);
