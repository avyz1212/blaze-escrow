// BlazeEscrow demo server: zero-dependency static + JSON API server.
//
// The web demo runs the real compiled CashScript contract against a local
// MockNetworkProvider (real BCH script evaluation, local UTXO set), with
// built-in throwaway demo wallets. The same src/escrow.js code paths run
// against chipnet/mainnet through an ElectrumNetworkProvider — see README.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { createHash, randomUUID } from 'node:crypto';
import { walletFromPrivateKey } from './src/wallet.js';
import { createEscrow, getEscrowState, settleEscrow } from './src/escrow.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = process.env.PORT || 8377;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const keyFromLabel = (label) =>
  new Uint8Array(createHash('sha256').update(`blaze-escrow-demo:${label}`).digest());

const provider = new MockNetworkProvider();
const parties = {
  buyer: walletFromPrivateKey(keyFromLabel('buyer')),
  seller: walletFromPrivateKey(keyFromLabel('seller')),
  arbiter: walletFromPrivateKey(keyFromLabel('arbiter')),
  stranger: walletFromPrivateKey(keyFromLabel('stranger')),
};
const escrows = new Map();

async function partyBalances() {
  const out = {};
  for (const [role, w] of Object.entries(parties)) {
    if (role === 'stranger') continue;
    out[role] = (await provider.getUtxos(w.address)).reduce((s, u) => s + u.satoshis, 0n).toString();
  }
  return out;
}

const escrowView = (e) => ({
  id: e.id, address: e.contract.address, amountSats: e.amount.toString(),
  deadline: e.deadline, status: e.status, log: e.log,
});

async function handleApi(req, res, url, body) {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/api/parties') {
    return send(200, {
      parties: Object.fromEntries(Object.entries(parties).map(([k, w]) => [k, w.address])),
      balances: await partyBalances(),
      mode: 'mock',
    });
  }

  if (url.pathname === '/api/escrows' && req.method === 'POST') {
    const amount = BigInt(body.amountSats ?? 100000);
    const deadline = Math.floor(Date.now() / 1000) + Number(body.deadlineSeconds ?? 3600);
    const contract = createEscrow(provider, parties, deadline);
    const e = { id: randomUUID().slice(0, 8), contract, amount, deadline, status: 'created', utxo: null, log: [] };
    escrows.set(e.id, e);
    return send(201, escrowView(e));
  }

  const m = url.pathname.match(/^\/api\/escrows\/([\w-]+)(?:\/(fund|settle))?$/);
  if (!m) return send(404, { error: 'not found' });
  const e = escrows.get(m[1]);
  if (!e) return send(404, { error: 'escrow not found' });

  if (!m[2]) {
    const state = await getEscrowState(e.contract);
    return send(200, { ...escrowView(e), balance: state.balance.toString(), balances: await partyBalances() });
  }

  if (m[2] === 'fund' && req.method === 'POST') {
    if (e.status !== 'created') return send(400, { error: 'already funded' });
    e.utxo = { ...randomUtxo(), satoshis: e.amount, lockingBytecode: e.contract.lockingBytecode };
    provider.addUtxo(e.contract.address, e.utxo);
    e.status = 'funded';
    e.log.push(`Buyer funded the escrow with ${e.amount} sats.`);
    return send(200, escrowView(e));
  }

  if (m[2] === 'settle' && req.method === 'POST') {
    if (e.status !== 'funded') return send(400, { error: 'escrow is not in a funded state' });
    const action = body.action === 'refund' ? 'refund' : 'release';
    const signer = parties[body.signer] ?? parties.buyer;
    const correctRecipient = action === 'release' ? parties.seller : parties.buyer;
    // payTo: 'signer' is the theft attempt — the covenant must reject it
    // whenever the signer is not the rightful recipient.
    const recipient = body.payTo === 'signer' ? signer : correctRecipient;
    const locktime = action === 'refund' ? (body.when === 'after' ? e.deadline : e.deadline - 3600) : 0;
    try {
      const { txid } = await settleEscrow({
        contract: e.contract, utxo: e.utxo, action, signer,
        recipientAddress: recipient.address, locktime,
      });
      e.status = action === 'release' ? 'released' : 'refunded';
      e.log.push(`${action === 'release' ? 'Released' : 'Refunded'} by ${body.signer} in tx ${txid}`);
      return send(200, { ok: true, txid, escrow: escrowView(e), balances: await partyBalances() });
    } catch (err) {
      const message = String(err.message).split('\n')[0];
      e.log.push(`REJECTED (${action} signed by ${body.signer}): ${message}`);
      return send(200, { ok: false, error: message, escrow: escrowView(e) });
    }
  }

  return send(404, { error: 'not found' });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      }
      return await handleApi(req, res, url, body);
    }
    const path = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log(`BlazeEscrow demo at http://localhost:${PORT}`));
