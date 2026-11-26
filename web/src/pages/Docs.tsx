import type { ReactNode } from "react";
import { useI18n, type Lang } from "../lib/i18n";
import "./app.css";

const X = "https://x.com/Spagero71";
const REPO = "https://github.com/Spagero763/cruce";
const UPDATED = "26 November 2026";

type Section = { title: string; body: ReactNode };

const contact = (
  <>
    Write to <a href={X}>@Spagero71</a> on X, or open an issue on <a href={`${REPO}/issues`}>GitHub</a>.
  </>
);

const HELP: Record<Lang, { title: string; lead: string; sections: Section[] }> = {
  en: {
    title: "Help",
    lead: "What Cruce does, what it costs, and what happens when something goes wrong.",
    sections: [
      {
        title: "What is Cruce?",
        body: "Cruce changes one digital currency into another on the Celo network: dollars (USD₮, USDC, USA₮), Argentine pesos (wARS), Brazilian reais (wBRL), Colombian pesos (wCOP) and Nigerian naira (cNGN). You pay once in what you hold, and the currency you asked for arrives in your wallet or in someone else's, usually in about thirty seconds.",
      },
      {
        title: "What do most people use it for?",
        body: "Moving between dollars and a local currency, in either direction. You can also go straight from one local currency to another, for example naira to reais, without doing two separate exchanges.",
      },
      {
        title: "What does it cost?",
        body: "0.6% of the amount. The fee and the amount you will receive are shown before you pay. For most currencies you pay no network fee. For a few, your wallet pays a small one, and the page tells you before you sign.",
      },
      {
        title: "Is the price guaranteed?",
        body: "Every quote shows an estimate and a minimum, and holds for about 45 seconds. You never receive less than the minimum: if it can't be met, the conversion stops and your money comes back.",
      },
      {
        title: "What if something fails halfway?",
        body: "If nothing was changed yet, you get back exactly what you paid. If the first half already went through, you receive the dollars it became. The order page shows every step with its transaction.",
      },
      {
        title: "Can I cash out to a bank account?",
        body: "Not through Cruce. It changes one digital currency into another and never sends money to a bank. To cash out, use a service that supports your currency and your country, with the currency Cruce delivered to your wallet.",
      },
      {
        title: "Which wallets work?",
        body: "MiniPay, MetaMask and other wallet apps on Celo. You can also sign in with an email address and a wallet is made for you.",
      },
      {
        title: "Who holds my money?",
        body: (
          <>
            You do, before and after. During a conversion the agent holds it for a few seconds while it changes it. Every step is a public transaction on Celo, and the code is <a href={REPO}>open</a>.
          </>
        ),
      },
      { title: "Need a hand?", body: contact },
    ],
  },
  es: {
    title: "Ayuda",
    lead: "Qué hace Cruce, cuánto cuesta y qué pasa si algo sale mal.",
    sections: [
      {
        title: "¿Qué es Cruce?",
        body: "Cruce cambia una moneda digital por otra en la red Celo: dólares (USD₮, USDC, USA₮), pesos argentinos (wARS), reales brasileños (wBRL), pesos colombianos (wCOP) y nairas nigerianas (cNGN). Pagas una vez con lo que tienes y la moneda que pediste llega a tu billetera o a la de otra persona, normalmente en unos treinta segundos.",
      },
      {
        title: "¿Para qué lo usa la mayoría?",
        body: "Para pasar de dólares a una moneda local y al revés. También puedes ir directo de una moneda local a otra, por ejemplo de pesos a reales, sin hacer dos cambios separados.",
      },
      {
        title: "¿Cuánto cuesta?",
        body: "El 0,6% del monto. La comisión y lo que vas a recibir se muestran antes de pagar. Con la mayoría de las monedas no pagas comisión de red. Con algunas, tu billetera paga una pequeña, y la página te avisa antes de firmar.",
      },
      {
        title: "¿El precio está garantizado?",
        body: "Cada cotización muestra un estimado y un mínimo, y se mantiene unos 45 segundos. Nunca recibes menos que el mínimo: si no se puede cumplir, el cambio se detiene y tu dinero vuelve.",
      },
      {
        title: "¿Y si algo falla a mitad de camino?",
        body: "Si todavía no se cambió nada, recibes exactamente lo que pagaste. Si la primera mitad ya se hizo, recibes los dólares en que se convirtió. La página de la orden muestra cada paso con su transacción.",
      },
      {
        title: "¿Puedo retirar a una cuenta bancaria?",
        body: "No a través de Cruce. Cambia una moneda digital por otra y nunca envía dinero a un banco. Para retirar, usa un servicio que acepte tu moneda y tu país, con la moneda que Cruce dejó en tu billetera.",
      },
      {
        title: "¿Qué billeteras funcionan?",
        body: "MiniPay, MetaMask y otras billeteras en Celo. También puedes entrar con un correo electrónico y se crea una billetera para ti.",
      },
      {
        title: "¿Quién tiene mi dinero?",
        body: (
          <>
            Tú, antes y después. Durante un cambio el agente lo tiene unos segundos mientras lo cambia. Cada paso es una transacción pública en Celo y el código es <a href={REPO}>abierto</a>.
          </>
        ),
      },
      {
        title: "¿Necesitas ayuda?",
        body: (
          <>
            Escribe a <a href={X}>@Spagero71</a> en X o abre un issue en <a href={`${REPO}/issues`}>GitHub</a>.
          </>
        ),
      },
    ],
  },
  pt: {
    title: "Ajuda",
    lead: "O que o Cruce faz, quanto custa e o que acontece se algo der errado.",
    sections: [
      {
        title: "O que é o Cruce?",
        body: "O Cruce troca uma moeda digital por outra na rede Celo: dólares (USD₮, USDC, USA₮), pesos argentinos (wARS), reais (wBRL), pesos colombianos (wCOP) e nairas nigerianas (cNGN). Você paga uma vez com o que tem e a moeda que pediu chega na sua carteira ou na de outra pessoa, normalmente em cerca de trinta segundos.",
      },
      {
        title: "Para que a maioria usa?",
        body: "Para passar de dólares para uma moeda local e vice-versa. Você também pode ir direto de uma moeda local para outra, por exemplo de reais para pesos, sem fazer duas trocas separadas.",
      },
      {
        title: "Quanto custa?",
        body: "0,6% do valor. A taxa e o que você vai receber aparecem antes de pagar. Na maioria das moedas você não paga taxa de rede. Em algumas, sua carteira paga uma pequena, e a página avisa antes de você assinar.",
      },
      {
        title: "O preço é garantido?",
        body: "Cada cotação mostra uma estimativa e um mínimo, e vale por cerca de 45 segundos. Você nunca recebe menos que o mínimo: se ele não puder ser cumprido, a troca para e seu dinheiro volta.",
      },
      {
        title: "E se algo falhar no meio?",
        body: "Se nada foi trocado ainda, você recebe exatamente o que pagou. Se a primeira metade já foi feita, você recebe os dólares em que ela se transformou. A página do pedido mostra cada etapa com sua transação.",
      },
      {
        title: "Posso sacar para uma conta bancária?",
        body: "Não pelo Cruce. Ele troca uma moeda digital por outra e nunca envia dinheiro a um banco. Para sacar, use um serviço que aceite sua moeda e seu país, com a moeda que o Cruce entregou na sua carteira.",
      },
      {
        title: "Quais carteiras funcionam?",
        body: "MiniPay, MetaMask e outras carteiras na Celo. Você também pode entrar com um e-mail e uma carteira é criada para você.",
      },
      {
        title: "Quem fica com meu dinheiro?",
        body: (
          <>
            Você, antes e depois. Durante uma troca o agente fica com ele por alguns segundos enquanto troca. Cada etapa é uma transação pública na Celo e o código é <a href={REPO}>aberto</a>.
          </>
        ),
      },
      {
        title: "Precisa de ajuda?",
        body: (
          <>
            Escreva para <a href={X}>@Spagero71</a> no X ou abra uma issue no <a href={`${REPO}/issues`}>GitHub</a>.
          </>
        ),
      },
    ],
  },
};

const ENGLISH_ONLY: Record<Lang, string | null> = {
  en: null,
  es: "Esta página está disponible en inglés.",
  pt: "Esta página está disponível em inglês.",
};

const PRIVACY: Section[] = [
  {
    title: "What Cruce keeps",
    body: (
      <ul>
        <li>The wallet address that paid and the wallet address that received.</li>
        <li>Each conversion: the currencies, the amounts, the fee, the time and the transaction hashes.</li>
        <li>If you register a partner code: its name and the payout address.</li>
        <li>If you pay a service through Cruce: the service's address, the request you asked Cruce to send and the service's answer.</li>
        <li>Your IP address, in counters that stop one address from flooding the service.</li>
      </ul>
    ),
  },
  {
    title: "What Cruce does not ask for",
    body: "No name, no identity document, no phone number and no bank details. If you sign in with an email address, it is held by Privy, the sign-in provider, and is not stored on Cruce's servers.",
  },
  {
    title: "The blockchain is public",
    body: "Every payment, conversion and payout is a transaction on Celo. Anyone can see it, and nobody, including Cruce, can change or remove it.",
  },
  {
    title: "In your browser",
    body: "Cruce saves your language and how you signed in, in your browser's storage. Visits are counted with Vercel Web Analytics, which does not use cookies.",
  },
  {
    title: "Who else is involved",
    body: (
      <ul>
        <li>Vercel hosts the site and counts visits.</li>
        <li>Neon hosts the database.</li>
        <li>Privy handles email sign-in and the wallet made for it.</li>
        <li>Celo's payment facilitator settles the payment you sign.</li>
        <li>A service you choose to pay through Cruce receives the request you gave.</li>
      </ul>
    ),
  },
  {
    title: "What it is used for",
    body: "To run your conversion, show you your history, pay partners their share, and sort out a payment that went wrong. Cruce does not sell this information or use it for advertising.",
  },
  {
    title: "Asking for removal",
    body: <>You can ask for the records Cruce keeps about your wallet to be removed. Records on the blockchain can't be. {contact}</>,
  },
];

const TERMS: Section[] = [
  {
    title: "What Cruce is",
    body: "Cruce is software, built and run by Afolabi Emmanuel (Spagero), that changes one digital currency into another on the Celo network. It is not a bank. It does not open accounts, hold balances for you, or send money to or from bank accounts.",
  },
  {
    title: "How a conversion works",
    body: "You get a quote with an estimate and a minimum. You pay the exact amount quoted. The agent changes it on third-party exchange venues and sends the result to the address you chose. If the minimum can't be met, your payment is sent back. If the first half of a two-step conversion has already gone through and the second can't, you receive the dollars from the first half.",
  },
  {
    title: "Fees",
    body: "0.6% of the amount, shown in the quote before you pay. Paying an outside service through Cruce adds a fixed two US cents. Some currencies also need a small network fee from your wallet.",
  },
  {
    title: "Your part",
    body: (
      <ul>
        <li>Check the receiving address. A payout to a wrong address can't be reversed.</li>
        <li>Keep your wallet and your sign-in safe. Cruce can't recover them.</li>
        <li>Use Cruce only where it is lawful for you, and not for money that comes from crime or for anyone under sanctions.</li>
        <li>Taxes and local rules on your conversions are yours to handle.</li>
      </ul>
    ),
  },
  {
    title: "Risks",
    body: "The currencies are issued by other companies, and their value and redemption depend on those issuers. Prices come from venues Cruce does not control. The network can be slow or unavailable. Cruce is new software and may contain mistakes. Do not convert more than you can afford to have delayed.",
  },
  {
    title: "Other services",
    body: "Sign-in, exchange venues, payment settlement and any service you pay through Cruce are run by others under their own terms. Cruce is not responsible for them.",
  },
  {
    title: "No guarantee beyond these terms",
    body: "Cruce is provided as it is. Apart from what is written here about minimums and refunds, there is no promise that it will always be available or free of errors.",
  },
  {
    title: "Changes and contact",
    body: <>These terms may change, and the date above will change with them. {contact}</>,
  },
];

function Doc({ title, lead, note, sections }: { title: string; lead: string; note?: string | null; sections: Section[] }) {
  return (
    <div className="page wrap doc">
      <h1 className="display page-title">{title}</h1>
      <p className="lead">{lead}</p>
      {note && <p className="note doc-note">{note}</p>}
      {sections.map((s) => (
        <section key={s.title} className="doc-section">
          <h2>{s.title}</h2>
          <div className="doc-body">{s.body}</div>
        </section>
      ))}
    </div>
  );
}

export function Help() {
  const { lang } = useI18n();
  return <Doc {...HELP[lang]} />;
}

export function Privacy() {
  const { lang } = useI18n();
  return <Doc title="Privacy" lead={`What Cruce keeps about you and what it doesn't. Last updated ${UPDATED}.`} note={ENGLISH_ONLY[lang]} sections={PRIVACY} />;
}

export function Terms() {
  const { lang } = useI18n();
  return <Doc title="Terms" lead={`The terms for using Cruce. Last updated ${UPDATED}.`} note={ENGLISH_ONLY[lang]} sections={TERMS} />;
}
