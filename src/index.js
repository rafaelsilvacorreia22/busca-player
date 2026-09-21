// Entrada do Worker: recebe as interações do Discord, roteia para os handlers
// e roda a limpeza agendada.

import {
  TIPO_INTERACAO,
  RESPOSTA,
  EFEMERA,
  api,
  assinaturaValida,
  json,
} from "./discord.js";
import { COMANDOS, DEFINICOES, autocompletarJogo } from "./comandos.js";
import { COMPONENTES } from "./componentes.js";
import { expirarVencidos } from "./grupos.js";
import { limparFilaVencida } from "./fila.js";

const SO_NO_SERVIDOR = {
  type: RESPOSTA.MENSAGEM,
  data: { content: "Esse comando só funciona dentro do servidor.", flags: EFEMERA },
};

function ackAdiado(modo, efemera) {
  if (modo === "update") return { type: RESPOSTA.ADIAR_UPDATE };
  return {
    type: RESPOSTA.ADIAR_MENSAGEM,
    data: efemera ? { flags: EFEMERA } : {},
  };
}

// Erro dentro do handler não pode virar 500: o Discord já recebeu o ACK e o
// usuário ficaria olhando "pensando..." para sempre. Então avisa na própria
// interação e registra no log.
async function executarComSeguranca(env, interacao, handler, rotulo) {
  try {
    await handler();
  } catch (err) {
    console.log(`Erro em ${rotulo}:`, err.stack ?? err.message);
    try {
      await fetch(
        `https://discord.com/api/v10/webhooks/${interacao.application_id}/${interacao.token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.",
            flags: EFEMERA,
          }),
        }
      );
    } catch {
      // Se nem o aviso de erro sai, não há mais o que fazer.
    }
  }
}

async function tratarInteracao(interacao, env, ctx) {
  if (interacao.type === TIPO_INTERACAO.PING) {
    return json({ type: RESPOSTA.PONG });
  }

  if (interacao.type === TIPO_INTERACAO.AUTOCOMPLETE) {
    return json(await autocompletarJogo(env, interacao));
  }

  if (interacao.type === TIPO_INTERACAO.COMANDO) {
    if (!interacao.guild_id) return json(SO_NO_SERVIDOR);

    const comando = COMANDOS[interacao.data.name];
    if (!comando) return json(SO_NO_SERVIDOR);

    if (!comando.adiar) {
      return json(await comando.executar(env, interacao, ctx));
    }

    ctx.waitUntil(
      executarComSeguranca(
        env,
        interacao,
        () => comando.executar(env, interacao, ctx),
        `/${interacao.data.name}`
      )
    );
    return json(ackAdiado("mensagem", comando.efemera));
  }

  if (interacao.type === TIPO_INTERACAO.COMPONENTE) {
    if (!interacao.guild_id) return json(SO_NO_SERVIDOR);

    const [chave, argumento] = String(interacao.data.custom_id).split(":");
    const componente = COMPONENTES[chave];
    if (!componente) return json({ type: RESPOSTA.ADIAR_UPDATE });

    if (!componente.adiar) {
      return json(await componente.executar(env, interacao, argumento));
    }

    ctx.waitUntil(
      executarComSeguranca(
        env,
        interacao,
        () => componente.executar(env, interacao, argumento),
        `botão ${chave}`
      )
    );
    return json(ackAdiado(componente.adiar, componente.efemera));
  }

  return json({ type: RESPOSTA.PONG });
}

// Registra os slash commands em todos os servidores onde o bot está. Comando
// de servidor (e não global) aparece na hora, sem a espera de propagação.
async function registrarComandos(env) {
  const app = await api(env, "/oauth2/applications/@me");
  const guilds = await api(env, "/users/@me/guilds");
  const feitos = [];

  for (const guild of guilds) {
    await api(env, `/applications/${app.id}/guilds/${guild.id}/commands`, {
      method: "PUT",
      body: JSON.stringify(DEFINICOES),
    });
    feitos.push(guild.name);
  }

  return { aplicacao: app.name, servidores: feitos };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/registrar-comandos") {
      const chave = (env.SETUP_KEY ?? "").trim();
      if (!chave || url.searchParams.get("chave") !== chave) {
        return new Response("Chave inválida.", { status: 401 });
      }
      try {
        const r = await registrarComandos(env);
        return json({ ok: true, ...r });
      } catch (err) {
        return json({ ok: false, erro: err.message }, 500);
      }
    }

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("busca-player no ar.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response("Método não permitido.", { status: 405 });
    }

    // O corpo precisa ser lido cru: a assinatura é sobre os bytes exatos, e
    // reserializar o JSON mudaria o texto e invalidaria a verificação.
    const corpoBruto = await request.text();
    if (!(await assinaturaValida(request, corpoBruto, (env.DISCORD_PUBLIC_KEY ?? "").trim()))) {
      return new Response("Assinatura inválida.", { status: 401 });
    }

    let interacao;
    try {
      interacao = JSON.parse(corpoBruto);
    } catch {
      return new Response("JSON inválido.", { status: 400 });
    }

    return tratarInteracao(interacao, env, ctx);
  },

  async scheduled(evento, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const expirados = await expirarVencidos(env);
        const limpos = await limparFilaVencida(env);
        console.log(`cron: ${expirados} grupo(s) expirado(s), ${limpos} da fila limpos`);
      })()
    );
  },
};
