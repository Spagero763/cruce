// Sign-in for everyone outside MiniPay: email, Google and phone with an embedded wallet, or a
// wallet app the person already has. Loaded only when someone taps connect, so the landing page
// never pays for it. Renders beside the app and reports the wallet back.
import { PrivyProvider, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";
import type { Chain } from "viem";

export interface PrivyBridgeProps {
  appId: string;
  chain: Chain;
  wantLogin: number;
  wantLogout: number;
  onWallet(w: { address: `0x${string}`; provider: unknown } | null): void;
  onCancel(): void;
}

function Bridge({ chain, wantLogin, wantLogout, onWallet, onCancel }: Omit<PrivyBridgeProps, "appId">) {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin({ onError: () => onCancel() });
  const asked = useRef(0);
  const out = useRef(0);

  useEffect(() => {
    if (!ready || wantLogin === asked.current) return;
    asked.current = wantLogin;
    if (!authenticated) login();
  }, [ready, authenticated, wantLogin, login]);

  useEffect(() => {
    if (!ready || wantLogout === out.current) return;
    out.current = wantLogout;
    void logout().then(() => onWallet(null));
  }, [ready, wantLogout, logout, onWallet]);

  // The wallet in use: the one they signed in with, or the embedded one made for them.
  useEffect(() => {
    if (!ready || !authenticated) return;
    const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets.find((w) => w.walletClientType === "privy");
    if (!wallet) return;
    let live = true;
    void (async () => {
      if (wallet.walletClientType !== "privy") await wallet.switchChain(chain.id).catch(() => {});
      const provider = await wallet.getEthereumProvider();
      if (live) onWallet({ address: wallet.address as `0x${string}`, provider });
    })();
    return () => {
      live = false;
    };
  }, [ready, authenticated, wallets, chain.id, onWallet]);

  return null;
}

const MARK = (
  <svg width="124" height="40" viewBox="0 0 124 40" aria-label="Cruce">
    <path d="M6 12c7 0 9 16 20 16" fill="none" stroke="#2D5BFF" strokeWidth="4" strokeLinecap="round" />
    <path d="M6 28c7 0 9-16 20-16" fill="none" stroke="#0E0F0C" strokeWidth="4" strokeLinecap="round" />
    <text x="38" y="28" fontFamily="'Instrument Serif', Georgia, serif" fontSize="27" fill="#0E0F0C">
      Cruce
    </text>
  </svg>
);

export default function PrivyHost({ appId, chain, ...rest }: PrivyBridgeProps) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#2D5BFF",
          logo: MARK,
          walletChainType: "ethereum-only",
          walletList: ["detected_ethereum_wallets", "metamask", "coinbase_wallet", "rainbow", "wallet_connect"],
        },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <Bridge chain={chain} {...rest} />
    </PrivyProvider>
  );
}
