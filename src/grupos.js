// Cards de grupo (mecânica 2), expiração (mecânica 3) e o fechamento do ciclo
// quando o grupo lota.

import { api } from "./discord.js";

export const DURACAO_PADRAO_HORAS = 3;

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
    await env.DB.prepare("UPDATE grupos SET estado = 'expirado' WHERE id = ?")
      .bind(grupo.id)
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
