// Cards de grupo (mecânica 2), expiração (mecânica 3) e o fechamento do ciclo
// quando o grupo lota.

import { api } from "./discord.js";

export const DURACAO_PADRAO_HORAS = 3;

// Quanto tempo um card morto (encerrado/expirado) fica visível antes do bot
// apagar a mensagem. Existe para o canal não virar um cemitério de cards, mas
// sem sumir na cara de quem acabou de clicar — daí a hora de carência.
export const HORAS_ATE_APAGAR = 1;

export function marcarParaApagar(grupo) {
  grupo.apagar_em = Date.now() + HORAS_ATE_APAGAR * 3600_000;
  return grupo.apagar_em;
}

export async function membrosDoGrupo(env, grupoId) {
  const { results } = await env.DB.prepare(
    "SELECT usuario_id FROM grupo_membros WHERE grupo_id = ? ORDER BY entrou_em"
  )
    .bind(grupoId)
    .all();
  return (results ?? []).map((r) => r.usuario_id);
}

const CORES = {
  aberto: 0x57f287,
  cheio: 0x5865f2,
  expirado: 0x4f545c,
  encerrado: 0x4f545c,
};

const TITULOS = {
  aberto: (j) => `${j.emoji} ${j.nome} — procurando gente`,
  cheio: (j) => `${j.emoji} ${j.nome} — grupo completo`,
  expirado: (j) => `${j.emoji} ${j.nome} — expirou`,
  encerrado: (j) => `${j.emoji} ${j.nome} — encerrado`,
};

export function montarCard(jogo, grupo, membros) {
  const lista = membros.length
    ? membros.map((id) => `<@${id}>`).join(", ")
    : "_ninguém ainda_";

  const campos = [
    { name: "Quando", value: grupo.quando, inline: true },
    { name: "Vagas", value: `${membros.length}/${grupo.vagas}`, inline: true },
    { name: "Quem tá dentro", value: lista, inline: false },
  ];

  if (grupo.obs) {
    campos.push({ name: "Obs", value: grupo.obs, inline: false });
  }

  // Timestamp nativo do Discord: cada um vê no próprio fuso, e o "expira" fica
  // com contagem relativa viva ("em 2 horas") sem o bot precisar reeditar.
  const segundos = Math.floor(grupo.expira_em / 1000);
  if (grupo.estado === "aberto") {
    campos.push({ name: "Expira", value: `<t:${segundos}:R>`, inline: false });
  }

  // Avisa que o card vai sumir, senão a mensagem desaparece do nada e parece
  // que alguém apagou.
  if (grupo.apagar_em) {
    campos.push({
      name: "​",
      value: `_Esta mensagem some <t:${Math.floor(grupo.apagar_em / 1000)}:R>._`,
      inline: false,
    });
  }

  const embed = {
    title: TITULOS[grupo.estado](jogo),
    color: CORES[grupo.estado],
    fields: campos,
    footer: { text: `grupo #${grupo.id}` },
  };

  const componentes =
    grupo.estado === "aberto"
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: `Tô dentro (${membros.length}/${grupo.vagas})`,
                custom_id: `entrar:${grupo.id}`,
              },
              { type: 2, style: 2, label: "Sair", custom_id: `sair:${grupo.id}` },
              {
                type: 2,
                style: 4,
                label: "Encerrar",
                custom_id: `encerrar:${grupo.id}`,
              },
            ],
          },
        ]
      : [];

  return { embeds: [embed], components: componentes };
}

export async function buscarGrupo(env, id) {
  return env.DB.prepare("SELECT * FROM grupos WHERE id = ?").bind(id).first();
}

// Redesenha o card a partir do estado atual do banco. Só um caminho de
// renderização, então botão, cron e comando nunca divergem.
export async function redesenharCard(env, grupo) {
  const jogo = await env.DB.prepare(
    "SELECT slug, nome, emoji, cargo_id FROM jogos WHERE slug = ?"
  )
    .bind(grupo.jogo_slug)
    .first();
  const membros = await membrosDoGrupo(env, grupo.id);
  return { corpo: montarCard(jogo, grupo, membros), jogo, membros };
}

// Quando lota: cria thread na própria mensagem e chama a galera lá dentro.
// Sem isso o grupo se forma e ninguém sabe para onde ir.
export async function abrirThread(env, grupo, jogo, membros) {
  try {
    const thread = await api(
      env,
      `/channels/${grupo.canal_id}/messages/${grupo.mensagem_id}/threads`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `${jogo.nome} — grupo #${grupo.id}`,
          auto_archive_duration: 1440,
        }),
      }
    );

    await api(env, `/channels/${thread.id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content:
          `Fechou! ${membros.map((id) => `<@${id}>`).join(" ")}\n` +
          `Combinem aqui: call, horário, o que for.`,
        allowed_mentions: { users: membros },
      }),
    });

    await env.DB.prepare("UPDATE grupos SET thread_id = ? WHERE id = ?")
      .bind(thread.id, grupo.id)
      .run();

    return thread.id;
  } catch (err) {
    // Canal sem permissão de thread não pode quebrar a formação do grupo.
    console.log("Não consegui abrir thread:", err.message);
    return null;
  }
}

// Roda no cron. Fecha o que passou da hora e apaga os botões, para valer a
// regra que resolve a ambiguidade: se está com botão, está valendo.
export async function expirarVencidos(env) {
  const agora = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT * FROM grupos WHERE estado = 'aberto' AND expira_em < ?"
  )
    .bind(agora)
    .all();

  for (const grupo of results ?? []) {
    grupo.estado = "expirado";
    marcarParaApagar(grupo);
    await env.DB.prepare(
      "UPDATE grupos SET estado = 'expirado', apagar_em = ? WHERE id = ?"
    )
      .bind(grupo.apagar_em, grupo.id)
      .run();

    if (!grupo.mensagem_id) continue;
    try {
      const { corpo } = await redesenharCard(env, grupo);
      await api(env, `/channels/${grupo.canal_id}/messages/${grupo.mensagem_id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...corpo, content: "" }),
      });
    } catch (err) {
      console.log("Falha ao expirar grupo", grupo.id, "-", err.message);
    }
  }

  return (results ?? []).length;
}

// Roda no cron logo depois da expiração: remove do canal os cards mortos cuja
// carência já venceu.
//
// Grupos que geraram thread ficam de fora de propósito: no Discord, apagar a
// mensagem apaga junto a thread pendurada nela, e ali tem conversa de gente que
// combinou de jogar. Card sem thread não leva nada embora.
export async function apagarCardsVencidos(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, canal_id, mensagem_id FROM grupos " +
      "WHERE apagar_em IS NOT NULL AND apagar_em < ? " +
      "AND mensagem_id IS NOT NULL AND thread_id IS NULL"
  )
    .bind(Date.now())
    .all();

  let apagados = 0;

  for (const grupo of results ?? []) {
    try {
      await api(env, `/channels/${grupo.canal_id}/messages/${grupo.mensagem_id}`, {
        method: "DELETE",
      });
      apagados++;
    } catch (err) {
      // 404 = alguém já apagou na mão. Nos dois casos a linha é finalizada
      // abaixo, senão o cron tentaria de novo a cada 5 minutos para sempre.
      console.log("Não apaguei o card do grupo", grupo.id, "-", err.message);
    }

    await env.DB.prepare(
      "UPDATE grupos SET mensagem_id = NULL, apagar_em = NULL WHERE id = ?"
    )
      .bind(grupo.id)
      .run();
  }

  return apagados;
}
