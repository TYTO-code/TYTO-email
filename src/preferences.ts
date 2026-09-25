import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";
import { Locale, t } from "./i18n";

/**
 * Preferências de e-mail de cada membro, em `email_preferences/{uid}`.
 * Sem documento = tudo ativado. E-mails de conta (`account`) ignoram as
 * preferências — são sempre enviados.
 */
export const preferencesCollection = db.collection("email_preferences");

export async function isNotificationsEnabled(uid: string) {
  const snap = await preferencesCollection.doc(uid).get();
  return snap.get("notifications") !== false;
}

export async function listOptedOutUids(): Promise<Set<string>> {
  const snap = await preferencesCollection.where("notifications", "==", false).select().get();
  return new Set(snap.docs.map((doc) => doc.id));
}

export async function setNotificationsEnabled(uid: string, enabled: boolean) {
  await preferencesCollection
    .doc(uid)
    .set({ notifications: enabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Formato pronto para o frontend renderizar (rótulos e textos vêm daqui, no idioma do membro). */
export function describePreferences(notificationsEnabled: boolean, locale: Locale) {
  return {
    preferences: [
      {
        key: "notifications",
        label: t(locale, "notificationsLabel"),
        description: t(locale, "notificationsDescription"),
        enabled: notificationsEnabled,
      },
    ],
  };
}
