import { auth } from "./firebaseAdmin";

/**
 * Link do Firebase Auth para criar/redefinir senha. O `continueUrl` leva de
 * volta ao login do app — se o domínio ainda não estiver autorizado no
 * Firebase Auth, gera o link sem ele (a página padrão do Firebase funciona igual).
 */
export async function generatePasswordLink(email: string, appUrl: string) {
  try {
    return await auth.generatePasswordResetLink(email, { url: `${appUrl.replace(/\/+$/, "")}/login` });
  } catch (err: any) {
    if (err?.code === "auth/unauthorized-continue-uri" || err?.code === "auth/invalid-continue-uri") {
      return auth.generatePasswordResetLink(email);
    }
    throw err;
  }
}
