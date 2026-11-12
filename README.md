# BlazeEscrow 🔥

**Trustless escrow for peer-to-peer and agent-to-agent payments on Bitcoin Cash.**

Built for **BCH BLAZE 2026** (Mainnet Track).

Two parties who have never met — a human and a merchant, or two AI agents —
agree on a price. The buyer locks the payment in a **CashScript covenant**
on Bitcoin Cash. The money can then go to exactly two places:

- **Release** → the seller, when the buyer (or an arbiter) confirms delivery.
- **Refund** → the buyer, when the arbiter intervenes, or the agreed deadline passes.

No company holds the funds. No administrator can redirect them — the
contract hard-codes the only legal recipient of each path, and Bitcoin Cash
miners enforce it. Settlement takes seconds and costs a fraction of a cent.

## Why this matters

AI agents and internet strangers can't open joint bank accounts, sign paper
contracts, or sue each other. Agent-to-agent commerce needs a neutral,
programmable cashier. BCH — with native covenants, 0-conf-friendly payments
and sub-cent fees — is the natural home for it. BlazeEscrow is a small,
complete version of that cashier: agree, fund, settle, with a dispute path
built in.

## How it works

1. **Agree** — buyer, seller, arbiter and a deadline define the contract.
   Those four values deterministically create the escrow address
   (`contracts/Escrow.cash`, ~400 bytes of compiled bytecode).
2. **Fund** — the buyer sends the agreed amount to the contract address.
3. **Settle** —
   - `release(sig, signer)`: buyer **or** arbiter signs → output 0 *must*
     pay the seller ≥ (escrow − 3000 sats of fees).
   - `refund(sig, signer)`: arbiter signs anytime, **or** buyer signs with
     `tx.locktime ≥ deadline` → output 0 *must* pay the buyer.
   - Everything else (seller self-release, strangers, early refunds,
     redirected outputs) fails script validation. The demo UI lets you
     try — the covenant's own error messages explain each rejection.

## Run it

```bash
npm install
npm test          # 9 contract tests: lifecycle + attack paths (mock network, real VM evaluation)
npm run demo      # narrated end-to-end lifecycle in the terminal
npm start         # web demo at http://localhost:8377
npm run compile   # rebuild contracts/Escrow.json from contracts/Escrow.cash
```

Live chipnet mode (same code, Electrum network provider, throwaway wallets):

```bash
node src/demo.js --live   # prints throwaway chipnet wallet addresses; fund the buyer from a faucet and re-run
node scripts/probe-chipnet.js  # connectivity check for chipnet Electrum
```

## What's real, what's simulated

Honesty table for this build (sandbox network restrictions prevented live
chipnet access from the build environment — the chipnet code path is
included and needs only an unrestricted connection + faucet coins):

| Piece | Status |
|---|---|
| CashScript escrow contract | ✅ Real — compiled with `cashc` 0.14, artifact in `contracts/Escrow.json` |
| Contract logic evaluation | ✅ Real — every demo/test transaction is evaluated by the actual BCH script VM (CashScript `MockNetworkProvider`) |
| Release / refund / deadline / theft-rejection flows | ✅ Real at the script level — see `docs/demo-run.txt` and `npm test` (9/9) |
| Network layer in the demo & web UI | 🧪 Simulated — local mock UTXO set instead of chipnet/mainnet |
| Chipnet deployment | 🛠️ Code-complete (`src/demo.js --live`, `ElectrumNetworkProvider`) — not yet broadcast; the build sandbox cannot reach chipnet Electrum (WebSocket blocked), and no faucet run was possible |
| Demo wallets | 🧪 Throwaway deterministic test identities, chipnet-format addresses, zero real funds |
| Mainnet | 🔒 Deliberately untouched — no mainnet keys, no mainnet funds. The same artifact deploys to mainnet unchanged; track eligibility steps are listed in the submission notes |
| Wallet connection (WizardConnect / XO) | 📝 Not yet integrated — the web demo uses built-in demo wallets; connecting a real wallet via WizardConnect or the XO template is a documented pre-submission step |

## Layout

```
contracts/Escrow.cash   the covenant (CashScript source)
contracts/Escrow.json   compiled artifact
src/escrow.js           create / inspect / settle escrows (any NetworkProvider)
src/wallet.js           throwaway wallet helpers (libauth)
src/demo.js             narrated CLI demo (mock + --live chipnet modes)
server.js               zero-dependency demo web server + JSON API
public/                 demo UI (includes the BLAZE banner; see public/config.js)
test/escrow.test.js     9 tests covering the lifecycle and attack paths
scripts/compile.js      cashc wrapper
docs/demo-run.txt       captured demo output
```

## Design choices

- **Recipient enforcement in-script.** Signatures alone don't stop a
  malicious client from paying the wrong address — so the covenant checks
  `tx.outputs[0]` locking bytecode and value directly.
- **One UTXO per escrow.** Simple, auditable, no change-output ambiguity.
- **Fee allowance, not fee exactness.** Settlement may spend up to 3000 sats
  of the escrow on miner fees (the app targets ~1200), so fee-market wiggle
  never bricks a settlement.
- **Arbiter as a first-class role.** Pure buyer/seller escrow deadlocks when
  parties disagree; the arbiter path resolves disputes in either direction
  while still being unable to pay anyone except buyer or seller.

## License

MIT
