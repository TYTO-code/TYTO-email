import { renderLayout } from "./layout";

export function notificationEmail(input: { title: string; message: string; appUrl: string }) {
  return renderLayout({
    subject: input.title,
    eyebrow: "Notificação",
    heading: input.title,
    paragraphs: [input.message],
    cta: { label: "Abrir o TYTO.club", url: input.appUrl },
  });
}

export function welcomeEmail(input: { name: string; appUrl: string }) {
  return renderLayout({
    subject: "Bem-vindo(a) ao TYTO.club",
    eyebrow: "Boas-vindas",
    heading: `Olá, ${input.name}!`,
    paragraphs: [
      "Sua conta no TYTO.club foi criada.",
      "Complete missões para ganhar XP e Dracmas, suba de patente, desbloqueie conquistas e participe dos projetos da comunidade.",
    ],
    cta: { label: "Entrar", url: input.appUrl },
  });
}

export function suspensionEmail(input: { name: string; reason?: string | null; appUrl: string }) {
  const reasonText =
    input.reason === "negative_balance"
      ? "Seu saldo de Dracmas ficou negativo."
      : "Sua conta foi suspensa pelo Conselho.";

  return renderLayout({
    subject: "Sua conta no TYTO.club foi suspensa",
    eyebrow: "Aviso de conta",
    heading: "Sua conta foi suspensa",
    paragraphs: [
      `Olá, ${input.name}. ${reasonText}`,
      "Para entender o motivo e regularizar sua situação, fale com o Conselho.",
    ],
    cta: { label: "Acessar minha conta", url: input.appUrl },
  });
}

export function reactivationEmail(input: { name: string; appUrl: string }) {
  return renderLayout({
    subject: "Sua conta no TYTO.club foi reativada",
    eyebrow: "Aviso de conta",
    heading: "Sua conta foi reativada",
    paragraphs: [`Olá, ${input.name}. Sua suspensão foi encerrada e você já pode voltar a participar normalmente.`],
    cta: { label: "Entrar", url: input.appUrl },
  });
}

export function broadcastEmail(input: { subject: string; message: string; appUrl: string }) {
  return renderLayout({
    subject: input.subject,
    eyebrow: "Comunicado do Conselho",
    heading: input.subject,
    paragraphs: input.message.split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.trim()),
    cta: { label: "Abrir o TYTO.club", url: input.appUrl },
  });
}
