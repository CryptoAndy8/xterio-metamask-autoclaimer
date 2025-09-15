import 'dotenv/config';
import fs from 'fs';
import { ethers } from 'ethers';
import { launch, setupMetaMask } from '@chainsafe/dappeteer';
import { tryConnectButton } from './selectors.js';

/* ========= ENV ========= */
const CLAIM_URL = process.env.CLAIM_URL;
const CLAIM_CONTRACT = process.env.CLAIM_CONTRACT;
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

const DELAY_RANGE_SEC = process.env.DELAY_RANGE_SEC || '50,100';
const PAUSE_AFTER_CONNECT_MS = Number(process.env.PAUSE_AFTER_CONNECT_MS || 2000);

const GAS_MULTIPLIER = Number(process.env.GAS_MULTIPLIER || 1.15);
const FIXED_GAS_PRICE_GWEI = process.env.FIXED_GAS_PRICE_GWEI ? Number(process.env.FIXED_GAS_PRICE_GWEI) : 0;
const MAX_GAS_PRICE_GWEI = process.env.MAX_GAS_PRICE_GWEI ? Number(process.env.MAX_GAS_PRICE_GWEI) : 0;

const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const MM_VERSION = process.env.MM_VERSION || '11.18.1';

if (!CLAIM_URL || !CLAIM_CONTRACT) {
  console.error('Please fill CLAIM_URL and CLAIM_CONTRACT in .env');
  process.exit(1);
}

/* ========= HELPERS ========= */
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
function parseDelayRange(s) {
  const [a, b] = String(s).split(',').map(x => Number(x.trim())).filter(Number.isFinite);
  const min = Math.max(0, a ?? 0);
  const max = Math.max(min, b ?? min);
  return { min, max };
}
const delayRange = parseDelayRange(DELAY_RANGE_SEC);
const randMs = () => Math.round((Math.random() * (delayRange.max - delayRange.min) + delayRange.min) * 1000);

const CLAIM_ABI = ['function claim(uint256 amount, bytes32[] proof) external'];

function toBigIntAmount(x) {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'string' && !x.startsWith('0x')) return BigInt(x);
  if (typeof x === 'number') return BigInt(Math.floor(x));
  return x;
}

/* ========= GAS LOGIC (BNB) ========= */
function gweiToWei(g) { return BigInt(Math.round(g * 1e9)); }

async function buildGasOpts(provider) {
  // 1) Фіксована ціна газу (якщо задана) — абсолютний пріоритет
  if (FIXED_GAS_PRICE_GWEI && FIXED_GAS_PRICE_GWEI > 0) {
    let gp = gweiToWei(FIXED_GAS_PRICE_GWEI);
    // за потреби обрізаємо зверху
    if (MAX_GAS_PRICE_GWEI && MAX_GAS_PRICE_GWEI > 0) {
      const cap = gweiToWei(MAX_GAS_PRICE_GWEI);
      if (gp > cap) gp = cap;
    }
    return { gasPrice: gp };
  }

  // 2) Беремо мережевий fee та множимо на GAS_MULTIPLIER
  const fee = await provider.getFeeData();
  // BSC зазвичай без EIP-1559 → gasPrice
  if (fee.gasPrice) {
    let gp = (fee.gasPrice * BigInt(Math.ceil(GAS_MULTIPLIER * 100))) / 100n;
    if (MAX_GAS_PRICE_GWEI && MAX_GAS_PRICE_GWEI > 0) {
      const cap = gweiToWei(MAX_GAS_PRICE_GWEI);
      if (gp > cap) gp = cap;
    }
    return { gasPrice: gp };
  }

  // 3) Рідкісний випадок EIP-1559 на BSC (підстраховано)
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    const m = BigInt(Math.ceil(GAS_MULTIPLIER * 100));
    let maxFeePerGas = (fee.maxFeePerGas * m) / 100n;
    let maxPriorityFeePerGas = (fee.maxPriorityFeePerGas * m) / 100n;

    if (MAX_GAS_PRICE_GWEI && MAX_GAS_PRICE_GWEI > 0) {
      const cap = gweiToWei(MAX_GAS_PRICE_GWEI);
      if (maxFeePerGas > cap) maxFeePerGas = cap;
      if (maxPriorityFeePerGas > cap) maxPriorityFeePerGas = cap;
    }
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  // 4) Фолбек — без опцій
  return {};
}

/* ========= MetaMask ========= */
async function addBscNetwork(metamask, rpcUrl) {
  await metamask.addNetwork({
    networkName: 'BSC',
    rpc: rpcUrl,
    chainId: 56,
    symbol: 'BNB',
    explorer: 'https://bscscan.com'
  });
  await metamask.switchNetwork('BSC');
}

async function connectWallet(page, metamask) {
  // натиснути «Connect / Sign in»
  try { await tryConnectButton(page); } catch {}
  // підтвердити у MetaMask (approve + sign)
  try { await metamask.approve(); } catch {}
  try { await metamask.sign(); } catch {}
}

/* ========= PROOF IN-PAGE ========= */
async function fetchProofInPage(page, claimUrl) {
  const url = new URL(claimUrl);
  const airdropId = url.pathname.split('/').pop();

  return await page.evaluate(async (aid) => {
    try {
      const r = await fetch(`https://api.xter.io/airdrop/v1/user/query/claim/${aid}`, {
        headers: { accept: 'application/json' },
        credentials: 'include'
      });
      if (!r.ok) return null;
      const j = await r.json();
      const it = Array.isArray(j?.data) && j.data[0] ? j.data[0] : null;
      if (!it) return null;

      const amount = it?.amount ?? j.amount ?? j.value ?? j.balance ?? j.claimAmount;
      const proof = it?.address_build?.merkle_proofs ?? j.proof ?? j.merkleProof ?? j.proofs ?? j.merkle_proof;
      const address = it?.address ?? j.address;

      if (!amount || !Array.isArray(proof) || !proof.length) return null;
      return { amount, proof, address };
    } catch { return null; }
  }, airdropId);
}

/* ========= MAIN PER-KEY ========= */
async function processKey(pk, index, total) {
  const priv = pk.startsWith('0x') ? pk : ('0x' + pk);
  let wallet;
  try { wallet = new ethers.Wallet(priv); } catch { console.log(`[${index}/${total}] bad private key`); return; }
  const address = await wallet.getAddress();

  // Підняти браузер з MM
  const browser = await launch({
    headless: HEADLESS,
    args: [
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-gpu'
    ]
  });
  const metamask = await setupMetaMask(browser, { version: MM_VERSION });
  await addBscNetwork(metamask, BSC_RPC_URL);
  await metamask.importPK(priv);

  const page = await browser.newPage();
  console.log(`[${index}/${total}] ${address} → open claim page`);
  await page.goto(CLAIM_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Connect & sign-in
  await connectWallet(page, metamask);
  await page.waitForTimeout(PAUSE_AFTER_CONNECT_MS);

  // Proof (у сторінки вже є auth)
  const proofData = await fetchProofInPage(page, CLAIM_URL);
  if (!proofData) {
    console.log(`❌ ${address} no proof from page`);
    await browser.close(); await sleep(randMs()); return;
  }
  if (proofData.address && proofData.address.toLowerCase() !== address.toLowerCase()) {
    console.log(`❌ ${address} proof belongs to ${proofData.address} — skip`);
    await browser.close(); await sleep(randMs()); return;
  }

  // RPC/Signer/Contract (ончейн відправка)
  const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  const signer = new ethers.Wallet(priv, provider);
  const contract = new ethers.Contract(CLAIM_CONTRACT, CLAIM_ABI, signer);

  // Пре-флайт: мережа, контракт, баланс
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 56) {
    console.log(`❌ ${address} wrong chainId ${net.chainId} (expected 56)`); await browser.close(); await sleep(randMs()); return;
  }
  const code = await provider.getCode(CLAIM_CONTRACT);
  if (!code || code === '0x') {
    console.log(`❌ ${address} no contract at ${CLAIM_CONTRACT} on BSC`); await browser.close(); await sleep(randMs()); return;
  }
  const bal = await provider.getBalance(address);
  if (bal === 0n) {
    console.log(`❌ ${address} has 0 BNB for gas`); await browser.close(); await sleep(randMs()); return;
  }

  // Amount
  const amount = toBigIntAmount(proofData.amount);

  // Gas options (із урахуванням FIXED/MULTIPLIER/MAX cap)
  const feeOpts = await buildGasOpts(provider);

  try {
    const est = await contract.claim.estimateGas(amount, proofData.proof);
    const gasLimit = (est * 12n) / 10n; // +20% запас
    const tx = await contract.claim(amount, proofData.proof, { ...feeOpts, gasLimit });
    console.log(`⏳ ${address} tx ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`✅ ${address} block ${rc.blockNumber}`);
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('already claimed')) {
      console.log(`ℹ️  ${address} already claimed`);
    } else if (msg.includes('whitelist') || msg.includes('not whitelisted')) {
      console.log(`❌ ${address} not whitelisted (proof mismatch / not eligible)`);
    } else {
      console.log(`❌ ${address} ${e.message}`);
    }
  }

  await browser.close();
  const d = randMs();
  console.log(`sleep ${Math.round(d/1000)}s...`);
  await sleep(d);
}

/* ========= MAIN ========= */
async function main() {
  const keys = fs.readFileSync('keys.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
  if (!keys.length) { console.error('keys.txt is empty'); process.exit(1); }

  console.log(`Total keys: ${keys.length}`);
  let i = 0;
  for (const k of keys) {
    i++;
    await processKey(k, i, keys.length); // послідовно — стабільно для MM
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
