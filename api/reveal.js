import { revealOne, sweepPending } from '../lib/revealCore.js';

/**
 * /api/reveal
 *   POST { requestId }  -> déclenché par le front juste après le commit (quasi-instantané)
 *   GET  (cron Vercel)  -> filet de secours : balaye les requêtes restées en attente
 *
 * La clé privée vit dans les env vars Vercel (process.env.REVEAL_PRIVATE_KEY),
 * jamais dans le bundle navigateur. Voir lib/revealCore.js.
 */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Cron Vercel envoie Authorization: Bearer ${CRON_SECRET}. On le vérifie
      // pour éviter qu'un tiers déclenche le sweep (définis CRON_SECRET en env).
      const auth = req.headers['authorization'] || '';
      if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const revealed = await sweepPending();
      return res.status(200).json({ ok: true, revealed });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
      const requestId = String(body.requestId ?? body.request_id ?? '').trim();
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      const done = await revealOne(requestId);
      return res.status(200).json({ ok: true, revealed: done ? [requestId] : [] });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error('[api/reveal]', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
