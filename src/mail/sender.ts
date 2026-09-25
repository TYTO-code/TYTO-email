export class SendError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface SendInput {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** O Resend descarta reenvios com a mesma chave por 24h — evita duplicata em nova tentativa. */
  idempotencyKey: string;
}

/** Envia pela API REST do Resend (https://resend.com/docs/api-reference/emails/send-email). */
export async function sendWithResend(input: SendInput): Promise<string> {
  const baseUrl = process.env.RESEND_API_URL ?? "https://api.resend.com";

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
  } catch (err) {
    throw new SendError(`Falha de rede ao chamar o Resend: ${(err as Error).message}`, true);
  }

  const body: any = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new SendError(
      `Resend HTTP ${response.status}: ${body?.message ?? "sem detalhes"}`,
      response.status === 429 || response.status >= 500
    );
  }

  return String(body?.id ?? "");
}
