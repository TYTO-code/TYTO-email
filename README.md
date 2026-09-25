# TYTO-email

Sistema de e-mails do TYTO.club: Cloud Functions (2ª geração) + fila no
Firestore + [Resend](https://resend.com).

## Como funciona

```
notifications/{id} criada ─┐
users/{uid} criado ────────┼─► mail/{mailId} (fila) ─► deliverMail ─► Resend
users/{uid}.suspended muda ┤        ▲                     (1 por vez)
POST /api/email/broadcast ─┘        └── sweepMail (a cada 10 min: novas tentativas)
```

| E-mail | Gatilho | Categoria |
| --- | --- | --- |
| Espelho de notificação | doc novo em `notifications` | `notification` |
| Boas-vindas | doc novo em `users` | `account` |
| Conta suspensa / reativada | `users/{uid}.suspended` muda | `account` |
| Comunicado do Conselho | `POST /api/email/broadcast` (admin) | `broadcast` |

- **Destinatário:** `users/{uid}.email`; se não tiver, o e-mail do Firebase Auth.
- **Opt-out:** `users/{uid}.emailNotifications === false` bloqueia `notification`
  e `broadcast`. E-mails de conta são sempre enviados.
- **Proteção contra abuso:** as regras do Firestore deixam qualquer membro criar
  notificação para qualquer pessoa. Por isso o conteúdo é escapado no template,
  `userId: 'all'` não vira e-mail e cada membro recebe no máximo
  `NOTIFICATION_EMAILS_PER_HOUR` e-mails de notificação por hora (o resto fica
  só no app, com status `skipped` / `rate_limited`).
- **Notificação sem e-mail:** um backend pode gravar `email: false` na notificação.
- **Sem duplicatas:** ids determinísticos na fila (`notification_{id}`,
  `welcome_{uid}`...), reserva do doc por transação antes de enviar e
  `Idempotency-Key` no Resend.
- **Novas tentativas:** erros temporários (rede, 429, 5xx) vão para `retry` com
  espera crescente (5, 10, 20, 40 min), até 5 tentativas; depois `error`.
  O `sweepMail` também recupera envios travados e itens da fila cujo trigger se perdeu.

### Status de `mail/{mailId}`

`pending` → `processing` → `sent` | `retry` | `error` | `skipped` (`skipReason`:
`opted_out`, `no_email`, `rate_limited`).

Outros backends podem enfileirar e-mails gravando direto em `mail` com
`{ to? , toUid?, category, subject, html, text, status: "pending", attempts: 0, createdAt }`.
A coleção não tem regra no `firestore.rules`, então só o Admin SDK acessa.

## Comunicado do Conselho

```
POST https://<região>-<projeto>.cloudfunctions.net/emailApi/api/email/broadcast
Authorization: Bearer <Firebase ID token de um admin>
{ "subject": "Assembleia sábado", "message": "Texto.\n\nOutro parágrafo.", "userIds": ["opcional"] }
```

Sem `userIds`, vai para todos os membros. Resposta:
`{ "success": true, "data": { "broadcastId": "...", "queued": 42 } }`.
Cada envio fica registrado em `mail_broadcasts`.

## Configuração e deploy

1. Verifique o domínio `tyto.club` no Resend (registros DNS) e crie uma API key.
2. `firebase functions:secrets:set RESEND_API_KEY`
3. `cp .env.example .env` e ajuste. **`FUNCTIONS_REGION` precisa ser a mesma
   localização do banco Firestore.**
4. `npm install && npm run deploy`

O codebase `tyto-email` é separado, então o deploy não mexe em outras functions do projeto.

## Desenvolvimento

```bash
npm run build      # compila para lib/
npm run serve      # emuladores de Functions + Firestore + Auth
```

Nos emuladores, use `.env.local` (com `RESEND_API_URL` apontando para um servidor
de teste, se quiser) e `.secret.local` com `RESEND_API_KEY=...`.
