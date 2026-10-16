# CoverBatch Studio — notas para agentes

Ferramenta local (Windows e macOS, Node 22 ou mais novo) que carimba capas de jogos para uma
loja Yampi: o cliente solta um ZIP, uma pasta ou imagens e recebe cada capa com o **selo**
(logotipo oficial PS4/PS5 + frase) no canto inferior esquerdo e a **logo da loja** no canto
inferior direito. A interface é em português do Brasil; o código e os comentários, em inglês.
O README descreve o produto; `docs/DESENVOLVIMENTO.md`, como rodar, testar e empacotar; este arquivo,
o que um agente precisa para mexer no código.

## Comandos

- `npm ci` · `npm start` (flags do lançador: `--data <pasta> --profile <pasta> --port <n> --no-browser`) · `npm test`
  (pastas de teste em `work/testes`, apagadas no fim; `KEEP_TEST_DIRS=1` mantém)
- `npm run validate:real -- <zip-ou-pasta> [--logo arquivo] [--formato 4x5] [--encaixe contain]`: motor real + folha de contato em `outputs/`
- `npm run package:windows [-- --profile-dir perfil]` → ZIP portátil + `Instalar-*.exe` + guia HTML em `outputs/`
- `npm run verify:windows [-- --private-profile] [--com-registro]` (Windows x64; instala e desinstala numa pasta de teste)
- `npm run package:macos [-- --profile-dir perfil]` → `.app` universal num ZIP (roda no Windows).
  Montagem em `work/builds/` (só a última de cada tipo); `work/` guarda também `dev-data`, `downloads`, `npm-cache`.
- `npm run verify:macos [-- --private-profile]`: estrutura do ZIP + lançador bash real no Git Bash com stubs
- Prévia no navegador: configuração `coverbatch-dev` em `.claude/launch.json` (dados em `work/dev-data`).
  Testes automáticos de interface: na configuração `coverbatch-teste` (porta 4391, `work/ui-teste`), não na
  do usuário, com capas sintéticas TESTE enviadas pela API. O usuário costuma mexer na aba da prévia:
  automatize numa aba própria. Playwright (Chromium e WebKit) fica no scratchpad, nunca nas dependências.

## Arquitetura

- `server.js`: API local (Express 5), middleware de segurança, SSE em `/api/batches/:id/events`.
- `lib/sticker.js`: selo em SVG com os logotipos oficiais de `assets/marks/ps4.svg|ps5.svg` (SVG
  aninhado) e texto em curvas (opentype.js + Open Sans). Nunca usar `<text>`. Esquemas por parte
  (`block`, `mark`, `body`, `text`): PS4 bloco azul/pílula branca; PS5 bloco branco/pílula preta.
- `lib/layout.js`: geometria em unidades da capa de referência 1200 × 1500; escala pela raiz da
  razão de áreas, limitada para caber. Logo dimensionada pela área contra a da referência (164 × 61).
  Na referência o resultado é exato (selo 70,1349,655×96; logo da Kabban a 1px).
- `lib/framing.js`: formatos da imagem (`original` e os fixos 4x5, 1x1, 3x4, 2x3, 16x9, 9x16; `store`
  da v1.1 vira `4x5`) e a posição da arte no quadro (`placeArt`): zoom 1 preenche, o menor zoom mostra a
  arte inteira, `x`/`y` funcionam como `object-position`. Sem dependências: o servidor o entrega ao
  navegador como `/js/framing.js`, e o editor de enquadramento usa as mesmas contas do arquivo final.
- `lib/compose.js`: compositor único (prévia, miniatura, amostra da logo e arquivo final). Sombra
  suave da logo só onde a capa é clara. Formatos fixos recortam pelo enquadramento; onde a arte não
  chega, fundo desfocado feito da própria arte. `sourcePreview` dá a arte inteira ao editor.
- `lib/detect.js`: plataforma por nome > pasta > nome do ZIP; detecção de selo já aplicado (NCC, PS4 e PS5).
- `lib/batch.js`: lotes em `batches/<id>/{batch.json,in/,out/,thumbs/}`; fila com concorrência;
  nomes atribuídos na ordem do lote; frase por plataforma (`item.labels`); formato da capa > lote > kit
  (`item.format`) e encaixe do lote > kit (`item.fit`); enquadramento à mão por capa e por formato
  (`item.frames`); `item.rendered` guarda formato e enquadramento do arquivo e decide se refaz;
  `reset` no lote e na capa.
- `lib/kit.js`: kit (`kit.json` + `kit/`), `kit/original/` (alvo dos botões Restaurar; vem do perfil
  ou de fábrica), `changes()` por seção, migração da v0.x e da 1.0. `lib/profile.js`: perfil privado,
  semeado uma vez por `id`.
- `public/`: módulos ES sem build. `app.js` (rotas `#/` e `#/lote/<id>`), `js/*` (telas; `help.js`
  é a ajuda, tecla `?`; `framer.js` é o editor de enquadramento, aberto no lugar da comparação da
  capa; `formats.js`, os controles de formato). Plataforma do usuário via `IS_MAC` (atalhos ⌘/Ctrl,
  Finder/Explorador).
- `packaging/windows/*.cs`: lançador e instalador em C# 5, compilados por `scripts/windows-exe.js`
  com o `csc.exe` do .NET Framework 4.8. Motor oculto com `COVERBATCH_LIFETIME=window` (encerra ~8 s
  após a última janela, via `/api/presence`, ou quando o stdin em pipe fecha). Ao testar pelo Git
  Bash, argumentos que começam com `/` viram caminhos: use PowerShell ou Node.
- `packaging/macos/launcher.sh` (executável do `.app`) + `scripts/macos-app.js` (tar, `.icns`,
  `Info.plist`, Mach-O, ZIP com modos Unix). Node 22 LTS no Mac (roda no macOS 11; o 24 exige 13.5).
  O motor se desliga do script com `COVERBATCH_DETACH=1` (setsid); dados em `~/Library/Application Support/<nome>`.
- `scripts/package-common.js`: arquivos do app, cópia do perfil (lista fechada), download com
  SHA-256 fixo e o guia `packaging/como-instalar.html` (placeholders `__NAME__` etc.).

## Invariantes

- Originais nunca são alterados; saídas são regeneradas a partir deles.
- Enquadramentos são trabalho manual: "Desfazer escolhas" do lote não os apaga (só "Desfazer ajustes
  desta capa"), e mudar o formato guarda o enquadramento do formato anterior para quando ele voltar.
- `lib/framing.js` roda também no navegador: nada de `node:*`, `sharp` ou outra dependência nele.
- Servidor só em 127.0.0.1; checagem de Host/Origin; token por sessão em toda requisição que
  altera estado; CSP sem recursos externos. Sem rede em tempo de execução.
- Nomes vindos de ZIP/pastas são dados de exibição e pistas, nunca caminhos no disco.
- Nunca versionar capas, logos ou kits de clientes (`.gitignore` cobre imagens, ZIPs e `perfil/`).
  Testes e validações usam material sintético marcado TESTE. Capturas em `docs/` também: nunca a capa
  do FC 27 nem a marca Kabban (`!docs/*.png` libera só essa pasta).
- Rodar `npm test` depois de qualquer edição, inclusive "cosméticas" (um sombreamento de variável
  em `layout.js` já moveu a logo para o topo sem ninguém notar até a folha de contato).
- Novas dependências passam pelo AgentAvow antes de entrar.
- Arquivo novo na raiz do pacote do Windows entra também em `Uninstaller.Files` (`Launcher.cs`), ou
  a desinstalação deixa a pasta para trás.
- Diálogos modais deixam o resto da página inerte: toasts vão para o diálogo aberto mais acima, e
  diálogos se redesenham com `fill()` (preserva a região de toasts e devolve o foco do teclado ao
  mesmo controle). Filhos condicionais nunca em `replaceChildren` (imprime "false"/"null"): use `h()` ou `put()`.
- Checagem de "script principal" compara caminhos reais (`realpathSync`): o app pode estar atrás de
  link ou junção. Pipe no stdin: bits de modo, não `isFIFO()` (no Windows falta a constante).
- `verify:macos` liga o projeto por junção: remover as junções antes de apagar a pasta de teste.

## Design da interface

Uma única peça ousada: o próprio selo (pílula branca, bloco azul inclinado 12°) vira a área de
soltar e o botão principal. O resto é papel, tinta e o cinza das capas. Uma família (Archivo,
eixo de largura como recurso expressivo); Open Sans só dentro do selo gigante. Evitar rótulos em
caixa alta, pontos médios em metadados, fontes mono para dados e setas em botões. O ícone mostra
uma capa com o selo em corte (borda branca) sobre placa azul; abaixo de 48 px, só o selo.
