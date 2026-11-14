import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProvedorAdm, RotaAdm } from "./adm.tsx";
import { Configuracoes } from "./paginas/admin/Configuracoes.tsx";
import { Consultas } from "./paginas/admin/Consultas.tsx";
import { Detalhe } from "./paginas/admin/Detalhe.tsx";
import { Entrar, TrocarSenha } from "./paginas/admin/Entrar.tsx";
import { PaginaFechamento } from "./paginas/Fechamento.tsx";
import { Inicio } from "./paginas/Inicio.tsx";
import { Novo } from "./paginas/Novo.tsx";

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ProvedorAdm>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/novo" element={<Novo />} />
          <Route path="/f/:id/*" element={<PaginaFechamento />} />
          <Route path="/admin/entrar" element={<Entrar />} />
          <Route path="/admin/trocar-senha" element={<TrocarSenha />} />
          <Route path="/admin/consultas" element={<RotaAdm><Consultas /></RotaAdm>} />
          <Route path="/admin/consultas/:id" element={<RotaAdm><Detalhe /></RotaAdm>} />
          <Route path="/admin/configuracoes" element={<RotaAdm><Configuracoes /></RotaAdm>} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </ProvedorAdm>
    </BrowserRouter>
  );
}
