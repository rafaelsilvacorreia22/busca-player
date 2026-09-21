// Cadastro de jogos e o painel de cargos (mecânica 1: ping dirigido).

import { api } from "./discord.js";

export function paraSlug(nome) {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function listarJogos(env) {
  const { results } = await env.DB.prepare(
    "SELECT slug, nome, emoji, cargo_id, steam_appid FROM jogos ORDER BY ordem, nome"
  ).all();
  return results ?? [];
}

export async function buscarJogo(env, slug) {
  return env.DB.prepare(
    "SELECT slug, nome, emoji, cargo_id, steam_appid FROM jogos WHERE slug = ?"
  )
    .bind(slug)
    .first();
}

// O cargo precisa existir no servidor para poder ser mencionado, mas o id só
// aparece depois que o Discord cria. Por isso a criação é preguiçosa: acontece
// na primeira vez que alguém publica o painel ou abre um grupo do jogo.
//
// mentionable: false é proposital — assim ninguém dispara o ping do cargo na
// mão. Só o bot menciona, e só dentro de um card de grupo.
export async function garantirCargo(env, guildId, jogo) {
  if (jogo.cargo_id) return jogo.cargo_id;

  const cargo = await api(env, `/guilds/${guildId}/roles`, {
    method: "POST",
    body: JSON.stringify({
      name: jogo.nome,
      mentionable: false,
      hoist: false,
    }),
  });

  await env.DB.prepare("UPDATE jogos SET cargo_id = ? WHERE slug = ?")
    .bind(cargo.id, jogo.slug)
    .run();

  jogo.cargo_id = cargo.id;
  return cargo.id;
}

function emojiDoJogo(jogo) {
  return jogo.emoji ? { name: jogo.emoji } : undefined;
}

export function montarPainel(jogos) {
  const linhas = [];
  for (let i = 0; i < jogos.length; i += 5) {
    linhas.push({
      type: 1,
      components: jogos.slice(i, i + 5).map((jogo) => ({
        type: 2,
        style: 2,
        label: jogo.nome,
        emoji: emojiDoJogo(jogo),
        custom_id: `cargo:${jogo.slug}`,
      })),
    });
  }

  return {
    embeds: [
      {
        title: "🎮 Escolha seus jogos",
        description:
          "Clique nos jogos que você joga. Você passa a ser avisado **só** quando " +
          "alguém abrir grupo desses jogos — e ninguém mais é incomodado à toa.\n\n" +
          "Clicar de novo remove.\n\n" +
          "**Para chamar galera:** `/grupo`\n" +
          "**Sem ninguém online agora:** `/avisar` — o bot te chama na DM quando aparecer companhia.",
        color: 0x5865f2,
      },
    ],
    components: linhas.slice(0, 5),
  };
}

// Republica ou atualiza o painel. Guardar canal/mensagem no config permite que
// /jogo add conserte o painel existente em vez de deixar um desatualizado.
export async function publicarPainel(env, guildId, canalId) {
  const jogos = await listarJogos(env);
  for (const jogo of jogos) {
    await garantirCargo(env, guildId, jogo);
  }

  const corpo = montarPainel(jogos);
  const cfg = await env.DB.prepare(
    "SELECT painel_canal_id, painel_mensagem_id FROM config WHERE guild_id = ?"
  )
    .bind(guildId)
    .first();

  if (cfg?.painel_mensagem_id && cfg.painel_canal_id === canalId) {
    try {
      await api(env, `/channels/${canalId}/messages/${cfg.painel_mensagem_id}`, {
        method: "PATCH",
        body: JSON.stringify(corpo),
      });
      return { atualizado: true, mensagemId: cfg.painel_mensagem_id };
    } catch (err) {
      // Mensagem apagada na mão: cai fora e publica uma nova.
      console.log("Painel antigo sumiu, publicando de novo:", err.message);
    }
  }

  const mensagem = await api(env, `/channels/${canalId}/messages`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });

  await env.DB.prepare(
    "INSERT INTO config (guild_id, painel_canal_id, painel_mensagem_id) VALUES (?, ?, ?) " +
      "ON CONFLICT(guild_id) DO UPDATE SET painel_canal_id = excluded.painel_canal_id, " +
      "painel_mensagem_id = excluded.painel_mensagem_id"
  )
    .bind(guildId, canalId, mensagem.id)
    .run();

  return { atualizado: false, mensagemId: mensagem.id };
}

// Chamado depois de adicionar/remover jogo, para o painel não ficar mentindo.
export async function sincronizarPainel(env, guildId) {
  const cfg = await env.DB.prepare(
    "SELECT painel_canal_id, painel_mensagem_id FROM config WHERE guild_id = ?"
  )
    .bind(guildId)
    .first();
  if (!cfg?.painel_canal_id || !cfg?.painel_mensagem_id) return;

  try {
    await publicarPainel(env, guildId, cfg.painel_canal_id);
  } catch (err) {
    console.log("Não consegui sincronizar o painel:", err.message);
  }
}
