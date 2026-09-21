// Handlers dos botões: painel de cargos, entrar/sair de grupo e sair da fila.

import { RESPOSTA, api, editarResposta, responderExtra, ehAdmin } from "./discord.js";
import { buscarJogo } from "./jogos.js";
import { buscarGrupo, redesenharCard, abrirThread, membrosDoGrupo } from "./grupos.js";
import { sairDaFila } from "./fila.js";

// ------------------------------------------------- botão do painel de cargos

async function btnCargo(env, interacao, slug) {
  const jogo = await buscarJogo(env, slug);
  if (!jogo?.cargo_id) {
    await editarResposta(interacao, { content: "Esse jogo saiu do painel." });
    return;
  }

  const usuarioId = interacao.member.user.id;
  const jaTem = (interacao.member.roles ?? []).includes(jogo.cargo_id);
  const rota = `/guilds/${interacao.guild_id}/members/${usuarioId}/roles/${jogo.cargo_id}`;

  try {
    await api(env, rota, { method: jaTem ? "DELETE" : "PUT" });
  } catch (err) {
    // Quase sempre é hierarquia: o cargo do bot está abaixo do cargo do jogo.
    await editarResposta(interacao, {
      content:
        "Não consegui mexer no seu cargo. Um admin precisa arrastar o cargo do bot " +
        "para **acima** dos cargos de jogo, em Configurações do servidor → Cargos.",
    });
    console.log("Falha ao alternar cargo:", err.message);
    return;
  }

  await editarResposta(interacao, {
    content: jaTem
      ? `${jogo.emoji} Saiu de **${jogo.nome}** — não te chamo mais nos grupos desse jogo.`
      : `${jogo.emoji} Entrou em **${jogo.nome}** — agora você é avisado quando abrirem grupo.`,
  });
}

// ------------------------------------------------------ botões do card

async function atualizarCard(env, interacao, grupo) {
  const { corpo, jogo, membros } = await redesenharCard(env, grupo);
  await editarResposta(interacao, corpo);
  return { jogo, membros };
}

async function btnEntrar(env, interacao, grupoId) {
  const grupo = await buscarGrupo(env, grupoId);
  if (!grupo) return;

  if (grupo.estado !== "aberto") {
    await responderExtra(interacao, { content: "Esse grupo não está mais aberto." });
    return;
  }

  const usuarioId = interacao.member.user.id;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO grupo_membros (grupo_id, usuario_id, entrou_em) VALUES (?, ?, ?)"
  )
    .bind(grupo.id, usuarioId, Date.now())
    .run();

  const membros = await membrosDoGrupo(env, grupo.id);

  if (membros.length >= grupo.vagas) {
    grupo.estado = "cheio";
    await env.DB.prepare("UPDATE grupos SET estado = 'cheio' WHERE id = ?").bind(grupo.id).run();
  }

  const { jogo } = await atualizarCard(env, interacao, grupo);

  // A thread é a única mensagem nova do fluxo, então é ela que notifica de
  // verdade quem entrou — editar o card sozinho não avisaria ninguém.
  if (grupo.estado === "cheio" && !grupo.thread_id && grupo.mensagem_id) {
    await abrirThread(env, grupo, jogo, membros);
  }
}

async function btnSair(env, interacao, grupoId) {
  const grupo = await buscarGrupo(env, grupoId);
  if (!grupo) return;

  if (grupo.estado === "expirado" || grupo.estado === "encerrado") {
    await responderExtra(interacao, { content: "Esse grupo já foi encerrado." });
    return;
  }

  await env.DB.prepare("DELETE FROM grupo_membros WHERE grupo_id = ? AND usuario_id = ?")
    .bind(grupo.id, interacao.member.user.id)
    .run();

  const membros = await membrosDoGrupo(env, grupo.id);

  // Abriu vaga num grupo que estava cheio: volta a aceitar gente.
  if (grupo.estado === "cheio" && membros.length < grupo.vagas) {
    grupo.estado = "aberto";
    await env.DB.prepare("UPDATE grupos SET estado = 'aberto' WHERE id = ?").bind(grupo.id).run();
  }

  await atualizarCard(env, interacao, grupo);
}

async function btnEncerrar(env, interacao, grupoId) {
  const grupo = await buscarGrupo(env, grupoId);
  if (!grupo) return;

  const usuarioId = interacao.member.user.id;
  if (grupo.dono_id !== usuarioId && !ehAdmin(interacao.member)) {
    await responderExtra(interacao, { content: "Só quem abriu o grupo pode encerrar." });
    return;
  }

  grupo.estado = "encerrado";
  await env.DB.prepare("UPDATE grupos SET estado = 'encerrado' WHERE id = ?").bind(grupo.id).run();
  await atualizarCard(env, interacao, grupo);
}

// ------------------------------------------------------------ botão da fila

async function btnSairFila(env, interacao, slug) {
  await sairDaFila(env, slug, interacao.member.user.id);
  return {
    type: RESPOSTA.UPDATE,
    data: { content: "Aviso cancelado — você saiu da fila.", components: [] },
  };
}

export const COMPONENTES = {
  cargo: { adiar: "mensagem", efemera: true, executar: btnCargo },
  entrar: { adiar: "update", executar: btnEntrar },
  sair: { adiar: "update", executar: btnSair },
  encerrar: { adiar: "update", executar: btnEncerrar },
  "fila-sair": { adiar: false, executar: btnSairFila },
};
