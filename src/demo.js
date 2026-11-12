// BlazeEscrow narrated demo.
//
// Default mode runs the full escrow lifecycle against CashScript's
// MockNetworkProvider: every transaction is evaluated by the real BCH
// script VM, only the network itself is local. Run:  npm run demo
//
// Live mode (`node src/demo.js --live`) uses the exact same code paths
// against chipnet Electrum servers and throwaway wallets persisted in
// demo-wallets.json (gitignored). It needs an unrestricted network and
// faucet-funded wallets; it prints the funding addresses and stops if the
// wallets are empty.
import { MockNetworkProvider, ElectrumNetworkProvider, Network, randomUtxo } from 'cashscript';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { walletFromPrivateKey, createWallet } from './wallet.js';
import { createEscrow, getEscrowState, settleEscrow } from './escrow.js';

const line = (s = '') => console.log(s);
const keyFromLabel = (label) =>
  new Uint8Array(createHash('sha256').update(`blaze-escrow-demo:${label}`).digest());

async function mockDemo() {
  line('=== BlazeEscrow demo (mock network, real contract evaluation) ===');
  line();
  const buyer = walletFromPrivateKey(keyFromLabel('buyer'));
  const seller = walletFromPrivateKey(keyFromLabel('seller'));
  const arbiter = walletFromPrivateKey(keyFromLabel('arbiter'));
  line(`Buyer   (an AI agent buying a dataset): ${buyer.address}`);
  line(`Seller  (an AI agent selling it):       ${seller.address}`);
  line(`Arbiter (trusted dispute resolver):     ${arbiter.address}`);
  line();

  const provider = new MockNetworkProvider();

  // --- Escrow 1: happy path -------------------------------------------------
  const deadline = Math.floor(Date.now() / 1000) + 24 * 3600;
  const escrow = createEscrow(provider, { buyer, seller, arbiter }, deadline);
  line(`Escrow contract address: ${escrow.address}`);
  const fundingUtxo = { ...randomUtxo(), satoshis: 100_000n, lockingBytecode: escrow.lockingBytecode };
  provider.addUtxo(escrow.address, fundingUtxo);
  let state = await getEscrowState(escrow);
  line(`Buyer funds the escrow with 100,000 sats. Balance: ${state.balance} sats`);
  line();

  line('Seller tries to grab the money directly (release signed by seller)...');
  try {
    await settleEscrow({ contract: escrow, utxo: fundingUtxo, action: 'release', signer: seller, recipientAddress: seller.address });
    line('  !! UNEXPECTED SUCCESS');
  } catch (e) {
    line(`  -> REJECTED by the covenant: ${String(e.message).split('\n')[0]}`);
  }
  line();
  line('Buyer confirms delivery and releases...');
  const rel = await settleEscrow({ contract: escrow, utxo: fundingUtxo, action: 'release', signer: buyer, recipientAddress: seller.address });
  const sellerUtxos = await provider.getUtxos(seller.address);
  line(`  -> settled in tx ${rel.txid}`);
  line(`  -> seller balance: ${sellerUtxos.reduce((s, u) => s + u.satoshis, 0n)} sats (escrow minus miner fee)`);
  line();

  // --- Escrow 2: deadline refund --------------------------------------------
  const deadline2 = Math.floor(Date.now() / 1000) + 3600;
  const escrow2 = createEscrow(provider, { buyer, seller, arbiter }, deadline2);
  const fundingUtxo2 = { ...randomUtxo(), satoshis: 50_000n, lockingBytecode: escrow2.lockingBytecode };
  provider.addUtxo(escrow2.address, fundingUtxo2);
  line(`Second escrow funded with 50,000 sats, deadline in 1 hour.`);
  line('Buyer tries to refund early...');
  try {
    await settleEscrow({ contract: escrow2, utxo: fundingUtxo2, action: 'refund', signer: buyer, recipientAddress: buyer.address, locktime: deadline2 - 60 });
    line('  !! UNEXPECTED SUCCESS');
  } catch (e) {
    line(`  -> REJECTED by the covenant: ${String(e.message).split('\n')[0]}`);
  }
  line('Deadline passes; buyer reclaims the funds...');
  const ref = await settleEscrow({ contract: escrow2, utxo: fundingUtxo2, action: 'refund', signer: buyer, recipientAddress: buyer.address, locktime: deadline2 });
  line(`  -> settled in tx ${ref.txid}`);
  line();
  line('=== Demo complete: the covenant enforced every rule. ===');
}

async function liveDemo() {
  line('=== BlazeEscrow demo (LIVE chipnet) ===');
  const provider = new ElectrumNetworkProvider(Network.CHIPNET);
  try {
    line(`chipnet block height: ${await provider.getBlockHeight()}`);
  } catch (e) {
    line(`Cannot reach chipnet Electrum from this network: ${e.message}`);
    line('Re-run from an unrestricted connection. No funds were touched.');
    return;
  }
  const walletFile = new URL('../demo-wallets.json', import.meta.url);
  let wallets;
  if (existsSync(walletFile)) {
    const saved = JSON.parse(readFileSync(walletFile, 'utf8'));
    const { walletFromWif } = await import('./wallet.js');
    wallets = Object.fromEntries(Object.entries(saved).map(([k, wif]) => [k, walletFromWif(wif)]));
  } else {
    wallets = { buyer: createWallet(), seller: createWallet(), arbiter: createWallet() };
    writeFileSync(walletFile, JSON.stringify(
      Object.fromEntries(Object.entries(wallets).map(([k, w]) => [k, w.wif])), null, 2));
    line('Created throwaway chipnet wallets in demo-wallets.json (gitignored).');
  }
  for (const [role, w] of Object.entries(wallets)) {
    const utxos = await provider.getUtxos(w.address);
    const bal = utxos.reduce((s, u) => s + u.satoshis, 0n);
    line(`${role}: ${w.address} — ${bal} sats`);
  }
  line('Fund the buyer wallet from a chipnet faucet, then re-run to execute a live escrow.');
}

if (process.argv.includes('--live')) {
  await liveDemo();
} else {
  await mockDemo();
}
