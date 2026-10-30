import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { api, type AppConfig, type Currency } from "../lib/api";
import { money, shortAddress } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useWallet } from "../lib/wallet";
import { CurrencyMark } from "./CurrencyMark";
import { Magnetic } from "./Magnetic";
import "./WalletCard.css";

type Balances = { currency: Currency; amount: bigint }[];

/** The money behind the address: what's in it, how to receive, how to send it on, how to sign out. */
export function WalletCard({ config }: { config: AppConfig }) {
  const { t } = useI18n();
  const wallet = useWallet();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("USDT");
  const address = wallet.address!;

  const refresh = async () => {
    const { pub } = await wallet.clients();
    const results = await pub.multicall({
      contracts: config.currencies.map((c) => ({ address: c.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address] })),
    });
    const next = config.currencies.map((currency, i) => ({ currency, amount: results[i].status === "success" ? (results[i].result as bigint) : 0n }));
    setBalances(next);
    const first = next.find((b) => b.amount > 0n && b.currency.method === "eip3009");
    if (first) setCode(first.currency.code);
  };

  useEffect(() => {
    void refresh();
    void QRCode.toDataURL(`ethereum:${address}@${config.chainId}`, { margin: 1, width: 220, color: { dark: "#0e0f0c", light: "#00000000" } }).then(setQr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const copy = () => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const sendable = config.currencies.filter((c) => c.method === "eip3009");
  const chosen = sendable.find((c) => c.code === code) ?? sendable[0];
  const have = balances?.find((b) => b.currency.code === chosen.code)?.amount ?? 0n;
  const value = (() => {
    try {
      return parseUnits(amount || "0", chosen.decimals);
    } catch {
      return 0n;
    }
  })();
  const valid = /^0x[0-9a-fA-F]{40}$/.test(to) && value > 0n && value <= have;

  // One signature authorises the transfer; the agent pays the gas. Same mechanism as a payment.
  const send = async () => {
    setError(null);
    setSending(true);
    try {
      const { wallet: w } = await wallet.clients();
      const now = Math.floor(Date.now() / 1000);
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
      const message = { from: address, to: to as Address, value, validAfter: 0n, validBefore: BigInt(now + 3600), nonce };
      const signature = await w.signTypedData({
        account: address,
        domain: { name: chosen.domain.name, version: chosen.domain.version, chainId: config.chainId, verifyingContract: chosen.address },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message,
      });
      const { tx } = await api.send({ token: chosen.code, from: address, to, value: value.toString(), validAfter: "0", validBefore: String(now + 3600), nonce, signature });
      setSent(tx);
      setAmount("");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/reject|denied/i.test(msg)) setError(msg || t("error.generic"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card me-reveal wallet">
      <div className="wallet-head">
        <p className="eyebrow">{t("wallet.title")}</p>
        <button className="text-btn" onClick={() => wallet.disconnect()}>
          {t("nav.signout")}
        </button>
      </div>

      <ul className="wallet-balances">
        {balances === null && <li className="note">…</li>}
        {balances?.filter((b) => b.amount > 0n).map((b) => (
          <li key={b.currency.code} className="wallet-balance">
            <CurrencyMark code={b.currency.code} />
            <span className="display">{money(b.amount, b.currency)}</span>
            <span className="mono wallet-code">{b.currency.label}</span>
          </li>
        ))}
        {balances?.every((b) => b.amount === 0n) && <li className="note">{t("wallet.empty")}</li>}
      </ul>

      <div className="wallet-receive">
        {qr && <img className="wallet-qr" src={qr} alt="" width={110} height={110} />}
        <div>
          <p className="eyebrow">{t("wallet.receive")}</p>
          <button className="wallet-address mono" onClick={copy} title={address}>
            {shortAddress(address)} · {copied ? t("wallet.copied") : t("wallet.copy")}
          </button>
          <p className="note">{t("wallet.receive.note")}</p>
        </div>
      </div>

      <form
        className="wallet-send"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !sending) void send();
        }}
      >
        <p className="eyebrow">{t("wallet.send")}</p>
        <div className="chips" role="radiogroup">
          {sendable.map((c) => (
            <button type="button" key={c.code} role="radio" aria-checked={c.code === chosen.code} className={`chip ${c.code === chosen.code ? "is-on" : ""}`} onClick={() => setCode(c.code)}>
              <CurrencyMark code={c.code} /> {c.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t("wallet.to")}</span>
          <input className="mono" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </label>
        <label className="field">
          <span>
            {t("wallet.amount")} · {t("wallet.have", { amount: formatUnits(have, chosen.decimals) })}
          </span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0" />
        </label>
        <Magnetic type="submit" variant="ghost" disabled={!valid || sending}>
          {sending ? t("wallet.sending") : t("wallet.send.cta")}
        </Magnetic>
        <p className="note">{t("wallet.send.note")}</p>
        {sent && (
          <p className="note">
            {t("wallet.sent")}{" "}
            <a className="mono" href={`${config.explorer}/tx/${sent}`} target="_blank" rel="noreferrer">
              {t("order.view")} ↗
            </a>
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  );
}
