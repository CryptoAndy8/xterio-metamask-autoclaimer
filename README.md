# Xterio MetaMask Auto-Claimer (BSC)

Fully-automated claimer for the **Xterio BNB** migration on BSC using **MetaMask + Puppeteer (dappeteer)**.

**What it does**
- Launches Chrome with MetaMask
- Imports each private key automatically
- Switches to **BSC** network (RPC from `.env`)
- Opens the claim page and **connects** the wallet (approve/sign popups handled)
- Pulls **proof** in-page (auth already present after connect)
- Sends the transaction **directly to the claim contract** (faster & more reliable than clicking “Claim”)
- Adds a random delay between wallets and repeats

> No manual clicking per wallet. Paste keys → run → it works.

---

## Requirements
- Node.js 18+
- Windows/macOS/Linux
- Chrome/Chromium is bundled via Puppeteer
- MetaMask is auto-managed by **dappeteer**

---

## Setup

1. Install deps
   ```bash
   npm i
