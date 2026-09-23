// Definição e execução dos slash commands.
//
// Cada comando diz se pode responder na hora (`adiar: false`) ou se precisa
// adiar. A diferença importa: **editar** uma mensagem não dispara notificação
// no Discord. Como a mecânica do ping dirigido depende da notificação chegar,
// o /grupo responde direto, com a menção do cargo já no primeiro envio.

import {
  RESPOSTA,
  EFEMERA,
  editarResposta,
  buscarMensagemOriginal,
  ehAdmin,
} from "./discord.js";
import {
  listarJogos,
  buscarJogo,
  garantirCargo,
  paraSlug,
  publicarPainel,
  sincronizarPainel,
} from "./jogos.js";
import { DURACAO_PADRAO_HORAS, montarCard } from "./grupos.js";
import { entrarNaFila, cruzarFila, avisarFilaDeGrupoNovo } from "./fila.js";

const OPCAO = { SUBCOMANDO: 1, TEXTO: 3, NUMERO: 4, CARGO: 8 };
const SO_ADMIN = "32"; // Gerenciar Servidor

export const DEFINICOES = [
  {
    name: "grupo",
    description: "Abre um grupo e chama quem joga esse jogo",
    options: [
      {
        name: "jogo",
        description: "Qual jogo",
        type: OPCAO.TEXTO,
        required: true,
        autocomplete: true,
      },
      {
        name: "vagas",
        description: "Quantas pessoas no total, contando você",
        type: OPCAO.NUMERO,
        required: true,
        min_value: 2,
        max_value: 10,
      },
      {
        name: "quando",
        description: 'Ex.: "agora", "21h", "depois da janta"',
        type: OPCAO.TEXTO,
        required: false,
      },
      {
        name: "obs",
        description: "Algum detalhe (modo, nível, o que for)",
        type: OPCAO.TEXTO,
        required: false,
      },
      {
        name: "duracao",
        description: `Em quantas horas o grupo expira (padrão ${DURACAO_PADRAO_HORAS})`,
        type: OPCAO.NUMERO,
        required: false,
        min_value: 1,
        max_value: 12,
      },
    ],
  },
  {
    name: "avisar",
    description: "Entra na fila: o bot te chama na DM quando aparecer companhia",
    options: [
      {
        name: "jogo",
        description: "Qual jogo",
        type: OPCAO.TEXTO,
        required: true,
        autocomplete: true,
      },
      {
        name: "horas",
        description: "Por quantas horas você fica na fila (padrão 4)",
        type: OPCAO.NUMERO,
        required: false,
        min_value: 1,
        max_value: 12,
      },
    ],
  },
  {
    name: "painel",
    description: "Publica o painel de cargos neste canal",
    default_member_permissions: SO_ADMIN,
  },
  {
    name: "jogo",
    description: "Gerencia os jogos do bot",
    default_member_permissions: SO_ADMIN,
    options: [
      {
        name: "add",
        description: "Cadastra um jogo novo",
        type: OPCAO.SUBCOMANDO,
        options: [
          { name: "nome", description: "Nome do jogo", type: OPCAO.TEXTO, required: true },
          { name: "emoji", description: "Emoji do botão", type: OPCAO.TEXTO, required: false },
          {
            name: "cargo",
            description: "Usar um cargo que já existe (senão o bot cria)",
            type: OPCAO.CARGO,
            required: false,
          },
          {
            name: "appid",
            description: "AppID na Steam (para os avisos de patch, depois)",
            type: OPCAO.NUMERO,
            required: false,
          },
        ],
      },
      {
        name: "remover",
        description: "Tira um jogo do painel",
        type: OPCAO.SUBCOMANDO,
        options: [
          {
            name: "jogo",
            description: "Qual jogo",
            type: OPCAO.TEXTO,
            required: true,
            autocomplete: true,
          },
        ],
      },
      { name: "listar", description: "Mostra os jogos cadastrados", type: OPCAO.SUBCOMANDO },
    ],
  },
];

function lerOpcoes(lista = []) {
  const mapa = {};
  for (const o of lista) mapa[o.name] = o.value;
  return mapa;
}

// Achata subcomando: devolve { sub, opcoes } para /jogo add, /jogo listar etc.
function lerComando(dados) {
  const primeiro = dados.options?.[0];
  if (primeiro?.type === OPCAO.SUBCOMANDO) {
    return { sub: primeiro.name, opcoes: lerOpcoes(primeiro.options) };
  }
  return { sub: null, opcoes: lerOpcoes(dados.options) };
}

function texto(conteudo) {
  return { type: RESPOSTA.MENSAGEM, data: { content: conteudo, flags: EFEMERA } };
}

// ---------------------------------------------------------------- /grupo

async function cmdGrupo(env, interacao, ctx) {
  const { opcoes } = lerComando(interacao.data);
  const jogo = await buscarJogo(env, opcoes.jogo);
  if (!jogo) {
    return texto("Esse jogo não está cadastrado. Um admin pode criar com `/jogo add`.");
  }

  const cargoId = await garantirCargo(env, interacao.guild_id, jogo);
  const donoId = interacao.member.user.id;
  const agora = Date.now();
  const duracao = (opcoes.duracao ?? DURACAO_PADRAO_HORAS) * 3600_000;

  const grupo = await env.DB.prepare(
    "INSERT INTO grupos (jogo_slug, guild_id, canal_id, dono_id, vagas, quando, obs, criado_em, expira_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
  )
    .bind(
      jogo.slug,
      interacao.guild_id,
      interacao.channel_id,
      donoId,
      opcoes.vagas,
      (opcoes.quando ?? "agora").slice(0, 80),
      (opcoes.obs ?? "").slice(0, 300),
      agora,
      agora + duracao
    )
    .first();

  // Quem abre já conta como dentro: ninguém abre grupo para não jogar.
  await env.DB.prepare(
    "INSERT INTO grupo_membros (grupo_id, usuario_id, entrou_em) VALUES (?, ?, ?)"
  )
    .bind(grupo.id, donoId, agora)
    .run();

  const card = montarCard(jogo, grupo, [donoId]);

  // O id da mensagem só existe depois que o Discord publica a resposta, então
  // o resto (salvar o id, chamar a fila) acontece em segundo plano.
  ctx.waitUntil(
    (async () => {
      try {
        const msg = await buscarMensagemOriginal(env, interacao);
        await env.DB.prepare("UPDATE grupos SET mensagem_id = ? WHERE id = ?")
          .bind(msg.id, grupo.id)
          .run();
        grupo.mensagem_id = msg.id;
        await avisarFilaDeGrupoNovo(env, jogo, grupo, donoId);
      } catch (err) {
        console.log("Pós-processamento do grupo falhou:", err.message);
      }
    })()
  );

  return {
    type: RESPOSTA.MENSAGEM,
    data: {
      content: `<@&${cargoId}> — bora?`,
      ...card,
      allowed_mentions: { roles: [cargoId] },
    },
  };
}

// --------------------------------------------------------------- /avisar

async function cmdAvisar(env, interacao) {
  const { opcoes } = lerComando(interacao.data);
  const jogo = await buscarJogo(env, opcoes.jogo);
  if (!jogo) {
    await editarResposta(interacao, { content: "Esse jogo não está cadastrado." });
    return;
  }

  const horas = opcoes.horas ?? 4;
  const usuarioId = interacao.member.user.id;

  await entrarNaFila(env, {
    jogoSlug: jogo.slug,
    usuarioId,
    guildId: interacao.guild_id,
    horas,
  });

  const encontrados = await cruzarFila(env, jogo, usuarioId, interacao.channel_id);

  const conteudo = encontrados
    ? `${jogo.emoji} Achei **${encontrados}** pessoa(s) esperando **${jogo.nome}** agora — ` +
      `mandei DM para todo mundo. Abre um \`/grupo\` que eles entram.`
    : `${jogo.emoji} Anotado: você quer jogar **${jogo.nome}** nas próximas **${horas}h**.\n` +
      `Ninguém na fila agora, mas te chamo na DM assim que alguém aparecer.`;

  await editarResposta(interacao, {
    content: conteudo,
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "Cancelar aviso",
            custom_id: `fila-sair:${jogo.slug}`,
          },
        ],
      },
    ],
  });
}

// --------------------------------------------------------------- /painel

async function cmdPainel(env, interacao) {
  if (!ehAdmin(interacao.member)) {
    await editarResposta(interacao, { content: "Só quem gerencia o servidor pode publicar o painel." });
    return;
  }

  const r = await publicarPainel(env, interacao.guild_id, interacao.channel_id);
  await editarResposta(interacao, {
    content: r.atualizado
      ? "Painel atualizado neste canal."
      : "Painel publicado. Os cargos que faltavam foram criados.",
  });
}

// ----------------------------------------------------------------- /jogo

async function cmdJogo(env, interacao) {
  if (!ehAdmin(interacao.member)) {
    await editarResposta(interacao, { content: "Só quem gerencia o servidor pode mexer nos jogos." });
    return;
  }

  const { sub, opcoes } = lerComando(interacao.data);

  if (sub === "listar") {
    const jogos = await listarJogos(env);
    const linhas = jogos.map(
      (j) => `${j.emoji || "•"} **${j.nome}** — \`${j.slug}\`${j.cargo_id ? "" : " _(cargo ainda não criado)_"}`
    );
    await editarResposta(interacao, {
      content: linhas.length ? linhas.join("\n") : "Nenhum jogo cadastrado ainda.",
    });
    return;
  }

  if (sub === "remover") {
    const r = await env.DB.prepare("DELETE FROM jogos WHERE slug = ?").bind(opcoes.jogo).run();
    await sincronizarPainel(env, interacao.guild_id);
    await editarResposta(interacao, {
      content: r.meta?.changes
        ? `Removido do painel. O cargo continua existindo no servidor — apague na mão se quiser.`
        : "Não achei esse jogo.",
    });
    return;
  }

  // add
  const nome = String(opcoes.nome).trim().slice(0, 60);
  const slug = paraSlug(nome);
  if (!slug) {
    await editarResposta(interacao, { content: "Nome inválido." });
    return;
  }

  const ordem = (await env.DB.prepare("SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM jogos").first())?.n ?? 1;

  await env.DB.prepare(
    "INSERT INTO jogos (slug, nome, emoji, cargo_id, steam_appid, ordem) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(slug) DO UPDATE SET nome = excluded.nome, emoji = excluded.emoji, " +
      "cargo_id = COALESCE(excluded.cargo_id, jogos.cargo_id), " +
      "steam_appid = COALESCE(excluded.steam_appid, jogos.steam_appid)"
  )
    .bind(slug, nome, opcoes.emoji ?? "", opcoes.cargo ?? null, opcoes.appid ?? null, ordem)
    .run();

  const jogo = await buscarJogo(env, slug);
  await garantirCargo(env, interacao.guild_id, jogo);
  await sincronizarPainel(env, interacao.guild_id);

  await editarResposta(interacao, {
    content:
      `**${nome}** cadastrado (\`${slug}\`) e já está no painel.\n` +
      `Agora dá para usar \`/grupo jogo:${nome}\` e \`/avisar jogo:${nome}\`.`,
  });
}

// ------------------------------------------------------------ autocomplete

export async function autocompletarJogo(env, interacao) {
  const dados = interacao.data;
  const busca =
    (dados.options?.[0]?.type === OPCAO.SUBCOMANDO
      ? dados.options[0].options
      : dados.options
    )?.find((o) => o.focused)?.value ?? "";

  const jogos = await listarJogos(env);
  const termo = String(busca).toLowerCase();
  const escolhas = jogos
    .filter((j) => j.nome.toLowerCase().includes(termo))
    .slice(0, 25)
    .map((j) => ({ name: `${j.emoji} ${j.nome}`.trim(), value: j.slug }));

  return { type: RESPOSTA.AUTOCOMPLETE, data: { choices: escolhas } };
}

export const COMANDOS = {
  grupo: { adiar: false, executar: cmdGrupo },
  avisar: { adiar: true, efemera: true, executar: cmdAvisar },
  painel: { adiar: true, efemera: true, executar: cmdPainel },
  jogo: { adiar: true, efemera: true, executar: cmdJogo },
};
