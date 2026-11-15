-- Caixa Certo — abertura do caixa como conferência e senha do gerente.

-- A abertura passa a vir do "Dinheiro da gaveta" do fechamento anterior finalizado da mesma loja.
--   abertura_conferida          null = digitada livremente (não havia fechamento anterior com dinheiro)
--                               'sim' = o funcionário confirmou o valor esperado
--                               'divergente' = valor diferente do esperado, liberado com a senha do gerente
--   abertura_esperada_centavos  valor que o servidor esperava no momento da conferência
--   abertura_origem_id          fechamento anterior de onde veio o valor esperado
alter table fechamentos add column abertura_conferida text check (abertura_conferida in ('sim', 'divergente'));
alter table fechamentos add column abertura_esperada_centavos integer check (abertura_esperada_centavos > 0);
alter table fechamentos add column abertura_origem_id text references fechamentos (fechamento_id);
alter table fechamentos add constraint fechamentos_abertura_conferida_valida check (
  abertura_conferida is null
  or (abertura_esperada_centavos is not null and abertura_centavos is not null
      and (abertura_conferida = 'sim') = (abertura_centavos = abertura_esperada_centavos))
);

-- Localiza rápido o fechamento anterior de uma loja.
create index fechamentos_loja_data on fechamentos (loja_id, data_local);

-- Senha do gerente: uma só para todas as lojas, cadastrada pelo ADM. Guarda apenas o hash bcrypt.
-- Serve só para liberar divergência de abertura; não dá acesso a consultas nem a configurações.
create table gerente_credencial (
  unica boolean primary key default true check (unica),
  senha_hash text not null,
  atualizado_em timestamptz not null default now()
);
alter table gerente_credencial enable row level security;
