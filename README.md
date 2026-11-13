<p align="center">
  <img src="web/public/icon.svg" width="88" alt="Cruce" />
</p>

<h1 align="center">Cruce</h1>

<p align="center"><b>Pesos for reais. Naira for pesos. Dollars for any of them.</b><br/>
A currency exchange agent on Celo. One payment, the best price across the venues, sent to any wallet in about thirty seconds.</p>

---

Latin America and Nigeria now have their money on-chain: wARS, wBRL, wCOP, wMXN, cNGN and the
dollars sit on Celo as stablecoins. Every venue that trades them, though, trades them **against the
dollar**. Someone holding pesos who needs reais does two trades, pays two spreads, and watches the
price move in between. Off-chain the casa de cambio takes 5 to 10% for the same thing, and the
street rate is whatever the person behind the counter says it is.

Cruce is the money changer that lives on the internet. Say what you hold and what you need. An
agent prices every hop on Textile, Uniswap and Mento, takes the better one for each, sells what you paid,
holds dollars for a few seconds, buys what you asked for, and sends it where you say. You sign
once. No gas, no account, no counter.

| | |
|---|---|
| **People** | Change wARS, wBRL, wCOP, cNGN, USA₮, USD₮, USDC or Mento's dollar (USDm) into each other: 56 pairs, from MiniPay, MetaMask, Rainbow, or an email sign-in that makes a wallet for you. Indonesian rupiah (IDRX) and the Mexican, Chilean and Peruvian pesos switch on by themselves when a venue quotes them both ways. The quote shows an estimate and a minimum. Under the minimum, you are refunded, not short-changed. |
| **Builders** | One call quotes, one payment settles. Any conversion that carries your partner code pays you a third of the fee, on-chain, with the order itself. An npm package and a link that pays you. |
| **The agent** | Holds nothing between orders and no contract holds a balance. Every leg is a public transaction on Celo, tagged, from one wallet. |
| **Languages** | English, Español, Português. |

## How a conversion moves

```
quote     GET /api/quote?from=wARS&to=wBRL&amount=50000
          both venues priced per hop, best picked, fee placed on the dollar hop,
          estimate + guaranteed minimum, 45 s hold, checked against reference rates
order     POST /api/orders { quoteId, recipient? }
pay       POST /x402/orders/:id/pay      one EIP-712 signature, settled by Celo's facilitator
run       leg 1   wARS -> USD₮   on the venue that quoted best, re-priced at fill time
          fee     0.6% of the dollars, a third to the partner when there is one
          leg 2   USD₮ -> wBRL   same again, never under the guaranteed minimum
          payout  wBRL -> recipient
```

- **Venues.** Textile FX (request-for-quote, makers quote local currency against dollars, settled
  through its reactor), Uniswap (v3 pools for wARS, cNGN, USDC and USA₮ against USD₮; v4 pools for
  wBRL and wARS against USDC) and Mento's v3 pools for USDm, the dollar MiniPay holds. Each hop is quoted on everything that trades the pair and the best
  output wins. At fill time the leg is priced again; if the quoted venue has gone quiet the others
  are tried, and if nothing reaches the minimum the order is refunded.
- **Payment.** x402 over Celo's facilitator: EIP-3009 for the dollar tokens, Permit2 with a sponsored
  approval for the pesos and reais. The payer never needs CELO. USDm, which the facilitator doesn't
  settle, is paid by a plain transfer whose calldata ends with the order id, so it can only ever pay
  that order. cNGN has no permit, so a wallet that never approved Permit2 pays it the same way. The
  same transfer is the fallback for every currency whenever the facilitator refuses to settle: the
  refusal is recorded on the order with its full reason, and the page switches rails on its own. The
  page says before the signature which rail an order takes, whether the wallet needs CELO for the
  fee, and turns every wallet and chain error into one sentence that says what to do.
- **Reference rates.** Official rates from public feeds, the Argentine ladder (oficial, blue, cripto)
  from its own API, and the street boards for Argentina and Nigeria read through a rented browser on
  [buy](https://usebuy.ai) with a language model parsing the page. A quote more than 8% from the
  reference cross rate is refused rather than served. The same numbers show next to every quote:
  what the official and street cross rates would have given for the same amount.
- **Recovery.** Every transaction hash is written down before its receipt is awaited. An order can
  be picked up from any point: a leg that landed is read off the chain, a leg still pending is left
  alone, a leg that reverted is sent again. Nothing is ever sent twice for the same money. After
  four failed attempts the payer gets back what the order became: the token they paid when nothing
  was converted, the dollars from the first leg otherwise, fee included.

## Proof on mainnet

Agent wallet [`0x242C4917FdaFB48A845BFD4356D81AE45EE6E77e`](https://celoscan.io/address/0x242C4917FdaFB48A845BFD4356D81AE45EE6E77e), ERC-8004 agent `9994`, Self Agent ID `203` (registry [`0xaC3D…5944`](https://celoscan.io/address/0xaC3DF9ABf80d0F5c020C06B04Cced27763355944), owned by the agent wallet).

| What | Transaction |
|---|---|
| Textile fill, USD₮ to wARS | [`0x40cfae…e670e`](https://celoscan.io/tx/0x40cfae779f7b5f60e06b1ad1a999884f01186f6a6cee6549a771e8637f8e670e) |
| Uniswap v3 fill, wARS to USD₮ | [`0xa859f0…8defd`](https://celoscan.io/tx/0xa859f0eed8c28313bca6ceda6e12896c88420719608a183164c369947018defd) |
| Mento fill, USDC to USDm | [`0x6aa2bf…855d5`](https://celoscan.io/tx/0x6aa2bf39dd822a51c7c5b6f76b239c8f4e1011938125357f03095e2f5db855d5) |
| Uniswap v4 fill, USDC to wBRL | [`0xfc4eee…c0970e`](https://celoscan.io/tx/0xfc4eee83a53190b001d9e7c8eb3306dd080f551951ec470efee0715d9ec0970e) |
| Order: 2 USD₮ paid over x402, filled on Textile, paid out as wBRL, 18.5 s | pay [`0xd7a2ce…5460f`](https://celoscan.io/tx/0xd7a2ce0002ddf855e2741c35dad4ef829a2b93a794233b3f9d04576dd825460f) · fill [`0xab04dd…2746fc`](https://celoscan.io/tx/0xab04ddef69fecb8afc6a59768c0f08790703f2d31d5f469edcbb8f0d902746fc) · payout [`0x0289f4…c18c1`](https://celoscan.io/tx/0x0289f48ffa89764505b82d251ac9066ab0c07ea0653d47d28722232f101c18c1) |
| An agent holding only pesos buys a buy inference call priced in USD₮: 49.97 wARS paid over x402, swapped on Uniswap v3, buy paid, change returned, answer handed back, 37.4 s | pay [`0x795a65…cd7ad`](https://celoscan.io/tx/0x795a65faaa134e1a3a35695271e6329ca28c85e8649019614519ebfacf4cd7ad) · swap [`0xa5f1e1…6618b`](https://celoscan.io/tx/0xa5f1e160dc4d0d45c4535736168f686de0d21cde2fc08f5e9f9e10ca87c6618b) · buy paid [`0xba9b13…dad47`](https://celoscan.io/tx/0xba9b13738cac8990f91b93cc4fbd633896fa6359dda9aaaee0e6a6674d7dad47) · change [`0x812a44…a8303`](https://celoscan.io/tx/0x812a44f976307ea95d962ec53ab58741bec7ea3dcabf069fe3950084c61a8303) |
| Order: 10.7 wBRL paid over x402 (Permit2), two Textile legs, paid out as cNGN, 25.5 s | pay [`0x6250b0…974a2e`](https://celoscan.io/tx/0x6250b06ad52473560cd2ac001f005e7ccb19a11def49038996959c80ff974a2e) · leg 1 [`0xe7437e…ea11e6`](https://celoscan.io/tx/0xe7437ea694f9be308c15668c24fb056090c8a6f651a27468a2573a3d4fea11e6) · leg 2 [`0x1e2807…22fa8`](https://celoscan.io/tx/0x1e28076e007606907d4f79387a623964992822f520e357521f54229374622fa8) · payout [`0xafd889…87077f`](https://celoscan.io/tx/0xafd88983c587f085307cd1a952e961302309451abeae68f6bfa990444d87077f) |

The buy calls the agent paid for are listed at `/api/proof/buy` with their settlement transactions.

## Pay any x402 service in the currency you hold

x402 settles in whatever single asset the seller names, and the facilitator never converts. An agent
holding naira can't pay a service priced in USDC; an agent holding dollars can't pay an invoice priced
in soles. Cruce closes that gap: give it the service's address and the currency you hold. It reads the
seller's price, quotes the exact input that covers it at the guaranteed minimum, and on payment
converts, pays the seller in its own asset from the agent's wallet, sends back any change, and keeps
the seller's answer for you to read.

```
POST /api/pay/quote { url, method, body, from }   the seller's price, in what you hold
POST /api/orders    { quoteId }                     then pay /x402/orders/:id/pay as usual
GET  /api/orders/:id/result                         what the service answered
```

Small payments carry a fixed two cents on top of the percentage, which covers the gas of converting.
A payment already in flight when an instance stops is never sent twice; a person checks it instead.

```ts
const { body } = await cruce.payEndpoint({ url: "https://…", from: "cNGN", wallet });
```

## Plug it in

```ts
import { Cruce } from "cruce-sdk";

const cruce = new Cruce({ partner: "your-code" });
const q = await cruce.quote({ from: "wARS", to: "wBRL", amount: "50000" });
const order = await cruce.pay(q, { wallet, recipient: "0x…" });
const final = await cruce.wait(order.id);
```

Or a link: `https://usecruce.xyz/?from=wARS&to=wBRL&amount=50000&ref=your-code`. The partner
code is registered with one signature on the Developers page and its payout address receives a
third of the fee with every order that carries it.

## Running it

```
npm install
npm test                       # router, engine, paying services, direct transfers, store: 41 tests on an in-process Postgres
npm run venues -w @cruce/agent # what the venues quote right now, read-only
npm run preview -w @cruce/agent && npm run dev -w @cruce/web
```

Mainnet needs `agent/.env`: the agent key, the attribution tag, the facilitator key, a Postgres URL
(Neon works), a worker secret. `npm run swap-check -w @cruce/agent -- textile USDT wARS 1.5` proves a
venue with real money from the agent wallet; `LIVE_API=… npm run live-check -w @cruce/agent -- USDT wBRL 2`
runs a whole order through a deployed API with a test payer.

Stateless API on serverless functions, Postgres for state, a lease on the wallet so concurrent orders
never share a nonce, a lease on each order so it is never run twice, and a worker every ten minutes
that finishes anything an instance died in the middle of.

## Where this goes

The corridors that exist today are the ones with venues: Argentina, Brazil, Colombia, Nigeria and the
dollars. Mexico, Chile and Peru switch on the day their pools and makers have depth both ways;
nothing in the code changes. The partner share is the distribution: every wallet, shop and agent in
the region that embeds the exchange earns from it, and every one of their users is a counterparty on
the agent's wallet.

MIT.
