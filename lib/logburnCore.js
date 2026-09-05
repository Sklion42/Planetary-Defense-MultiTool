/**
 * Relecture on-chain d'une transaction de burn pour en extraire
 * ascend.pdef::logburn.request_id.
 *
 * Utilisé côté serveur uniquement (fonction Vercel /api/logburn) : les nœuds
 * d'historique n'exposent pas toujours CORS, et le front n'a de toute façon pas
 * à connaître la liste des endpoints.
 */

const CONTRACT = 'ascend.pdef';

const HISTORY_RPCS = (
  process.env.WAX_RPC ||
  'https://wax.greymass.com,https://api.waxsweden.org,https://wax.eosphere.io'
)
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const HYPERION_BASES = (
  process.env.WAX_HYPERION ||
  'https://wax.eosrio.io,https://wax.greymass.com,https://api.waxsweden.org'
)
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

/**
 * Parcourt n'importe quelle forme de payload (résultat wallet, history v1,
 * Hyperion v2) à la recherche de l'action logburn. Les traces sont imbriquées
 * différemment selon la source, d'où la visite récursive plutôt qu'un chemin fixe.
 */
export function extractLogburnFromTxPayload(payload) {
  let found = null;
  const seen = new WeakSet();

  const visit = (node, depth) => {
    if (!node || found || depth > 40) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    const act = node.act || null;
    const account = String(act?.account || node.account || node.receiver || '');
    const name = String(act?.name || node.name || node.action || '');
    if (account === CONTRACT && name === 'logburn') {
      const data = act?.data || node.data || {};
      const requestId = String(data.request_id ?? data.requestId ?? '').trim();
      if (requestId) {
        found = {
          requestId,
          guaranteed: Number(data.guaranteed_total || data.guaranteed || 0) || 0,
          max: Number(data.max_total || data.max || 0) || 0
        };
        return;
      }
    }

    Object.values(node).forEach(value => visit(value, depth + 1));
  };

  visit(payload, 0);
  return found;
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchLogburnFromTx(txId) {
  const id = String(txId || '').trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid_tx_id');

  const errors = [];

  for (const base of HISTORY_RPCS) {
    try {
      const json = await fetchJson(`${base}/v1/history/get_transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const found = extractLogburnFromTxPayload(json);
      if (found) return found;
      errors.push(`${base}/history: no_logburn`);
    } catch (err) {
      errors.push(`${base}/history: ${err?.message || err}`);
    }
  }

  for (const base of HYPERION_BASES) {
    try {
      const json = await fetchJson(`${base}/v2/history/get_transaction?id=${encodeURIComponent(id)}`);
      const found = extractLogburnFromTxPayload(json);
      if (found) return found;
      errors.push(`${base}/v2: no_logburn`);
    } catch (err) {
      errors.push(`${base}/v2: ${err?.message || err}`);
    }
  }

  throw new Error(errors.slice(0, 4).join(' | ') || 'logburn_not_found');
}
