import type { Request } from "express";
import { db } from "./firebaseAdmin";

export type Locale = "pt" | "en" | "es";

type Params = Record<string, string | number>;
type Message = string | ((params: Params) => string);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const messages = {
  pt: {
    notAuthenticated: "Você precisa estar autenticado.",
    sessionExpired: "Sua sessão expirou. Entre novamente.",
    routeNotFound: "Rota não encontrada.",
    invalidRequest: "Dados da requisição inválidos.",
    internalError: "Algo deu errado no servidor. Tente novamente em instantes.",
    councilOnly: "Somente o Conselho pode fazer isso.",
    invalidEmail: "Informe um e-mail válido.",
    tooManyAttempts: "Muitas tentativas. Aguarde um pouco e tente novamente.",
    passwordResetSent:
      "Se existir uma conta com esse e-mail, você vai receber em instantes um link para criar uma nova senha.",
    invalidPreference: "Preferência inválida.",
    notificationsLabel: "Receber notificações por e-mail",
    notificationsDescription:
      "Notificações do app e comunicados do Conselho. Avisos sobre a sua conta (segurança, suspensão) são sempre enviados.",
    subjectRequired: "Informe o assunto do comunicado.",
    subjectTooLong: (p: Params) => `O assunto pode ter no máximo ${p.max} caracteres.`,
    messageRequired: "Escreva a mensagem do comunicado.",
    messageTooLong: (p: Params) => `A mensagem pode ter no máximo ${p.max} caracteres.`,
    chooseRecipients: "Escolha pelo menos um membro.",
    noRecipientReceives: "Nenhum dos membros escolhidos recebe e-mails de comunicado.",
    noName: "Sem nome",
    broadcastSummary: (p: Params) =>
      `Comunicado enviado: ${plural(Number(p.queued), "e-mail na fila", "e-mails na fila")}.` +
      (Number(p.skipped) > 0
        ? ` ${plural(Number(p.skipped), "membro desativou", "membros desativaram")} os e-mails e não vai receber.`
        : ""),
  },
  en: {
    notAuthenticated: "You need to be signed in.",
    sessionExpired: "Your session has expired. Please sign in again.",
    routeNotFound: "Route not found.",
    invalidRequest: "Invalid request data.",
    internalError: "Something went wrong on the server. Please try again shortly.",
    councilOnly: "Only the Council can do this.",
    invalidEmail: "Enter a valid email address.",
    tooManyAttempts: "Too many attempts. Please wait a bit and try again.",
    passwordResetSent: "If an account exists with that email, you'll shortly receive a link to create a new password.",
    invalidPreference: "Invalid preference.",
    notificationsLabel: "Receive notifications by email",
    notificationsDescription:
      "App notifications and Council announcements. Notices about your account (security, suspension) are always sent.",
    subjectRequired: "Enter the announcement subject.",
    subjectTooLong: (p: Params) => `The subject can have at most ${p.max} characters.`,
    messageRequired: "Write the announcement message.",
    messageTooLong: (p: Params) => `The message can have at most ${p.max} characters.`,
    chooseRecipients: "Choose at least one member.",
    noRecipientReceives: "None of the chosen members receive announcement emails.",
    noName: "No name",
    broadcastSummary: (p: Params) =>
      `Announcement sent: ${plural(Number(p.queued), "email queued", "emails queued")}.` +
      (Number(p.skipped) > 0
        ? ` ${plural(Number(p.skipped), "member has", "members have")} turned off emails and won't receive it.`
        : ""),
  },
  es: {
    notAuthenticated: "Necesitas iniciar sesión.",
    sessionExpired: "Tu sesión expiró. Inicia sesión de nuevo.",
    routeNotFound: "Ruta no encontrada.",
    invalidRequest: "Datos de la solicitud inválidos.",
    internalError: "Algo salió mal en el servidor. Inténtalo de nuevo en unos instantes.",
    councilOnly: "Solo el Consejo puede hacer esto.",
    invalidEmail: "Ingresa un correo válido.",
    tooManyAttempts: "Demasiados intentos. Espera un poco e inténtalo de nuevo.",
    passwordResetSent:
      "Si existe una cuenta con ese correo, en unos instantes recibirás un enlace para crear una nueva contraseña.",
    invalidPreference: "Preferencia inválida.",
    notificationsLabel: "Recibir notificaciones por correo",
    notificationsDescription:
      "Notificaciones de la app y comunicados del Consejo. Los avisos sobre tu cuenta (seguridad, suspensión) siempre se envían.",
    subjectRequired: "Ingresa el asunto del comunicado.",
    subjectTooLong: (p: Params) => `El asunto puede tener como máximo ${p.max} caracteres.`,
    messageRequired: "Escribe el mensaje del comunicado.",
    messageTooLong: (p: Params) => `El mensaje puede tener como máximo ${p.max} caracteres.`,
    chooseRecipients: "Elige al menos un miembro.",
    noRecipientReceives: "Ninguno de los miembros elegidos recibe correos de comunicados.",
    noName: "Sin nombre",
    broadcastSummary: (p: Params) =>
      `Comunicado enviado: ${plural(Number(p.queued), "correo en cola", "correos en cola")}.` +
      (Number(p.skipped) > 0
        ? ` ${plural(Number(p.skipped), "miembro desactivó", "miembros desactivaron")} los correos y no lo recibirá${Number(p.skipped) === 1 ? "" : "n"}.`
        : ""),
  },
} satisfies Record<Locale, Record<string, Message>>;

export type MessageKey = keyof typeof messages.pt;

export function t(locale: Locale, key: MessageKey, params: Params = {}) {
  const message: Message = messages[locale][key];
  return typeof message === "function" ? message(params) : message;
}

function matchLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("pt")) return "pt";
  if (normalized.startsWith("es")) return "es";
  return null;
}

/**
 * Mesma regra do frontend (useTranslation): `users/{uid}.locale` se for pt/es,
 * senão o idioma principal do navegador (Accept-Language), senão inglês.
 */
export async function resolveLocale(req: Request & { uid?: string }): Promise<Locale> {
  if (req.uid) {
    try {
      const fromProfile = matchLocale((await db.collection("users").doc(req.uid).get()).get("locale"));
      if (fromProfile) return fromProfile;
    } catch {
      // cai para o idioma do navegador
    }
  }

  return matchLocale(req.headers["accept-language"]?.split(",")[0]) ?? "en";
}
