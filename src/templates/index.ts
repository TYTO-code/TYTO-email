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

/** "dayvid@gmail.com" → "d•••••@gmail.com" (não expõe o endereço inteiro). */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export function recruitWelcomeEmail(input: { name: string; email: string; setPasswordLink: string }) {
  return renderLayout({
    subject: "Bem-vindo(a) ao TYTO.club",
    eyebrow: "Boas-vindas",
    heading: `Olá, ${input.name}!`,
    paragraphs: [
      "Você foi recrutado(a) pelo Conselho e sua conta no TYTO.club foi criada.",
      `Seu e-mail de acesso é ${input.email}. Para entrar, crie a sua própria senha pelo botão abaixo — o link vale por 1 hora. Se ele expirar, use "Esqueci minha senha" na tela de login.`,
      "Complete missões para ganhar XP e Dracmas, suba de patente, desbloqueie conquistas e participe dos projetos da comunidade.",
    ],
    cta: { label: "Criar minha senha", url: input.setPasswordLink },
  });
}

export function googleWelcomeEmail(input: { name: string; email: string; appUrl: string }) {
  return renderLayout({
    subject: "Bem-vindo(a) ao TYTO.club",
    eyebrow: "Boas-vindas",
    heading: `Olá, ${input.name}!`,
    paragraphs: [
      `Sua conta no TYTO.club foi criada. Para entrar, use "Entrar com Google" com a conta ${input.email}.`,
      "Complete missões para ganhar XP e Dracmas, suba de patente, desbloqueie conquistas e participe dos projetos da comunidade.",
    ],
    cta: { label: "Entrar", url: input.appUrl },
  });
}

export function passwordResetEmail(input: { name: string; link: string }) {
  return renderLayout({
    subject: "Redefinição de senha do TYTO.club",
    eyebrow: "Segurança da conta",
    heading: "Redefina sua senha",
    paragraphs: [
      `Olá, ${input.name}. Recebemos um pedido para criar uma nova senha para a sua conta.`,
      "O link abaixo vale por 1 hora. Se não foi você, ignore este e-mail — sua senha atual continua valendo.",
    ],
    cta: { label: "Criar nova senha", url: input.link },
  });
}

export function loginEmailChangedOldEmail(input: { name: string; newEmail: string }) {
  return renderLayout({
    subject: "Seu e-mail de login no TYTO.club foi alterado",
    eyebrow: "Segurança da conta",
    heading: "Seu e-mail de login foi alterado",
    paragraphs: [
      `Olá, ${input.name}. O e-mail de login da sua conta foi trocado para ${maskEmail(input.newEmail)}. Este endereço não receberá mais e-mails do TYTO.club.`,
      "Se não foi você, fale com o Conselho imediatamente para recuperar o acesso.",
    ],
  });
}

export function loginEmailChangedNewEmail(input: { name: string; appUrl: string }) {
  return renderLayout({
    subject: "Este agora é o seu e-mail de login no TYTO.club",
    eyebrow: "Segurança da conta",
    heading: "E-mail de login atualizado",
    paragraphs: [`Olá, ${input.name}. A partir de agora, use este endereço para entrar no TYTO.club.`],
    cta: { label: "Entrar", url: input.appUrl },
  });
}
