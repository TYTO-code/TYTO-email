import type { RenderedMail } from "../mail/types";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Assunto em uma linha só e com tamanho razoável (evita header injection e assunto gigante). */
export function cleanSubject(value: string, max = 150) {
  const singleLine = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

export interface LayoutInput {
  subject: string;
  /** Rótulo pequeno acima do título (ex.: "Notificação"). */
  eyebrow: string;
  heading: string;
  /** Parágrafos em texto puro — são escapados; quebras de linha viram <br>. */
  paragraphs: string[];
  cta?: { label: string; url: string };
}

/**
 * Layout único de todos os e-mails: tabelas e estilos inline (o que os
 * clientes de e-mail suportam), no tema escuro do app.
 */
export function renderLayout(input: LayoutInput): RenderedMail {
  const subject = cleanSubject(input.subject);

  const paragraphsHtml = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#cbd5e1;">${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`
    )
    .join("");

  const ctaHtml = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:8px;background:#7c3aed;">
<a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 24px;font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">${escapeHtml(input.cta.label)}</a>
</td></tr></table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#020617;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 0 20px;font-size:18px;font-weight:900;letter-spacing:4px;color:#ffffff;">TYTO<span style="color:#22d3ee;">.club</span></td></tr>
<tr><td style="background:#0b1120;border:1px solid #1e293b;border-radius:12px;padding:32px 28px;">
<p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#a78bfa;">${escapeHtml(input.eyebrow)}</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:900;color:#ffffff;">${escapeHtml(input.heading)}</h1>
${paragraphsHtml}
${ctaHtml}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.5;color:#64748b;">Você recebeu este e-mail porque é membro do TYTO.club. Esta é uma mensagem automática — não responda.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    input.eyebrow.toUpperCase(),
    input.heading,
    "",
    ...input.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`, ""] : []),
    "—",
    "TYTO.club · mensagem automática, não responda.",
  ].join("\n");

  return { subject, html, text };
}
