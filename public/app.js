// BlazeEscrow demo frontend: drives the JSON API in server.js.
const $ = (id) => document.getElementById(id);
let escrowId = null;

const cfg = window.BLAZE_CONFIG || {};
$('banner-presentation').href = cfg.presentationUrl || '#';
$('banner-repo').href = cfg.repoUrl || '#';
$('banner-donation').textContent = cfg.donationAddress || '';

const api = async (path, body) => {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  return res.json();
};

function logLine(text, cls = '') {
  const li = document.createElement('li');
  if (cls) li.className = cls;
  li.textContent = text;
  $('log').appendChild(li);
}

async function refreshParties() {
  const data = await api('/api/parties');
  $('parties').innerHTML = Object.entries(data.parties)
    .filter(([role]) => role !== 'stranger')
    .map(([role, addr]) => `<div><span class="role">${role}</span> <code>${addr}</code> — balance ${data.balances[role] ?? '0'} sats</div>`)
    .join('');
}

async function refreshEscrow() {
  if (!escrowId) return;
  const e = await api(`/api/escrows/${escrowId}`);
  $('escrow-status').textContent = e.status;
  $('escrow-balance').textContent = e.balance;
  $('escrow-deadline').textContent = new Date(e.deadline * 1000).toLocaleString();
  $('fund-btn').disabled = e.status !== 'created';
  if (e.status === 'funded') $('settle-card').classList.remove('hidden');
  await refreshParties();
}

$('create-btn').onclick = async () => {
  const e = await api('/api/escrows', {
    amountSats: Number($('amount').value),
    deadlineSeconds: Number($('deadline').value),
  });
  escrowId = e.id;
  $('escrow-address').textContent = e.address;
  $('escrow-box').classList.remove('hidden');
  logLine(`Escrow created at ${e.address}`);
  await refreshEscrow();
};

$('fund-btn').onclick = async () => {
  await api(`/api/escrows/${escrowId}/fund`, {});
  logLine('Buyer funded the escrow.', 'ok');
  await refreshEscrow();
};

$('settle-btn').onclick = async () => {
  const result = await api(`/api/escrows/${escrowId}/settle`, {
    action: $('action').value,
    signer: $('signer').value,
    payTo: $('payto').value,
    when: $('when').value,
  });
  const box = $('settle-result');
  if (result.ok) {
    box.className = 'ok';
    box.textContent = `✅ Settled in tx ${result.txid}`;
    logLine(`${$('action').value} settled in tx ${result.txid}`, 'ok');
  } else {
    box.className = 'bad';
    box.textContent = `⛔ Rejected by the covenant: ${result.error}`;
    logLine(`Rejected: ${result.error}`, 'rej');
  }
  await refreshEscrow();
};

refreshParties();
