import { useEffect, useState } from "react";
import { Logo } from "./Moldura.tsx";

interface EventoInstalacao extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const jaInstalado = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

const ehIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * Convite para instalar o Caixa Certo como aplicativo. Só aparece quando faz sentido:
 * o navegador ofereceu a instalação (Android e computador) ou é um iPhone/iPad, onde a
 * instalação é feita pelo menu Compartilhar. Dentro do aplicativo instalado, não aparece.
 */
export function Instalar() {
  const [evento, setEvento] = useState<EventoInstalacao | null>(null);
  const [instalado, setInstalado] = useState(jaInstalado);

  useEffect(() => {
    const aoOferecer = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalacao);
    };
    const aoInstalar = () => setInstalado(true);
    window.addEventListener("beforeinstallprompt", aoOferecer);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoOferecer);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  if (instalado) return null;
  if (evento) {
    return (
      <aside className="instalar" aria-label="Instalar aplicativo">
        <Logo tamanho={48} />
        <p>
          <strong>Instale o Caixa Certo</strong>
          Abra direto pelo ícone, em tela cheia, como um aplicativo.
        </p>
        <button
          type="button"
          className="botao botao-primario"
          onClick={async () => {
            await evento.prompt();
            if ((await evento.userChoice).outcome === "accepted") setInstalado(true);
            setEvento(null);
          }}
        >
          Instalar aplicativo
        </button>
      </aside>
    );
  }
  if (ehIos()) {
    return (
      <aside className="instalar" aria-label="Instalar aplicativo">
        <Logo tamanho={48} />
        <p>
          <strong>Instale o Caixa Certo</strong>
          No iPhone ou iPad: toque em Compartilhar e depois em “Adicionar à Tela de Início”.
        </p>
      </aside>
    );
  }
  return null;
}
