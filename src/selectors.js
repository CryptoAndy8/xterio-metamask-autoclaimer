export async function clickFirstByText(page, substrings = [], tag = 'button') {
  const els = await page.$$(tag);
  for (const el of els) {
    const t = (await page.evaluate(e => (e.textContent || '').trim(), el)).toLowerCase();
    if (substrings.some(s => t.includes(s.toLowerCase()))) {
      await el.click().catch(() => {});
      return true;
    }
  }
  return false;
}

export async function tryConnectButton(page) {
  // варіації під поширені UI: Connect Wallet / Connect / Sign in / Login
  const keys = ['connect wallet', 'connect', 'sign in', 'login'];
  if (await clickFirstByText(page, keys, 'button')) return true;
  // інколи це <a> або кастомний елемент
  if (await clickFirstByText(page, keys, 'a')) return true;
  return false;
}
