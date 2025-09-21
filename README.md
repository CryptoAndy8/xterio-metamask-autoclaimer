# Xterio MetaMask Autoclaimer

Автоматизований клеймер, який:
- піднімає **MetaMask** через [`@tenkeylabs/dappwright`](https://www.npmjs.com/package/@tenkeylabs/dappwright),
- читає приватні ключі з `keys.txt`,
- по черзі імпортує їх у MetaMask,
- виконує ваші кроки “claim” на сторінці (функція `runClaimFlow()`).

> 🧱 Код не патчить `node_modules` і працює з фіксованими версіями пакунків.

---

## Вимоги

- **Node.js 20+** (рекомендовано останній LTS)
- **Windows 10/11** (проект перевірявся саме під Windows)
- Створіть теку для тимчасових файлів, напр. `D:\Temp`

---

## Встановлення

```bash
git clone https://github.com/<you>/xterio-metamask-autoclaimer.git
cd xterio-metamask-autoclaimer
npm i
