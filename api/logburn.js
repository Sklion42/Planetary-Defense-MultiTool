import { fetchLogburnFromTx } from '../lib/logburnCore.js';

/**
 * /api/logburn?txId=<64 hex>
 *
 * Cloud Wallet et la plupart des wallets mobiles renvoient un résultat de
 * transaction SANS traces d'actions : le front ne peut alors pas lire
 * ascend.pdef::logburn, donc pas de request_id, donc pas de reveal — les NFT
 * restent en escrow. Cette route relit la transaction on-chain (history v1 puis
 * Hyperion v2) et renvoie le request_id.
 */
export default async function handler(req, res) {
  const txId = String(
    (req.query && (req.query.txId ?? req.query.txid)) ??
      (req.body && typeof req.body === 'object' ? req.body.txId : '') ??
      ''
  ).trim();

  if (!txId) return res.status(400).json({ ok: false, error: 'txId required' });

  try {
    const found = await fetchLogburnFromTx(txId);
    return res.status(200).json({ ok: true, ...found });
  } catch (err) {
    const message = String(err?.message || err);
    const status = /invalid_tx_id/.test(message) ? 400 : 404;
    return res.status(status).json({ ok: false, error: message });
  }
}
