// Mecânica 4: fila assíncrona. Resolve o problema de fundo de servidor pequeno
// — quase nunca tem duas pessoas querendo o mesmo jogo no mesmo minuto.
// Em vez de exigir coincidência, guarda a intenção e avisa por DM depois.

import { enviarDm } from "./discord.js";

// Janela mínima entre duas DMs para a mesma pessoa. Sem isso, cada entrada
// nova na fila viraria uma notificação, e a fila vira spam em vez de utilidade.
const COOLDOWN_DM_MS = 30 * 60 * 1000;

export async function entrarNaFila(env, { jogoSlug, usuarioId, guildId, horas }) {
  const agora = Date.now();
  await env.DB.prepare(
    "INSERT INTO fila (jogo_slug, usuario_id, guild_id, criado_em, expira_em) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(jogo_slug, usuario_id) DO UPDATE SET " +
      "expira_em = excluded.expira_em, criado_em = excluded.criado_em"
  )
    .bind(jogoSlug, usuarioId, guildId, agora, agora + horas * 3600_000)
    .run();
}

export async function sairDaFila(env, jogoSlug, usuarioId) {
  await env.DB.prepare("DELETE FROM fila WHERE jogo_slug = ? AND usuario_id = ?")
    .bind(jogoSlug, usuarioId)
    .run();
}

export async function esperandoPor(env, jogoSlug, exceto = null) {
  const { results } = await env.DB.prepare(
    "SELECT usuario_id, avisado_em FROM fila WHERE jogo_slug = ? AND expira_em > ?"
  )
    .bind(jogoSlug, Date.now())
    .all();

  return (results ?? []).filter((r) => r.usuario_id !== exceto);
}

async function marcarAvisados(env, jogoSlug, usuarios) {
  if (!usuarios.length) return;
  const agora = Date.now();
  await env.DB.batch(
    usuarios.map((id) =>
      env.DB.prepare(
        "UPDATE fila SET avisado_em = ? WHERE jogo_slug = ? AND usuario_id = ?"
      ).bind(agora, jogoSlug, id)
    )
  );
}

function podeAvisar(linha) {
  return !linha.avisado_em || Date.now() - linha.avisado_em > COOLDOWN_DM_MS;
}

// Alguém acabou de entrar na fila: se já tem gente esperando o mesmo jogo,
// junta os dois lados na hora.
export async function cruzarFila(env, jogo, novoUsuarioId, canalId) {
  const outros = (await esperandoPor(env, jogo.slug, novoUsuarioId)).filter(podeAvisar);
  if (!outros.length) return 0;

  const nomes = outros.map((o) => `<@${o.usuario_id}>`).join(", ");
  const linkCanal = `<#${canalId}>`;

  await enviarDm(env, novoUsuarioId, {
    content:
      `${jogo.emoji} **${jogo.nome}** — tem gente esperando agora: ${nomes}\n` +
      `Abre um grupo em ${linkCanal} com \`/grupo\` que eles são chamados.`,
  });

  for (const outro of outros) {
    await enviarDm(env, outro.usuario_id, {
      content:
        `${jogo.emoji} **${jogo.nome}** — <@${novoUsuarioId}> também quer jogar agora.\n` +
        `Abre um grupo em ${linkCanal} com \`/grupo\`.`,
    });
  }

  await marcarAvisados(env, jogo.slug, [
    novoUsuarioId,
    ...outros.map((o) => o.usuario_id),
  ]);
  return outros.length;
}

// Abriu um grupo: quem estava na fila daquele jogo é chamado na DM com o link
// direto do card. É o fecho do ciclo — a fila só vale se virar convite.
export async function avisarFilaDeGrupoNovo(env, jogo, grupo, donoId) {
  const espera = (await esperandoPor(env, jogo.slug, donoId)).filter(podeAvisar);
  if (!espera.length) return 0;

  const link = `https://discord.com/channels/${grupo.guild_id}/${grupo.canal_id}/${grupo.mensagem_id}`;
  let entregues = 0;

  for (const linha of espera) {
    const ok = await enviarDm(env, linha.usuario_id, {
      content:
        `${jogo.emoji} **${jogo.nome}** — <@${donoId}> abriu grupo (${grupo.quando}).\n` +
        `Entra aqui: ${link}`,
    });
    if (ok) entregues++;
  }

  await marcarAvisados(env, jogo.slug, espera.map((l) => l.usuario_id));
  return entregues;
}

export async function limparFilaVencida(env) {
  const r = await env.DB.prepare("DELETE FROM fila WHERE expira_em < ?")
    .bind(Date.now())
    .run();
  return r.meta?.changes ?? 0;
}
