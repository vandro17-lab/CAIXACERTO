-- Caixa Certo — exclusão de fechamentos pelo administrador.
--
-- O ADM pode excluir um fechamento (rascunho ou finalizado), por exemplo um teste. A exclusão é definitiva:
-- some o fechamento, seus lançamentos, chaves de acesso e histórico. Para não sumir sem rastro, uma cópia
-- completa fica guardada em `fechamentos_excluidos`, com o motivo, e essa tabela não aceita edição nem exclusão.
--
-- As travas continuam valendo para todo o resto. A exclusão só é liberada dentro da transação em que a API
-- (depois de conferir a sessão e a senha do ADM) marca `cc.exclusao_adm`.

create table fechamentos_excluidos (
  exclusao_id text primary key,
  fechamento_id text not null,
  loja_id text not null,
  loja_nome text not null,
  data_local text not null,
  turno text not null,
  responsavel_nome text not null,
  status text not null,
  total_lancar_centavos integer,
  motivo text not null check (length(btrim(motivo)) between 5 and 500),
  -- Tudo o que existia: o fechamento, os lançamentos e o histórico, em JSON.
  dados_json text not null,
  excluido_em timestamptz not null default now()
);
create index fechamentos_excluidos_data on fechamentos_excluidos (excluido_em desc);
alter table fechamentos_excluidos enable row level security;

create function cc_exclusoes_imutaveis() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'O registro de exclusões é imutável.';
end $$;

create trigger fechamentos_excluidos_guarda before update or delete on fechamentos_excluidos
for each row execute function cc_exclusoes_imutaveis();

-- Fechamentos: além da edição do ADM, aceita a exclusão do ADM. Ao excluir um fechamento que serviu de
-- origem da abertura de outro já finalizado, só a referência (abertura_origem_id) é apagada nesse outro.
create or replace function cc_guardar_fechamento() returns trigger
language plpgsql set search_path = '' as $$
declare
  exclusao boolean := coalesce(current_setting('cc.exclusao_adm', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if exclusao then return old; end if;
    raise exception 'Fechamentos não podem ser excluídos.';
  end if;
  if old.status = 'finalizado' then
    if exclusao and (to_jsonb(new) - 'abertura_origem_id') = (to_jsonb(old) - 'abertura_origem_id')
       and new.abertura_origem_id is null then
      return new;
    end if;
    if coalesce(current_setting('cc.edicao_adm', true), '') = '1' then
      if not (new.status = 'finalizado' and new.versao = old.versao + 1
              and new.quantidade_edicoes_adm = old.quantidade_edicoes_adm + 1
              and new.quantidade_correcoes = old.quantidade_correcoes) then
        raise exception 'Edição do administrador inválida.';
      end if;
      return new;
    end if;
    if new.quantidade_edicoes_adm <> old.quantidade_edicoes_adm then
      raise exception 'Somente o administrador registra edições do administrador.';
    end if;
    if old.quantidade_correcoes >= 1 then
      raise exception 'Fechamento já corrigido uma vez: bloqueado para novas edições.';
    end if;
    if not (new.status = 'finalizado' and new.quantidade_correcoes = 1 and new.versao = old.versao + 1) then
      raise exception 'Um fechamento finalizado só aceita a correção única.';
    end if;
  end if;
  return new;
end $$;

-- Lançamentos: na exclusão do ADM, só a remoção é liberada.
create or replace function cc_guardar_lancamento() returns trigger
language plpgsql set search_path = '' as $$
declare
  alvo text;
begin
  if tg_op = 'DELETE' and coalesce(current_setting('cc.exclusao_adm', true), '') = '1' then
    return old;
  end if;
  if tg_op = 'DELETE' then alvo := old.fechamento_id; else alvo := new.fechamento_id; end if;
  if coalesce(current_setting('cc.edicao_adm', true), '') <> '1'
     and exists (select 1 from public.fechamentos f where f.fechamento_id = alvo and f.quantidade_correcoes >= 1) then
    raise exception 'Fechamento bloqueado: os lançamentos não podem mais ser alterados.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Histórico: continua imutável; só sai junto com o fechamento excluído pelo ADM (a cópia fica guardada).
create or replace function cc_historico_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('cc.exclusao_adm', true), '') = '1' then
    return old;
  end if;
  raise exception 'O histórico de alterações é imutável.';
end $$;
