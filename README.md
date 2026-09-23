# busca-player

Bot de Discord que faz um canal de "procuro grupo" realmente funcionar.

O problema que ele resolve é conhecido: alguém escreve *"alguém pra jogar X?"*, a
mensagem não alcança quem joga X, ninguém responde, o canal vira cemitério e as
pessoas param de tentar. Este bot ataca as quatro causas disso.

---

## Como funciona no dia a dia

### 1. Cada um marca o que joga e só é avisado disso

Uma mensagem fixa no canal tem um botão por jogo. Clicou, ganhou o cargo daquele
jogo; clicou de novo, saiu.

Quem abre grupo menciona **só o cargo daquele jogo**. Quem joga recebe
notificação de verdade; quem não joga nunca é incomodado. É o que impede o canal
de ser mutado por todo mundo.

Os cargos nascem **não-mencionáveis**: só o bot menciona, e só dentro de um card
de grupo. Sem isso vira abuso de ping em uma semana.

### 2. `/grupo` em vez de texto solto

```
/grupo jogo:ARC Raiders vagas:3 quando:agora
```

O bot publica um card com o botão **"Tô dentro (1/3)"**. Entrar é um clique, não
uma mensagem pública para um estranho é isso que derruba o custo social de
responder. O card mostra ao vivo quem já entrou e quantas vagas sobraram.

Quem abriu já entra contado. `vagas:3` significa você + 2.

### 3. O card morre sozinho

- **3 horas** depois de aberto, o card expira e perde os botões.
- **1 hora** depois de encerrado ou expirado, a mensagem some do canal.

A regra que isso cria é simples e absoluta: **se está com botão, está valendo.**
Acaba a dúvida de "será que essa mensagem de ontem ainda vale?", e o canal não
acumula card morto.

Exceção: grupo que gerou thread não é apagado. No Discord, apagar a mensagem
apaga a thread junto — e é lá que a galera combinou de jogar.

### 4. `/avisar` para quando não tem ninguém online


```
/avisar jogo:ARC Raiders
```

Não publica nada. Registra que você quer jogar nas próximas horas. Quando outra
pessoa registrar interesse no mesmo jogo, **o bot chama os dois na DM**. E se
alguém abrir um `/grupo` daquele jogo, quem está na fila recebe o link direto.

Isso converte o canal de síncrono (precisa de duas pessoas online no mesmo
minuto, o que quase nunca acontece) para assíncrono.

### Quando o grupo lota

O bot cria uma thread no próprio card e marca os participantes lá dentro. Sem
isso o grupo se forma e ninguém sabe para onde ir.

---

## Comandos

| Comando | Quem pode | O que faz |
|---|---|---|
| `/grupo jogo: vagas: quando: obs: duracao:` | todos | Abre o card e chama o cargo do jogo |
| `/avisar jogo: horas:` | todos | Entra na fila; o bot chama na DM quando aparecer companhia |
| `/painel` | admin | Publica ou atualiza o painel de cargos no canal atual |
| `/jogo add nome: emoji: cargo: appid:` | admin | Cadastra um jogo |
| `/jogo remover jogo:` | admin | Tira do painel |
| `/jogo listar` | admin | Lista o que está cadastrado |

Só `nome` e `vagas`/`jogo` são obrigatórios; o resto tem padrão.

## Adicionar um jogo novo

Um comando, dentro do Discord. Nada de código muda.

**Se o cargo já existe** (o caso comum — normalmente já há um cargo que dá acesso
à call daquele jogo), aponte para ele:

```
/jogo add nome:League of Legends emoji:⚔️ cargo:@Summoners Rift
```

Assim clicar no botão do painel também libera a call. **Não crie um cargo novo se
já existe um** — você fica com dois cargos de mesmo nome e ninguém entende qual é
qual.

**Se não existe**, omita `cargo:` que o bot cria:

```
/jogo add nome:Battlefield 6 emoji:🪖
```

Nos dois casos o painel se atualiza sozinho e o jogo já aparece no autocomplete
de `/grupo` e `/avisar`.

O `appid:` é opcional e guarda o AppID da Steam, para os avisos de patch notes
que podem vir depois.

---

## Instalação

Roda em Cloudflare Worker + D1. Ambos cabem no plano gratuito com folga.

### 1. Criar a aplicação no Discord

1. https://discord.com/developers/applications → **New Application**
2. Dê um nome e suba um ícone em **General Information**
3. Copie a **PUBLIC KEY** (dessa mesma página)
4. Menu **Bot** → **Reset Token** → copie. **Aparece uma vez só.**
5. Ainda em **Bot**, deixe os três *Privileged Gateway Intents* **desligados**
   este bot não lê mensagens nem presença

### 2. Publicar o worker

```bash
npx wrangler d1 create busca-player
```

Copie o `database_id` devolvido para o `wrangler.jsonc`, e então:

```bash
npx wrangler d1 execute busca-player --remote --file=schema.sql
```

```bash
npx wrangler deploy
```

### 3. Configurar os segredos

```bash
npx wrangler secret put DISCORD_TOKEN
```

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
```

```bash
npx wrangler secret put SETUP_KEY
```

`SETUP_KEY` é um valor aleatório que você inventa — ele protege a rota que
registra os comandos. Cada comando pergunta o valor no terminal, então nada fica
no histórico.

### 4. Ligar o Discord ao worker

Em **General Information**, no campo **Interactions Endpoint URL**, cole a URL do
worker (termina em `.workers.dev/`) e salve.

O Discord testa na hora, mandando um PING assinado. **Se salvar sem reclamar, a
ponte está validada.** Se der erro, a `DISCORD_PUBLIC_KEY` está errada.

### 5. Convidar o bot

**OAuth2 → URL Generator**, marcando os scopes `bot` e `applications.commands`, e
as permissões:

- Manage Roles
- Send Messages · Embed Links · Read Message History
- **Mention Everyone** (necessário para mencionar cargo não-mencionável)
- Create Public Threads · Send Messages in Threads

### 6. Registrar os comandos

Abra no navegador, uma vez:

```
https://SEU-WORKER.workers.dev/registrar-comandos?chave=SUA_SETUP_KEY
```

Deve responder `{"ok":true,...}` listando os servidores. Repita sempre que os
comandos mudarem — é seguro rodar de novo.

### 7. Publicar o painel

No canal escolhido, digite `/painel` e fixe a mensagem.

### 8. Travar o canal

**Permissões do canal → @everyone**: negue **Enviar mensagens**, mantendo
permitidos *Usar comandos de aplicativo*, *Criar tópicos públicos* e *Enviar
mensagens em tópicos*.

Esse passo vale tanto quanto o bot. Se o canal continuar aceitando texto solto, as
pessoas continuam postando texto solto e a estrutura nunca pega.

Opcionalmente, em **Configurações do Servidor → Integrações → o bot → Gerenciar
comandos**, limite `/grupo` e `/avisar` a esse canal só.

---

## As duas permissões que quebram na prática

Se algo não funcionar, é quase certo que seja uma dessas as duas dão erro
silencioso ou confuso.

**1. O cargo do bot precisa estar ACIMA dos cargos de jogo.**
Em **Configurações do Servidor → Cargos**, arraste o cargo do bot para cima dos
cargos que ele vai distribuir. Um bot não consegue dar um cargo que esteja acima
do dele na lista. Bots entram no fim da hierarquia, então isso quase sempre
precisa ser ajustado na mão.

**2. O bot precisa de permissão no canal, não só no servidor.**
Canal com permissões próprias ignora o que foi dado no convite. Em **Permissões
do canal**, adicione o cargo do bot e libere: *Ver canal*, *Enviar mensagens*,
*Inserir links*, *Mencionar @everyone e todos os cargos*, *Criar tópicos
públicos*, *Enviar mensagens em tópicos*, *Ver histórico*.

Quando um comando falha, o bot responde com a mensagem crua do Discord numa
mensagem que só você vê normalmente ela já diz qual permissão falta.

---

## Manutenção

Publicar mudanças de código:

```bash
npx wrangler deploy
```

Ver o que está acontecendo ao vivo:

```bash
npx wrangler tail
```

**Mudanças de banco:** o `schema.sql` usa `CREATE TABLE IF NOT EXISTS`, que não
altera tabela existente. Então toda mudança de coluna em banco já no ar entra como
um arquivo em `migracoes/`, rodado uma vez:

```bash
npx wrangler d1 execute busca-player --remote --file=migracoes/001-apagar-cards-mortos.sql
```

### Se der problema

| Sintoma | Causa provável |
|---|---|
| Discord não salva a Interactions URL | `DISCORD_PUBLIC_KEY` errada, ou faltou publicar depois de gravar o segredo |
| Comandos não aparecem ao digitar `/` | Passo 6 não foi feito, ou faltou o scope `applications.commands` |
| Botão do painel reclama de cargo | Cargo do bot abaixo dos cargos de jogo (ver acima) |
| `/painel` responde "Missing Permissions" | Permissão faltando **no canal** (ver acima) |
| Card aparece mas ninguém é notificado | Falta **Mention Everyone** no canal |
| Dois comandos iguais no autocomplete | Outro bot usa o mesmo nome — confira a coluna da direita antes de escolher |
| `/avisar` diz que mandou DM e nada chega | A pessoa tem DM de membros do servidor desativada |

---

## Como está montado

Não usa gateway nem conexão permanente: tudo são interações HTTP assinadas, o que
permite rodar num Worker sem servidor ligado. A contrapartida é que o bot não lê
mensagens comuns nem vê quem está jogando o quê tudo passa por comando e botão.

| Arquivo | Responsabilidade |
|---|---|
| `src/index.js` | Recebe as interações, roteia e roda o cron |
| `src/discord.js` | Assinatura Ed25519 e chamadas REST |
| `src/comandos.js` | Slash commands |
| `src/componentes.js` | Botões |
| `src/jogos.js` | Cadastro de jogos e painel de cargos |
| `src/grupos.js` | Card, expiração, remoção e thread |
| `src/fila.js` | Fila assíncrona e DMs |
| `schema.sql` | Tabelas do D1 |
| `migracoes/` | Alterações de schema em banco já no ar |

**Tabelas:** `jogos` (cadastro), `grupos` + `grupo_membros` (cards abertos),
`fila` (o `/avisar`), `config` (onde o painel foi publicado).

Dois detalhes que explicam decisões do código:

- **O `/grupo` responde na hora, sem "pensando...".** Editar uma mensagem no
  Discord não dispara notificação se o card fosse montado por edição, o ping do
  cargo não avisaria ninguém e a mecânica 1 morreria.
- **O id da mensagem é buscado com retentativa.** O Discord cria a mensagem da
  resposta um instante depois de receber o corpo; perguntar de primeira pega 404
  de vez em quando. Sem esse id salvo, o cron não conseguiria expirar nem apagar
  o card, e a falha seria silenciosa.

O cron roda a cada 5 minutos: expira grupos vencidos, apaga cards mortos cuja
carência acabou e limpa a fila.
