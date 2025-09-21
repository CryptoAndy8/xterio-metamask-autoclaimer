import 'dotenv/config';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { launch, MetaMaskWallet } from '@tenkeylabs/dappwright';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** ---------- ENV & defaults ---------- */
const METAMASK_VERSION = process.env.METAMASK_VERSION || '13.3.0';
const WALLET_PASSWORD  = process.env.WALLET_PASSWORD  || 'password1234!!!!';
const WALLET_SEED      = (process.env.WALLET_SEED || '').trim();
const TARGET_URL       = process.env.TARGET_URL || 'https://example.com/';
const HEADLESS         = /^true$/i.test(String(process.env.HEADLESS || 'false'));
const TEMP_DIR         = process.env.TEMP_DIR || 'D:/Temp';
const KEYS_FILE        = path.resolve(__dirname, '../keys.txt');

/** ---------- helpers ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), '-', ...a);

async function readKeysList(file) {
  if (!fs.existsSync(file)) return [];
  const raw = await fsp.readFile(file, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
    .map(s => (s.startsWith('0x') ? s : '0x' + s));
}

/** ---------- main “claim” steps (TODO: налаштуй під Xterio) ---------- */
async function runClaimFlow(page) {
  // Тут постав свої кроки для Xterio: connect, sign, claim, перевірки тощо.
  // Приклад-болванка:
  await page.goto(TARGET_URL, { waitUntil: 'load' });
  await page.waitForLoadState('domcontentloaded');

  // TODO: приклади селекторів — заміни на реальні
  // await page.getByRole('button', { name: /connect wallet/i }).click();
  // await page.getByText(/metamask/i).click();
  // ... тут dappwright сам перехопить popup MetaMask для підтвердження ...

  // await page.getByRole('button', { name: /claim/i }).click();
  // await page.waitForTimeout(2000);

  // Dummy “ok”
  return true;
}

/** ---------- wallet bootstrap/launch ---------- */
async function startWallet() {
  // обов’язково чистимо технічний кеш шляху (Windows любить пусті TEMP)
  const workerIndex = process.env.TEST_WORKER_INDEX || '0';
  process.env.TEMP = TEMP_DIR;
  process.env.TMP  = TEMP_DIR;

  log(`Using MetaMask v${METAMASK_VERSION}`);
  const { browserContext, wallet } = await launch('metamask', {
    headless: HEADLESS ? 1 : 0,
    metamaskVersion: METAMASK_VERSION,
    // Можна додати інші розширення через additionalExtensions
  });

  // Перший старт/настройка:
  await wallet.setup({
    password: WALLET_PASSWORD,
    // Якщо seed не заданий, MM створить новий; інакше імпортує існуючий
    ...(WALLET_SEED ? { seed: WALLET_SEED } : {})
  });

  // Трохи часу, щоб MM прогрузив панелі
  await sleep(1000);

  return { browserContext, wallet };
}

/** ---------- per-key execution ---------- */
async function processPrivateKey(wallet, page, pk, idx) {
  // Валідація, щоб не годувати MM сміттям
  try { new ethers.Wallet(pk); }
  catch (e) {
    log(`[${idx}] ❌ PK некоректний: ${pk.slice(0,10)}…`);
    return false;
  }

  // Якщо акаунтів уже багато — опційно можна видаляти попередній
  // але в dappwright MM importPK додає “Imported Account #N”
  try {
    log(`[${idx}] ➕ імпорт PK…`);
    await wallet.importPK(pk);
  } catch (e) {
    log(`[${idx}] ❌ importPK:`, e.message || e);
    return false;
  }

  // Після імпорту MetaMask зазвичай перемикається на акаунт
  // Тепер викликаємо клейм
  try {
    log(`[${idx}] 🟢 claim…`);
    const ok = await runClaimFlow(page);
    log(`[${idx}] ✅ done: ${ok ? 'OK' : 'NO-OP'}`);
    return ok;
  } catch (e) {
    log(`[${idx}] ❌ claim error:`, e.message || e);
    return false;
  } finally {
    // За бажання: видалити імпортований акаунт, щоб не розросталась база
    // await wallet.deleteAccount('Imported Account #1') // якщо потрібно
    await sleep(400);
  }
}

/** ---------- entry ---------- */
(async () => {
  try {
    const keys = await readKeysList(KEYS_FILE);
    log(`🚀 Старт автоклейму. Ключів (PK): ${keys.length}`);

    const { browserContext, wallet } = await startWallet();
    const page = browserContext.pages()[0] || (await browserContext.newPage());

    let okCount = 0;
    for (let i = 0; i < keys.length; i++) {
      const ok = await processPrivateKey(wallet, page, keys[i], i + 1);
      if (ok) okCount++;
    }

    log(`🎯 Готово. Успішно: ${okCount}/${keys.length}`);
    await browserContext.close();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
