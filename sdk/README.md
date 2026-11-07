# cruce-sdk

Quote and settle cross-currency conversions on Celo through [Cruce](https://usecruce.xyz):
wARS, wBRL, wCOP, cNGN and the dollars into each other in one x402 payment, at the best price across
Textile, Uniswap and Mento, with a guaranteed minimum or a refund. Or pay any x402 service in the
currency you hold.

```
npm install cruce-sdk viem
```

## Change money

```ts
import { Cruce } from "cruce-sdk";

const cruce = new Cruce({ partner: "your-code" });

// estimate, guaranteed minimum, fee, route; holds about 45 seconds
const q = await cruce.quote({ from: "wARS", to: "wBRL", amount: "50000" });

// one EIP-712 signature from any viem wallet client, no gas
const order = await cruce.pay(q, { wallet, pub, recipient: "0x…" });

// each leg lands with its own transaction
const final = await cruce.wait(order.id);
console.log(final.status, final.out, final.legs);
```

`pub` is a viem public client on Celo. It is needed when paying with wARS, wBRL, wCOP or cNGN, which
settle through Permit2.

## Pay any x402 service in the currency you hold

x402 settles only in the asset the seller names. Cruce reads the seller's price, converts, pays the
seller in its own asset, returns the change and hands back the seller's answer.

```ts
const { status, body } = await cruce.payEndpoint({
  url: "https://…",
  method: "POST",
  body: JSON.stringify({ … }),
  contentType: "application/json",
  from: "cNGN",
  wallet,
  pub,
});
```

## Earn from what you send

Register a partner code with one signature on the Developers page of the site, then pass it to
`new Cruce({ partner })` or put it in a link with `cruce.link({ from, to, amount })`. A third of the
fee on every conversion that carries your code is paid to your address, on-chain, with the order.

## Currencies

Pay with and receive: wARS, wBRL, wCOP, cNGN, USA₮, USD₮, USDC. Receive only: IDRX, USDm. wMXN, wCLP
and wPEN switch on when their venues have depth both ways; `cruce.getConfig()` lists what is live.

MIT.
