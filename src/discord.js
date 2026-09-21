// Camada fina sobre a API do Discord: verificação de assinatura, chamadas REST
// e as constantes numéricas do protocolo de interações.

export const API = "https://discord.com/api/v10";

export const TIPO_INTERACAO = {
  PING: 1,
  COMANDO: 2,
  COMPONENTE: 3,
  AUTOCOMPLETE: 4,
};

export const RESPOSTA = {
  PONG: 1,
  MENSAGEM: 4,
  ADIAR_MENSAGEM: 5, // mostra "pensando..." e libera os 3s de prazo
  ADIAR_UPDATE: 6, // idem, mas editando a mensagem que tem o botão
  UPDATE: 7,
  AUTOCOMPLETE: 8,
};

export const EFEMERA = 64; // flag de mensagem que só o autor enxerga

// Permissões usadas nas checagens de admin (bitfield do Discord).
export const PERM_GERENCIAR_SERVIDOR = 1n << 5n;
export const PERM_ADMINISTRADOR = 1n << 3n;

function hexParaBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// O Discord assina cada requisição com Ed25519 e periodicamente manda pedidos
// com assinatura inválida de propósito, para conferir que o endpoint rejeita.
// Responder 401 nesses casos é obrigatório — sem isso ele recusa salvar a URL.
export async function assinaturaValida(request, corpoBruto, chavePublica) {
  const assinatura = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!assinatura || !timestamp || !chavePublica) return false;

  try {
    const chave = await crypto.subtle.importKey(
      "raw",
      hexParaBytes(chavePublica),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      chave,
      hexParaBytes(assinatura),
      new TextEncoder().encode(timestamp + corpoBruto)
    );
  } catch {
    return false;
  }
}

export async function api(env, caminho, opcoes = {}) {
  const res = await fetch(`${API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bot ${(env.DISCORD_TOKEN ?? "").trim()}`,
      "Content-Type": "application/json",
      ...(opcoes.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(
      `Discord ${opcoes.method ?? "GET"} ${caminho} -> ${res.status} ${await res.text()}`
    );
  }
  return res.status === 204 ? null : res.json();
}

// Edita a mensagem que o bot já respondeu (depois de ADIAR_*). Usa o token da
// interação, não o token do bot — por isso não passa pelo api() acima.
export async function editarResposta(interacao, corpo) {
  const res = await fetch(
    `${API}/webhooks/${interacao.application_id}/${interacao.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }
  );
  if (!res.ok) {
    throw new Error(`Falha ao editar resposta: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Mensagem extra na mesma interação — usada para avisar erro sem sobrescrever
// o card que acabou de ser atualizado.
export async function responderExtra(interacao, corpo) {
  await fetch(`${API}/webhooks/${interacao.application_id}/${interacao.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flags: EFEMERA, ...corpo }),
  });
}

// DM fechada é comum e não pode derrubar o resto do fluxo, então falha em
// silêncio e devolve false para quem quiser contabilizar.
export async function enviarDm(env, usuarioId, corpo) {
  try {
    const canal = await api(env, "/users/@me/channels", {
      method: "POST",
      body: JSON.stringify({ recipient_id: usuarioId }),
    });
    await api(env, `/channels/${canal.id}/messages`, {
      method: "POST",
      body: JSON.stringify(corpo),
    });
    return true;
  } catch (err) {
    console.log("DM não entregue para", usuarioId, "-", err.message);
    return false;
  }
}

export function ehAdmin(membro) {
  if (!membro?.permissions) return false;
  const permissoes = BigInt(membro.permissions);
  return (
    (permissoes & PERM_ADMINISTRADOR) !== 0n ||
    (permissoes & PERM_GERENCIAR_SERVIDOR) !== 0n
  );
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
