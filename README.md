# busca-player — buscar grupo

Bot de LFG do servidor Gamepass Brasil. Implementa as quatro mecânicas que
resolvem o canal `#buscar-grupo`:

1. **Cargo por jogo com ping dirigido** — painel de botões onde cada um marca o
   que joga. Quem abre grupo menciona só o cargo daquele jogo.
2. **`/grupo` com botão "Tô dentro"** — entrar é um clique, não uma mensagem
   pública para um estranho.
3. **Expiração em 3h** — o card perde os botões sozinho. Regra: se está com
   botão, está valendo.
4. **`/avisar` — fila assíncrona** — registra que você quer jogar; quando outra
   pessoa quiser o mesmo jogo, o bot chama os dois na DM.

Roda em Cloudflare Worker + D1. Já está publicado em
`https://busca-player.aniversarios-dc.workers.dev` — falta só a parte do Discord.

---

## Como usar no seu servidor

### 1. Criar a aplicação no Discord

1. Abra https://discord.com/developers/applications → **New Application**.
2. Nome: o que você quiser (ex.: `Speranza`). Aceite os termos → **Create**.
3. Ainda em **General Information**, clique no quadrado do ícone e suba o arquivo
   `assets/avatar.png` (o fantasminha, já recortado em 512×512).
4. Nessa mesma página, copie a **PUBLIC KEY**. Guarde.

### 2. Pegar o token do bot

1. Menu lateral → **Bot**.
2. **Reset Token** → **Yes, do it!** → **Copy**. Guarde.
   O token aparece **uma vez só** — se perder, é só resetar de novo.
3. Desça até **Privileged Gateway Intents** e deixe **tudo desligado**. Este bot
   não lê mensagens nem presença, então não precisa de nenhum intent.

### 3. Colocar os dois valores na Cloudflare

Pelo painel (só clique):

1. https://dash.cloudflare.com → **Compute (Workers)** → **busca-player**.
2. **Settings** → **Variables and Secrets** → **+ Add**.
3. Type: **Secret**. Nome: `DISCORD_TOKEN`. Valor: o token do passo 2. **Add**.
4. Repita para `DISCORD_PUBLIC_KEY` com a public key do passo 1.
   > Já existe um `DISCORD_PUBLIC_KEY` com um valor de teste que usei para
   > validar a assinatura. **Edite e substitua** pelo valor real.
5. **Deploy** para as mudanças valerem.

Ou pelo terminal, se preferir (ele pergunta o valor, não fica no histórico):

```bash
cd "C:\Users\rafae\Documents\busca-player"; npx wrangler secret put DISCORD_TOKEN
```

```bash
cd "C:\Users\rafae\Documents\busca-player"; npx wrangler secret put DISCORD_PUBLIC_KEY
```

### 4. Apontar o endpoint de interações

1. Volte em **General Information** na página da aplicação.
2. No campo **Interactions Endpoint URL**, cole:

```
https://busca-player.aniversarios-dc.workers.dev/
```

3. **Save Changes**. O Discord vai testar a assinatura na hora — se salvar sem
   reclamar, está tudo certo. Se der erro, o `DISCORD_PUBLIC_KEY` está errado ou
   o deploy do passo 3 não foi feito.

### 5. Convidar o bot para o servidor

1. Menu lateral → **OAuth2** → **OAuth2 URL Generator**.
2. Em **Scopes**, marque `bot` **e** `applications.commands`.
3. Em **Bot Permissions**, marque:
   - Manage Roles
   - Send Messages
   - Embed Links
   - Mention Everyone *(necessário para mencionar cargo não-mencionável)*
   - Create Public Threads
   - Send Messages in Threads
   - Read Message History
4. Copie a URL gerada lá embaixo, abra no navegador e adicione ao servidor.

### 6. Subir o cargo do bot na hierarquia

**Configurações do Servidor → Cargos** → arraste o cargo do bot para **acima**
de onde ficarão os cargos de jogo (pode ser bem no topo, abaixo só dos seus).

Sem isso o bot cria os cargos mas não consegue dar para ninguém.

### 7. Registrar os comandos

Abra esta URL uma vez no navegador:

```
https://busca-player.aniversarios-dc.workers.dev/registrar-comandos?chave=SUA_CHAVE_AQUI
```

> A chave fica só no secret `SETUP_KEY` da Cloudflare — de propósito não está
> escrita aqui, para não vazar junto com o repositório.

Deve responder algo como `{"ok":true,"aplicacao":"Speranza","servidores":["Gamepass Brasil"]}`.

> Rode isso de novo sempre que eu mexer nos comandos. É seguro repetir.

### 8. Publicar o painel

No canal `#buscar-grupo`, digite `/painel`. O bot cria os cargos **ARC Raiders**
e **WARDOGS** e publica a mensagem com os botões. Fixe essa mensagem no canal.

### 9. Travar o canal (metade da solução)

**Configurações do canal `#buscar-grupo` → Permissões → @everyone**:

- **Enviar mensagens**: ❌ negar
- **Usar comandos de aplicativo**: ✅ permitir
- **Criar tópicos públicos**: ✅ permitir
- **Enviar mensagens em tópicos**: ✅ permitir

Isso é o que faz a estrutura pegar. Se continuar aceitando texto solto, as
pessoas continuam postando texto solto e o bot vira enfeite.

### 10. Limitar os comandos ao canal (opcional, sem código)

Para o `/grupo` e o `/avisar` só funcionarem dentro do `#buscar-grupo` e não
poluírem o resto do servidor:

**Configurações do Servidor → Integrações → clique no bot → Gerenciar comandos**

Lá dá para escolher, comando por comando, em quais canais ele aparece. Deixe
`/grupo` e `/avisar` só no `#buscar-grupo`. Isso é do próprio Discord — o bot não
precisa saber de nada.

---

## Como usar

| Comando | Quem | O que faz |
|---|---|---|
| `/grupo jogo: vagas: quando: obs:` | todos | Abre o card e chama o cargo do jogo |
| `/avisar jogo: horas:` | todos | Entra na fila; o bot chama na DM quando aparecer companhia |
| `/painel` | admin | Publica/atualiza o painel de cargos no canal atual |
| `/jogo add nome: emoji: cargo: appid:` | admin | Cadastra um jogo novo |
| `/jogo remover jogo:` | admin | Tira do painel |
| `/jogo listar` | admin | Lista o que está cadastrado |

### Adicionar um jogo novo

Um comando só, no Discord:

```
/jogo add nome:Battlefield 6 emoji:🪖
```

O bot cria o cargo, cadastra e **atualiza o painel sozinho**. O jogo já aparece
no autocomplete de `/grupo` e `/avisar`. Nada de código muda.

Se o cargo já existir (caso das calls privadas), passe em `cargo:` que ele
reaproveita em vez de criar outro. O `appid:` é opcional e só serve para os
avisos de patch da Steam, que entram depois.

---

## Manutenção

Publicar mudanças no código:

```bash
cd "C:\Users\rafae\Documents\busca-player"; npx wrangler deploy
```

Ver o que está acontecendo ao vivo (útil quando algo não funciona):

```bash
cd "C:\Users\rafae\Documents\busca-player"; npx wrangler tail
```

### Se der problema

| Sintoma | Causa provável |
|---|---|
| Discord não salva a Interactions URL | `DISCORD_PUBLIC_KEY` errado, ou faltou dar Deploy depois de salvar o secret |
| Comandos não aparecem ao digitar `/` | Passo 7 não foi feito, ou o bot entrou sem o scope `applications.commands` |
| Botão do painel diz que não conseguiu mexer no cargo | Passo 6: cargo do bot está abaixo dos cargos de jogo |
| Card aparece mas ninguém é notificado | Falta a permissão **Mention Everyone** no canal |
| `/avisar` diz que mandou DM e nada chega | A pessoa está com DM de membros do servidor desativada |

---

## Arquivos

- `src/index.js` — recebe as interações, roteia e roda o cron
- `src/discord.js` — assinatura Ed25519 e chamadas REST
- `src/comandos.js` — os slash commands
- `src/componentes.js` — os botões
- `src/jogos.js` — cadastro de jogos e painel de cargos
- `src/grupos.js` — card do grupo, expiração e abertura da thread
- `src/fila.js` — fila assíncrona e as DMs
- `schema.sql` — as tabelas do D1
- `assets/avatar.png` — avatar do bot

## Backup no GitHub (opcional)

Diferente do `wardogs-bot`, aqui o GitHub **não é necessário** — quem roda o bot
é a Cloudflare, não o GitHub Actions. Se quiser guardar uma cópia:

1. https://github.com/new → nome `busca-player` → **Private** → Create.
2. Na tela seguinte, clique em **uploading an existing file**.
3. Arraste os arquivos e a pasta `src/`.
4. Commit changes.

Não suba nada com o token dentro — ele só existe como secret na Cloudflare, e
este repositório não tem nenhum arquivo com segredo.
