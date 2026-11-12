// BlazeEscrow core library: create escrow contracts and settle them.
// Works with any CashScript NetworkProvider (Electrum chipnet/mainnet, or the
// local MockNetworkProvider used by the demo and the tests).
import { Contract, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const artifact = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'Escrow.json'), 'utf8'),
);

// Miner-fee budget taken out of the escrow on settlement. The contract
// allows up to 3000 sats; we target ~1200 and return any spare fee-input
// money to the signer as change.
export const SETTLEMENT_FEE_SATS = 1200n;
const DUST = 546n;

/**
 * Create an escrow contract instance.
 * @param {object} provider CashScript NetworkProvider
 * @param {object} parties { buyer: wallet, seller: wallet, arbiter: wallet } (objects with .publicKey)
 * @param {number} timeout unix timestamp after which the buyer may refund
 */
export function createEscrow(provider, { buyer, seller, arbiter }, timeout) {
  const contract = new Contract(
    artifact,
    [buyer.publicKey, seller.publicKey, arbiter.publicKey, BigInt(timeout)],
    { provider, addressType: 'p2sh32' },
  );
  return contract;
}

/** Current escrow state: funded UTXOs sitting at the contract address. */
export async function getEscrowState(contract) {
  const utxos = await contract.getUtxos();
  const balance = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  return { address: contract.tokenAddress ?? contract.address, utxos, balance };
}

/**
 * Settle an escrow UTXO.
 * @param {object} args
 * @param {Contract} args.contract
 * @param {object} args.utxo the contract UTXO to spend
 * @param {'release'|'refund'} args.action
 * @param {object} args.signer wallet object (privateKey/publicKey/address) authorising the action
 * @param {string} args.recipientAddress who gets paid (seller for release, buyer for refund)
 * @param {object} [args.feeUtxo] optional UTXO from the signer's wallet to pay fees from
 * @param {number} [args.locktime] tx locktime (required for buyer refunds after the deadline)
 * @returns {Promise<{txid: string}>}
 */
export async function settleEscrow({ contract, utxo, action, signer, recipientAddress, feeUtxo, locktime = 0 }) {
  const provider = contract.provider;
  const template = new SignatureTemplate(signer.privateKey);
  const unlocker = action === 'release'
    ? contract.unlock.release(template, signer.publicKey)
    : contract.unlock.refund(template, signer.publicKey);

  const builder = new TransactionBuilder({ provider });
  builder.addInput(utxo, unlocker);
  if (feeUtxo) builder.addInput(feeUtxo, template.unlockP2PKH());

  const payout = utxo.satoshis - SETTLEMENT_FEE_SATS;
  builder.addOutput({ to: recipientAddress, amount: payout });

  if (feeUtxo) {
    // The fee input covers the real miner fee; return the rest to the signer.
    const change = feeUtxo.satoshis - 400n;
    if (change > DUST) builder.addOutput({ to: signer.address, amount: change });
  }
  if (locktime) builder.setLocktime(locktime);

  const result = await builder.send();
  return { txid: result.txid };
}
