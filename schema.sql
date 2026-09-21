-- Jogos que o bot conhece. Adicionar um jogo novo é inserir uma linha aqui
-- (ou usar /jogo add no Discord) — nada no código precisa mudar.
-- cargo_id começa nulo: o cargo é criado no servidor na primeira vez que o
-- painel é publicado, porque o id só existe depois que o Discord cria o cargo.
CREATE TABLE IF NOT EXISTS jogos (
  slug        TEXT    PRIMARY KEY,
  nome        TEXT    NOT NULL,
  emoji       TEXT    NOT NULL DEFAULT '',
  cargo_id    TEXT,
  steam_appid INTEGER,
  ordem       INTEGER NOT NULL DEFAULT 0
);

-- Um card de grupo aberto no canal. guarda canal_id e mensagem_id porque a
-- expiração roda no cron, fora da interação, e precisa editar a mensagem
-- original sem ter o token de interação (que dura só 15 minutos).
CREATE TABLE IF NOT EXISTS grupos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jogo_slug   TEXT    NOT NULL,
  guild_id    TEXT    NOT NULL,
  canal_id    TEXT    NOT NULL,
  mensagem_id TEXT,
  dono_id     TEXT    NOT NULL,
  vagas       INTEGER NOT NULL,
  quando      TEXT    NOT NULL DEFAULT 'agora',
  obs         TEXT    NOT NULL DEFAULT '',
  criado_em   INTEGER NOT NULL,
  expira_em   INTEGER NOT NULL,
  estado      TEXT    NOT NULL DEFAULT 'aberto', -- aberto | cheio | expirado | encerrado
  thread_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_grupos_expiracao ON grupos (estado, expira_em);

CREATE TABLE IF NOT EXISTS grupo_membros (
  grupo_id   INTEGER NOT NULL,
  usuario_id TEXT    NOT NULL,
  entrou_em  INTEGER NOT NULL,
  PRIMARY KEY (grupo_id, usuario_id)
);

-- Fila assíncrona do /avisar. É o que faz o servidor pequeno funcionar: em vez
-- de exigir duas pessoas online no mesmo minuto, guarda a intenção e avisa por
-- DM quando aparecer companhia. avisado_em existe só para segurar spam de DM.
CREATE TABLE IF NOT EXISTS fila (
  jogo_slug  TEXT    NOT NULL,
  usuario_id TEXT    NOT NULL,
  guild_id   TEXT    NOT NULL,
  criado_em  INTEGER NOT NULL,
  expira_em  INTEGER NOT NULL,
  avisado_em INTEGER,
  PRIMARY KEY (jogo_slug, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_fila_expiracao ON fila (expira_em);

-- Onde o painel de cargos foi publicado, para poder reeditá-lo quando um jogo
-- novo entra — sem isso cada /jogo add deixaria um painel velho e errado no canal.
CREATE TABLE IF NOT EXISTS config (
  guild_id          TEXT PRIMARY KEY,
  painel_canal_id   TEXT,
  painel_mensagem_id TEXT
);

-- Os dois jogos que já têm call no servidor. Os demais entram por /jogo add.
INSERT OR IGNORE INTO jogos (slug, nome, emoji, steam_appid, ordem) VALUES
  ('arc-raiders', 'ARC Raiders', '🛸', 1808500, 1),
  ('wardogs',     'WARDOGS',     '🐺', 1867240, 2);
