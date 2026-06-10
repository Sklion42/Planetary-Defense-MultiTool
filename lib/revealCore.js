/**
 * Logique de reveal côté SERVEUR (fonctions Vercel uniquement).
 * Ne jamais importer ce module dans le code front : il lit la clé privée.
 *
 * ⚠️ SEED : générée ici avec crypto.randomBytes (CSPRNG). Jamais Math.random,
 * jamais l'heure, jamais un compteur, jamais une valeur on-chain — tout cela
 * serait prédictible par le joueur. La seed n'existe qu'au moment du reveal,
 * donc le joueur ne peut pas la connaître au commit : c'est ça qui ferme l'exploit.
 *
 * Variables d'environnement (à définir dans Vercel > Settings > Environment Variables,
 * JAMAIS dans le repo) :
 *   REVEAL_PRIVATE_KEY   (obligatoire)  clé du signataire du reveal
 *   REVEAL_ACTOR         (def: botplanetary)
 *   REVEAL_PERMISSION    (def: active)  idéalement une permission dédiée linkauth -> reveal
 *   WAX_RPC              (def: liste greymass/waxsweden/eosphere séparée par des virgules)
 *   MIN_COMMIT_AGE_SEC   (def: 3)       attendre la quasi-irréversibilité avant de révéler
 */

import crypto from 'node:crypto';
import { Session } from '@wharfkit/session';
import { WalletPluginPrivateKey } from '@wharfkit/wallet-plugin-privatekey';

const CONTRACT = 'ascend.pdef';
const CHAIN_ID = '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4';
const REVEAL_ACTOR = process.env.REVEAL_ACTOR || 'botplanetary';
const REVEAL_PERMISSION = process.env.REVEAL_PERMISSION || 'active';
const PRIVATE_KEY = process.env.REVEAL_PRIVATE_KEY;
const RPCS = (process.env.WAX_RPC ||
  'https://wax.greymass.com,https://api.waxsweden.org,https://wax.eosphere.io'
).split(',').map(s => s.trim()).filter(Boolean);
const MIN_AGE_SEC = Number(process.env.MIN_COMMIT_AGE_SEC || 3);

function secureSeedUint64() {
  return crypto.randomBytes(8).readBigUInt64BE(0).toString();
}
function seedCommitment(seedStr) {
  return crypto.createHash('sha256').update(seedStr).digest('hex');
}
function nowSec() { return Math.floor(Date.now() / 1000); }

let rpcIndex = 0;
async function rpc(path, body) {
  const errors = [];
  for (let i = 0; i < RPCS.length; i += 1) {
    const base = RPCS[(rpcIndex + i) % RPCS.length];
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rpcIndex = (rpcIndex + i) % RPCS.length;
      return await res.json();
    } catch (err) {
      errors.push(`${base}: ${err.message || err}`);
    }
  }
  throw new Error(`RPC failed -> ${errors.join(' | ')}`);
}

async function fetchRow(requestId) {
  const id = String(requestId);
  const data = await rpc('/v1/chain/get_table_rows', {
    json: true, code: CONTRACT, scope: CONTRACT, table: 'pendingburns',
    lower_bound: id, upper_bound: id, limit: 1, reverse: false, show_payer: false,
  });
  return Array.isArray(data?.rows) && data.rows.length ? data.rows[0] : null;
}

async function fetchAllRows() {
  const data = await rpc('/v1/chain/get_table_rows', {
    json: true, code: CONTRACT, scope: CONTRACT, table: 'pendingburns',
    limit: 1000, reverse: false, show_payer: false,
  });
  return Array.isArray(data?.rows) ? data.rows : [];
}

function makeSession() {
  if (!PRIVATE_KEY) throw new Error('REVEAL_PRIVATE_KEY manquant (env Vercel, jamais dans le code).');
  return new Session({
    chain: { id: CHAIN_ID, url: RPCS[rpcIndex] },
    actor: REVEAL_ACTOR,
    permission: REVEAL_PERMISSION,
    walletPlugin: new WalletPluginPrivateKey(PRIVATE_KEY),
  });
}

async function doReveal(requestId) {
  const seed = secureSeedUint64();
  const res = await makeSession().transact({
    action: {
      account: CONTRACT,
      name: 'reveal',
      authorization: [{ actor: REVEAL_ACTOR, permission: REVEAL_PERMISSION }],
      data: { request_id: requestId, seed },
    },
  }, { blocksBehind: 3, expireSeconds: 60 });
  const txid = String(res?.response?.transaction_id || res?.resolved?.transaction?.id || '');
  // Empreinte loggée APRÈS coup (audit). Pour du trustless, publie sha256(seed) AVANT (hash chain).
  console.log(`[reveal] #${requestId} tx=${txid} seed_sha256=${seedCommitment(seed)}`);
  return txid;
}

const isNotFound = (e) => /not found/i.test(String(e?.message || e));

// Révèle UNE requête (déclenché à la demande par le front juste après le commit).
export async function revealOne(requestId) {
  const row = await fetchRow(requestId);
  if (!row) return false; // déjà résolue / inexistante
  if (nowSec() - Number(row.commit_time || 0) < MIN_AGE_SEC) return false; // pas assez vieille
  try { await doReveal(String(row.request_id)); return true; }
  catch (e) { if (isNotFound(e)) return false; throw e; }
}

// Balaye toutes les requêtes en attente (filet de secours / cron).
export async function sweepPending() {
  const rows = await fetchAllRows();
  const done = [];
  for (const row of rows) {
    if (nowSec() - Number(row.commit_time || 0) < MIN_AGE_SEC) continue;
    try { await doReveal(String(row.request_id)); done.push(String(row.request_id)); }
    catch (e) { if (!isNotFound(e)) console.error(`[sweep] #${row.request_id}`, e?.message || e); }
  }
  return done;
}
