Quick start
git clone https://github.com/<you>/xterio-metamask-autoclaimer.git
cd xterio-metamask-autoclaimer
cp .env.example .env
# відредагуй .env за потреби (RPC, газ, HEADLESS, CHROME_PATH)
npm i
# створити keys.txt → 1 приватний ключ на рядок
npm start

Gas control

Мінімальний мережевий: GAS_MULTIPLIER=1.00

Фіксовано: FIXED_GAS_PRICE_GWEI=1.2 (+ опційно MAX_GAS_PRICE_GWEI)

У логах видно «Gas mode: …; opts: { … }»

Troubleshooting

Chromium не завантажується → встанови Chrome і вкажи шлях:

CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe


MetaMask глючить на версії → спробуй іншу:

MM_VERSION=11.15.0
