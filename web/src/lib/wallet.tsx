// One wallet interface for the whole app. Inside MiniPay it connects on its own. Everywhere else
// Privy signs people in: email, Google, phone, or a wallet app they already have.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { api, authMessage, type Signed } from "./api";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  isMiniPay?: boolean;
};

type Source = "injected" | "privy";
const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? "";
const STORE_KEY = "cruce.wallet";

const PrivyHost = lazy(() => import("./privy"));
const loadViem = () => Promise.all([import("viem"), import("viem/chains")]);

function remember(source: Source | null) {
  try {
    if (source) localStorage.setItem(STORE_KEY, source);
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // storage blocked
  }
}

function remembered(): Source | null {
  try {
    return localStorage.getItem(STORE_KEY) as Source | null;
  } catch {
    return null;
  }
}

interface WalletState {
  address: Address | null;
  source: Source | null;
  connecting: boolean;
  hasInjected: boolean;
  isMiniPay: boolean;
  canConnect: boolean;
  connect(method?: Source): Promise<Address>;
  disconnect(): void;
  signIn(action: string): Promise<Signed>;
  clients(): Promise<{ wallet: WalletClient; pub: PublicClient; address: Address }>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const injected = (typeof window !== "undefined" ? (window as { ethereum?: unknown }).ethereum : undefined) as Eip1193 | undefined;
  const isMiniPay = Boolean(injected?.isMiniPay);
  const [address, setAddress] = useState<Address | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [privy, setPrivy] = useState({ mounted: remembered() === "privy" && !!PRIVY_APP_ID, login: 0, logout: 0 });
  const [chain, setChain] = useState<Chain | null>(null);
  const provider = useRef<Eip1193 | null>(null);
  const waiting = useRef<{ resolve(a: Address): void; reject(e: Error): void } | null>(null);

  useEffect(() => {
    void Promise.all([loadViem(), api.config()]).then(([[, { celo, celoSepolia }], cfg]) => setChain(cfg.network === "mainnet" ? celo : celoSepolia));
  }, []);

  const settle = useCallback((a: Address | null, err?: Error) => {
    const w = waiting.current;
    waiting.current = null;
    if (a) w?.resolve(a);
    else w?.reject(err ?? new Error("cancelled"));
  }, []);

  const ensureChain = useCallback(
    async (eth: Eip1193) => {
      if (!chain) return;
      const current = Number(await eth.request({ method: "eth_chainId" }));
      if (current === chain.id) return;
      const hex = `0x${chain.id.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [chain.blockExplorers?.default.url] }],
        });
      }
    },
    [chain],
  );

  const connectInjected = useCallback(async () => {
    if (!injected) throw new Error("no-wallet");
    const [a] = (await injected.request({ method: "eth_requestAccounts" })) as Address[];
    await ensureChain(injected);
    provider.current = injected;
    setAddress(a);
    setSource("injected");
    remember("injected");
    return a;
  }, [injected, ensureChain]);

  const connectPrivy = useCallback(() => {
    if (!PRIVY_APP_ID) return Promise.reject(new Error("no-wallet"));
    return new Promise<Address>((resolve, reject) => {
      waiting.current = { resolve, reject };
      setPrivy((p) => ({ ...p, mounted: true, login: p.login + 1 }));
    });
  }, []);

  const connect = useCallback(
    async (method?: Source) => {
      if (address) return address;
      setConnecting(true);
      try {
        if (isMiniPay || method === "injected" || (!PRIVY_APP_ID && injected)) return await connectInjected();
        return await connectPrivy();
      } finally {
        setConnecting(false);
      }
    },
    [address, isMiniPay, injected, connectInjected, connectPrivy],
  );

  const onPrivyWallet = useCallback(
    (w: { address: Address; provider: unknown } | null) => {
      if (!w) {
        if (source === "privy") {
          provider.current = null;
          setAddress(null);
          setSource(null);
        }
        return;
      }
      provider.current = w.provider as Eip1193;
      setAddress(w.address);
      setSource("privy");
      remember("privy");
      settle(w.address);
    },
    [settle, source],
  );

  const disconnect = useCallback(() => {
    if (source === "privy") setPrivy((p) => ({ ...p, logout: p.logout + 1 }));
    provider.current = null;
    setAddress(null);
    setSource(null);
    remember(null);
  }, [source]);

  // MiniPay injects an already-connected wallet, so nobody there ever sees a sign-in screen.
  useEffect(() => {
    if (!injected) return;
    if (isMiniPay || (!PRIVY_APP_ID && remembered() === "injected")) void connectInjected().catch(() => {});
    injected.on?.("accountsChanged", (accounts: unknown) => {
      if (provider.current === injected) setAddress(((accounts as Address[])[0] ?? null) as Address | null);
    });
  }, [injected, isMiniPay, connectInjected]);

  const clients = useCallback(async () => {
    const a = address ?? (await connect());
    const eth = provider.current;
    if (!eth || !chain) throw new Error("no-wallet");
    const [{ createWalletClient, createPublicClient, custom, http }] = await loadViem();
    const wallet = createWalletClient({ account: a, chain, transport: custom(eth) });
    const pub = createPublicClient({ chain, transport: http() }) as PublicClient;
    return { wallet, pub, address: a };
  }, [address, connect, chain]);

  const signIn = useCallback(
    async (action: string): Promise<Signed> => {
      const { wallet, address: a } = await clients();
      const { nonce } = await api.nonce(a);
      const signature = await wallet.signMessage({ account: a, message: authMessage(action, nonce) });
      return { address: a, nonce, signature };
    },
    [clients],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      source,
      connecting,
      hasInjected: Boolean(injected),
      isMiniPay,
      canConnect: Boolean(injected) || Boolean(PRIVY_APP_ID),
      connect,
      disconnect,
      signIn,
      clients,
    }),
    [address, source, connecting, injected, isMiniPay, connect, disconnect, signIn, clients],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {privy.mounted && chain && PRIVY_APP_ID && (
        <Suspense fallback={null}>
          <PrivyHost
            appId={PRIVY_APP_ID}
            chain={chain}
            wantLogin={privy.login}
            wantLogout={privy.logout}
            onWallet={onPrivyWallet}
            onCancel={() => settle(null)}
          />
        </Suspense>
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}
