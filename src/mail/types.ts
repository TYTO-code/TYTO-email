import type { Timestamp } from "firebase-admin/firestore";

/**
 * - notification: espelho de um doc de `notifications` (respeita opt-out e limite por hora)
 * - broadcast: comunicado do Conselho (respeita opt-out)
 * - account: boas-vindas, suspensão, reativação (sempre enviado)
 */
export type MailCategory = "notification" | "broadcast" | "account";

export type MailStatus = "pending" | "processing" | "sent" | "retry" | "error" | "skipped";

/** Documento da fila `mail/{mailId}`. */
export interface MailDoc {
  /** Endereço explícito; se ausente, é resolvido a partir de `toUid` no envio. */
  to?: string | null;
  toUid?: string | null;
  category: MailCategory;
  subject: string;
  html: string;
  text: string;
  status: MailStatus;
  attempts: number;
  lastError?: string | null;
  skipReason?: string | null;
  source?: { type: string; id: string } | null;
  createdAt: Timestamp;
  nextAttemptAt?: Timestamp | null;
  processingStartedAt?: Timestamp | null;
  sentAt?: Timestamp | null;
  providerMessageId?: string | null;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export interface SenderConfig {
  apiKey: string;
  from: string;
}
