// Minimal throwaway-wallet helpers built on libauth.
// These keys are ONLY ever used on chipnet (the BCH test network whose coins
// are worthless) or with the local mock provider. Never use them on mainnet.
import {
  secp256k1,
  hash160,
  encodeCashAddress,
  encodePrivateKeyWif,
  decodePrivateKeyWif,
  hexToBin,
  binToHex,
} from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';

export const NETWORK_PREFIX = { chipnet: 'bchtest', mainnet: 'bitcoincash' };

/** Create a fresh random wallet. Returns { privateKey: Uint8Array, publicKey, wif, address, tokenAddress } */
export function createWallet(network = 'chipnet') {
  const privateKey = new Uint8Array(randomBytes(32));
  return walletFromPrivateKey(privateKey, network);
}

/** Derive all wallet views from a 32-byte private key. */
export function walletFromPrivateKey(privateKey, network = 'chipnet') {
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error('invalid private key');
  const pubkeyHash = hash160(publicKey);
  const prefix = NETWORK_PREFIX[network];
  const address = encodeCashAddress({ prefix, type: 'p2pkh', payload: pubkeyHash });
  const tokenAddress = encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload: pubkeyHash });
  if (typeof address === 'string' || typeof tokenAddress === 'string') throw new Error('address encoding failed');
  return {
    privateKey,
    publicKey,
    pubkeyHash,
    wif: encodePrivateKeyWif(privateKey, network === 'chipnet' ? 'testnet' : 'mainnet'),
    address: address.address,
    tokenAddress: tokenAddress.address,
  };
}

/** Restore a wallet from a WIF string (testnet WIF for chipnet). */
export function walletFromWif(wif, network = 'chipnet') {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(`bad WIF: ${decoded}`);
  return walletFromPrivateKey(decoded.privateKey, network);
}

export { hexToBin, binToHex };
