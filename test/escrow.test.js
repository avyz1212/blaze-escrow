// BlazeEscrow contract tests.
// Everything runs against CashScript's MockNetworkProvider: transactions are
// evaluated by the real BCH script VM against a local UTXO set, so passing
// and failing paths are genuine contract behaviour — only the network is fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { createHash } from 'node:crypto';
import { walletFromPrivateKey } from '../src/wallet.js';
import { createEscrow, getEscrowState, settleEscrow } from '../src/escrow.js';

const keyFromLabel = (label) =>
  new Uint8Array(createHash('sha256').update(`blaze-escrow-test:${label}`).digest());

const buyer = walletFromPrivateKey(keyFromLabel('buyer'));
const seller = walletFromPrivateKey(keyFromLabel('seller'));
const arbiter = walletFromPrivateKey(keyFromLabel('arbiter'));
const stranger = walletFromPrivateKey(keyFromLabel('stranger'));

const DEADLINE = 1_800_000_000; // fixed unix timestamp used as the escrow deadline
const ESCROW_SATS = 100_000n;

async function fundedEscrow() {
  const provider = new MockNetworkProvider();
  const contract = createEscrow(provider, { buyer, seller, arbiter }, DEADLINE);
  const utxo = { ...randomUtxo(), satoshis: ESCROW_SATS, lockingBytecode: contract.lockingBytecode };
  provider.addUtxo(contract.address, utxo);
  return { provider, contract, utxo };
}

const balanceOf = async (provider, address) =>
  (await provider.getUtxos(address)).reduce((sum, u) => sum + u.satoshis, 0n);

test('contract compiles and has a chipnet P2SH32 address', async () => {
  const { contract } = await fundedEscrow();
  assert.match(contract.address, /^bchtest:p/);
});

test('buyer releases: seller receives the escrow minus fees', async () => {
  const { provider, contract, utxo } = await fundedEscrow();
  const { txid } = await settleEscrow({
    contract, utxo, action: 'release', signer: buyer, recipientAddress: seller.address,
  });
  assert.ok(txid);
  const sellerBalance = await balanceOf(provider, seller.address);
  assert.ok(sellerBalance >= ESCROW_SATS - 3000n, `seller got ${sellerBalance}`);
  const state = await getEscrowState(contract);
  assert.equal(state.balance, 0n);
});

test('arbiter releases on behalf of the seller', async () => {
  const { provider, contract, utxo } = await fundedEscrow();
  await settleEscrow({
    contract, utxo, action: 'release', signer: arbiter, recipientAddress: seller.address,
  });
  assert.ok((await balanceOf(provider, seller.address)) >= ESCROW_SATS - 3000n);
});

test('seller cannot release the escrow to themselves', async () => {
  const { contract, utxo } = await fundedEscrow();
  await assert.rejects(settleEscrow({
    contract, utxo, action: 'release', signer: seller, recipientAddress: seller.address,
  }));
});

test('a stranger cannot touch the escrow at all', async () => {
  const { contract, utxo } = await fundedEscrow();
  await assert.rejects(settleEscrow({
    contract, utxo, action: 'release', signer: stranger, recipientAddress: stranger.address,
  }));
  await assert.rejects(settleEscrow({
    contract, utxo, action: 'refund', signer: stranger, recipientAddress: stranger.address,
  }));
});

test('buyer cannot refund before the deadline', async () => {
  const { contract, utxo } = await fundedEscrow();
  await assert.rejects(settleEscrow({
    contract, utxo, action: 'refund', signer: buyer,
    recipientAddress: buyer.address, locktime: DEADLINE - 100,
  }));
});

test('buyer can refund after the deadline', async () => {
  const { provider, contract, utxo } = await fundedEscrow();
  await settleEscrow({
    contract, utxo, action: 'refund', signer: buyer,
    recipientAddress: buyer.address, locktime: DEADLINE,
  });
  assert.ok((await balanceOf(provider, buyer.address)) >= ESCROW_SATS - 3000n);
});

test('arbiter can refund at any time', async () => {
  const { provider, contract, utxo } = await fundedEscrow();
  await settleEscrow({
    contract, utxo, action: 'refund', signer: arbiter, recipientAddress: buyer.address,
  });
  assert.ok((await balanceOf(provider, buyer.address)) >= ESCROW_SATS - 3000n);
});

test('theft attempt: release that pays the buyer instead of the seller is rejected', async () => {
  const { provider, contract, utxo } = await fundedEscrow();
  await assert.rejects(settleEscrow({
    contract, utxo, action: 'release', signer: buyer, recipientAddress: buyer.address,
  }));
  // Funds are untouched after the failed attempt.
  const state = await getEscrowState(contract);
  assert.equal(state.balance, ESCROW_SATS);
  assert.ok(provider);
});
