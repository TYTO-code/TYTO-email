import { defineInt, defineSecret, defineString } from "firebase-functions/params";
import type { SenderConfig } from "./mail/types";

export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
export const MAIL_FROM = defineString("MAIL_FROM", { default: "TYTO.club <nao-responda@tyto.club>" });
export const APP_URL = defineString("APP_URL", { default: "https://tyto.club" });
export const NOTIFICATION_EMAILS_PER_HOUR = defineInt("NOTIFICATION_EMAILS_PER_HOUR", { default: 10 });

export const senderConfig = (): SenderConfig => ({
  apiKey: RESEND_API_KEY.value(),
  from: MAIL_FROM.value(),
});
