-- Aplicada em 23/09/2026.
--
-- O schema.sql usa CREATE TABLE IF NOT EXISTS, que não altera tabela que já
-- existe. Então toda mudança de coluna em banco já no ar entra como um arquivo
-- aqui, rodado uma vez à mão:
--
--   npx wrangler d1 execute busca-player --remote --file=migracoes/001-apagar-cards-mortos.sql

ALTER TABLE grupos ADD COLUMN apagar_em INTEGER;

CREATE INDEX IF NOT EXISTS idx_grupos_remocao ON grupos (apagar_em);
