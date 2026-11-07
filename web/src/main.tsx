import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Footer, Nav } from "./components/Chrome";
import { TransitionProvider } from "./components/Transition";
import { I18nProvider } from "./lib/i18n";
import { ScrollTrigger, startSmoothScroll } from "./lib/motion";
import { WalletProvider } from "./lib/wallet";
import { Landing } from "./pages/Landing";
import { NotFound } from "./pages/NotFound";
import "./styles/base.css";

const Order = lazy(() => import("./pages/Order").then((m) => ({ default: m.Order })));
const Me = lazy(() => import("./pages/Me").then((m) => ({ default: m.Me })));
const Developers = lazy(() => import("./pages/Developers").then((m) => ({ default: m.Developers })));

const TITLES: Record<string, string> = {
  "/": "Cruce · change pesos, reais, naira and dollars on Celo in seconds",
  "/developers": "Cruce for developers · one call quotes, one payment settles, a third of the fee is yours",
  "/me": "Your money · Cruce",
};

function Shell() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    startSmoothScroll();
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => ScrollTrigger.refresh());
    if (hash) document.querySelector(hash)?.scrollIntoView();
    document.title = TITLES[pathname] ?? (pathname.startsWith("/o/") ? "Your conversion · Cruce" : "Cruce");
  }, [pathname, hash]);

  return (
    <>
      <Nav />
      <main>
        <Suspense fallback={<div className="page" />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/o/:id" element={<Order />} />
            <Route path="/me" element={<Me />} />
            <Route path="/developers" element={<Developers />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {pathname === "/" && <Footer />}
      <div className="grain" aria-hidden />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <WalletProvider>
          <TransitionProvider>
            <Shell />
          </TransitionProvider>
        </WalletProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
