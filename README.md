# CoverBatch Studio

Carimba capas de jogos para a loja virtual. Você solta um ZIP, uma pasta ou imagens; cada capa sai com o **selo da plataforma** (os logotipos oficiais PS4 ou PS5 + "ENVIO IMEDIATO", "ACESSO IMEDIATO" ou "PRÉ-VENDA") no canto inferior esquerdo e a **logo da loja** no canto inferior direito, sempre na mesma posição e proporção. Tudo roda no próprio computador, sem internet e sem conta. Funciona no Windows e no Mac.

## Baixar e usar no Windows

[![Baixar para Windows 64 bits](docs/download-windows.svg)](https://github.com/ZIRTUNO/coverbatch-studio/releases/latest/download/Instalar-CoverBatch-Studio.exe)

1. **Baixe o instalador** pelo botão acima ou pela [página de releases](https://github.com/ZIRTUNO/coverbatch-studio/releases/latest).
2. Dê dois cliques em **Instalar-CoverBatch-Studio.exe** e clique em **Instalar**. Não pede senha de administrador: a instalação é só para o usuário atual.
3. Abra pelo atalho **CoverBatch Studio** (Área de Trabalho ou menu Iniciar). O programa abre na própria janela; fechar a janela encerra o programa.

O instalador traz o Node.js 24 e as dependências: não é preciso instalar mais nada. Windows 10/11 de 64 bits. Atualizar é rodar o instalador da nova versão (lotes e kit são mantidos); remover é em Configurações > Aplicativos. Sem instalar: extraia `CoverBatch-Studio-Windows-x64.zip` e abra **CoverBatch Studio.exe**.

O instalador ainda não tem assinatura digital, então o Windows mostra "O Windows protegeu o computador" na primeira vez (**Mais informações** > **Executar assim mesmo**). Para tirar o aviso, assine `Instalar-*.exe` e o `.exe` do programa com um certificado de assinatura de código (por exemplo, Azure Trusted Signing) antes de publicar.

## Baixar e usar no Mac

1. Baixe **CoverBatch-Studio-macOS.zip** na [página de releases](https://github.com/ZIRTUNO/coverbatch-studio/releases/latest) e dê dois cliques nele.
2. Arraste o **CoverBatch Studio** para o atalho **Aplicativos** que vem ao lado.
3. Abra pela pasta Aplicativos. Na primeira vez o Mac pede uma confirmação, porque o app não é assinado pela Apple: no macOS 15 ou mais novo, em **Ajustes do Sistema > Privacidade e Segurança > Abrir Mesmo Assim**; do macOS 11 ao 14, com **clique direito > Abrir**.

Um único app para chip Apple e Intel, macOS 11 (Big Sur) ou mais novo; traz o Node.js 22 LTS para os dois processadores. A interface abre numa janela própria do Google Chrome ou do Microsoft Edge, se houver um deles; senão, no Safari. Os dados ficam em `~/Library/Application Support/CoverBatch Studio`. Atualizar é arrastar a versão nova para Aplicativos e escolher Substituir; remover é arrastar o app para o Lixo.

Para tirar a confirmação da primeira abertura, o app precisa de uma conta Apple Developer: assinar com Developer ID e notarizar (`codesign` + `notarytool`, num Mac).

Cada pacote, de Windows e de Mac, traz **Como instalar.html**: o passo a passo com desenhos das telas de cada sistema. Uma cópia avulsa sai em `outputs/` para enviar junto com o link de download. O texto para o dia a dia está em [packaging/LEIA-ME.txt](packaging/LEIA-ME.txt) (Windows) e [packaging/LEIA-ME-macOS.txt](packaging/LEIA-ME-macOS.txt).

## Como funciona

1. **Solte as capas** em qualquer lugar da janela: um ZIP, uma pasta (com subpastas) ou várias imagens. Também dá para colar uma imagem com Ctrl+V (Cmd+V no Mac). JPEG, PNG, WebP, AVIF, GIF e TIFF são aceitos; o resto é ignorado e listado.
2. **As capas são carimbadas na hora**, uma a uma, e aparecem na tela conforme ficam prontas.
3. **Baixe o ZIP** ou **abra a pasta** com as imagens prontas, já com nomes limpos (`ea-sports-fc-27-ps4.jpg`), prontas para enviar ao produto.

A plataforma vem do nome:

| Onde aparece | Exemplo | Resultado |
| --- | --- | --- |
| Nome do arquivo | `FC 27 (PS4).png`, `gta-ps4-ps5.jpg` | PS4; PS4 e PS5 |
| Pasta | `PS5/god-of-war.jpg` | PS5 |
| Nome do ZIP | `capas-ps5.zip` | PS5 para as capas sem indicação |
| Nenhum | `corrida.jpg` | padrão do kit (PS4), com aviso e troca em um clique |

Na tela do lote, cada capa tem os botões PS4/PS5 para ligar ou desligar aquela imagem, e o lote inteiro pode ser trocado de uma vez: plataforma e frase (padrão do kit, Envio imediato, Acesso imediato ou Pré-venda). Clicar numa capa abre a comparação antes/depois em tamanho real, com a escolha de frase só para ela. **Desfazer escolhas** (no lote) e **Desfazer ajustes desta capa** voltam ao automático.

O programa avisa quando uma capa **parece já ter o selo** (PS4 ou PS5, comparando com o próprio desenho do selo, mesmo deslocado ou reduzido), quando a **resolução é baixa** e quando um arquivo **não abre**. Uma falha nunca interrompe o lote.

O botão **Ajuda** (ou a tecla `?`) explica cada função com os termos do sistema em uso (Finder ou Explorador, Cmd ou Ctrl) e abre a pasta dos dados. Na primeira visita, a tela inicial mostra os três passos.

## Kit da loja

Tudo o que a loja define uma vez fica no **Kit da loja** (botão no topo):

- **Logo**: PNG ou SVG com fundo transparente. A área transparente em volta é ignorada, então a posição é medida no que aparece. Ela é dimensionada pela área, com a logo da referência como medida: uma logo larga ou quadrada ganha o mesmo peso visual. Em capas claras ganha uma sombra suave, para a logo branca não sumir (pode ser desligada). O painel mostra a logo numa capa escura e numa clara, desenhadas pelo próprio compositor.
- **Selo**: os logotipos oficiais PS4 e PS5 em vetor e o texto em Open Sans convertido em curvas, nítido em qualquer tamanho de capa. PS4: bloco azul e pílula branca; PS5: bloco branco e pílula preta. Três frases editáveis (envio imediato, acesso imediato, pré-venda), cores próprias por parte (bloco, logotipo, fundo, texto) com volta às oficiais, ou uma imagem própria (PNG) no lugar do desenho. O catálogo mostra os seis selos.
- **Posição e tamanho**: medidas da capa de referência 1200 × 1500 (selo de 655 × 96 a 70 px da esquerda e 55 px de baixo; logo a 39 px da direita, centralizada na altura do selo). Em capas de outros tamanhos e proporções, o tamanho segue a raiz da área da capa, com limites para nada sair da imagem nem encostar um no outro.
- **Imagens finais**: a frase padrão de cada plataforma, a plataforma padrão para nomes sem PS4/PS5, JPEG (qualidade 92, cores 4:4:4) ou PNG, tamanho original ou 1200 × 1500 com recorte inteligente.
- **Restaurar**: cada parte alterada ganha **Restaurar original**, e **Restaurar tudo** volta ao kit que veio instalado (o do perfil privado, ou o de fábrica). Logo depois de restaurar, **Desfazer** traz as alterações de volta.
- **Exportar/importar kit**: leva logo, selos e medidas para outro computador. O ZIP contém a marca da loja: compartilhe só com quem vai usar.

Mudou o kit depois de carimbar? O lote avisa e oferece **Aplicar o kit atual**.

## Edição privada (perfil da loja)

Um perfil privado deixa o kit pronto na primeira abertura. A pasta contém:

- `profile.json`: `{ "version": 1, "id": "...", "title": "...", "developer": "ZIRTUNO" }`
- `kit.zip`: exportado pelo próprio programa em **Kit da loja → Exportar kit** (o `templates.zip` da versão 0.x também é aceito e convertido)
- `developer-logo.svg` (opcional)

Gere os pacotes com `npm run package:windows -- --profile-dir perfil` e `npm run package:macos -- --profile-dir perfil`: saem `Instalar-Criador-de-capas-Kabban-PRIVADO.exe`, `Criador-de-capas-Kabban-macOS-PRIVADO.zip` e os ZIPs equivalentes. O kit é instalado uma única vez por `id` de perfil, e esse kit vira o "original" dos botões de restaurar; atualizações preservam os ajustes do cliente. A pasta `perfil/` é ignorada pelo Git. Nunca publique o perfil nem os pacotes privados.

## Desenvolvimento

Requer Node.js 22 ou mais recente (o pacote do Windows leva o 24; o do Mac, o 22, que ainda roda no macOS 11).

```powershell
npm ci
npm start
```

Abre em http://127.0.0.1:4317 (ou na próxima porta livre). Opções do lançador: `--data <pasta>`, `--profile <pasta>`, `--port <n>`, `--no-browser`.

```powershell
npm test
npm run validate:real -- "C:\caminho\capas.zip" --logo "C:\caminho\logo.png"
npm run package:windows
npm run verify:windows
npm run package:macos
npm run verify:macos
```

`validate:real` processa capas reais com o mesmo motor, confere que os originais ficaram intactos e que cada selo está dentro da capa, e grava uma folha de contato e um relatório em `outputs/` (sem `--logo`, usa uma logo marcada TESTE).

`package:windows` baixa o runtime oficial do Node fixado por versão e SHA-256 em `packaging/windows.json` e gera o ZIP portátil e o instalador. O `.exe` do programa e o instalador (fontes em `packaging/windows/`, C# 5) são compilados com o `csc.exe` que já vem no Windows (.NET Framework 4.8): sem SDK nem dependência nova. O `.exe` inicia o motor sem console, abre a interface numa janela própria do Edge (modo app, perfil separado) e o programa se encerra alguns segundos depois que a última janela fecha.

`verify:windows` testa o pacote como o cliente usa, numa pasta nova e só com o runtime incluído: o `.exe` portátil (incluindo a segunda abertura), a instalação silenciosa, o programa instalado carimbando duas capas com os selos oficiais e a desinstalação. Com `-- --com-registro`, confere também os atalhos e a entrada em Configurações > Aplicativos (criados e removidos durante o teste).

`package:macos` roda em qualquer sistema (inclusive Windows) e monta um `.app` universal: os Node.js oficiais para Apple silicon e Intel (fixados por SHA-256 em `packaging/macos.json`), o Sharp e a libvips de cada processador, `Info.plist`, ícone `.icns` e o lançador `packaging/macos/launcher.sh`. O ZIP guarda as permissões Unix e um link para Aplicativos. O lançador escolhe o runtime do processador, tira a quarentena dos próprios arquivos depois que a pessoa autorizou o app, pede para mover o app quando ele roda translocado (aberto direto de Downloads), inicia o motor numa sessão própria e abre a janela.

`verify:macos` confere o ZIP sem um Mac: permissões, link para Aplicativos, binários Mach-O de cada processador, `Info.plist`, `.icns`, perfil. Depois roda o lançador de verdade no Git Bash, com substitutos para `open`, `sysctl`, `xattr` e `osascript`, contra o motor deste código: primeira abertura, segunda abertura reaproveitando o motor (janela do Chrome), encerramento depois que a janela fecha, app translocado e runtime ausente. Falta só a confirmação do Gatekeeper e a janela num Mac de verdade.

## Estrutura

- `server.js`: API local e segurança.
- `lib/sticker.js`: selo vetorial com os logotipos oficiais (`assets/marks`) e o texto em curvas via opentype.js (fontes em `assets/fonts`).
- `lib/layout.js`: geometria para qualquer tamanho de capa; logo dimensionada pela área.
- `lib/compose.js`: compositor único de prévias, miniaturas, amostras da logo e arquivos finais.
- `lib/detect.js`: plataforma pelo nome e detecção de selo PS4 ou PS5 já aplicado.
- `lib/batch.js`: lotes (leitura de ZIP/pastas, fila, nomes, frases por plataforma, ZIP final).
- `lib/kit.js`, `lib/profile.js`: kit da loja, original para restaurar, migração da v0.x e perfil privado.
- `public/`: interface sem etapa de build; fonte Archivo local. `public/js/help.js` é a ajuda.
- `scripts/package-*.js`, `scripts/macos-app.js`, `scripts/windows-exe.js`: pacotes de Windows e Mac. `packaging/`: lançadores, guias e `como-instalar.html`.
- `assets/icon*.svg`: ícone (Windows e web; `icon-macos*.svg` no grid da Apple; `*-small` abaixo de 48 px).

Os dados ficam em `.local-data/` (código), `dados-locais/` (pacote do Windows) ou `~/Library/Application Support/<nome>/dados` (Mac): `kit.json`, `kit/` (com `kit/original/`) e `batches/` (originais copiados, imagens prontas e miniaturas de cada lote). Faça backup dessa pasta; ela nunca vai para o Git.

## Privacidade e segurança

O servidor escuta só em 127.0.0.1, recusa outros hosts e origens e exige um token de sessão para qualquer alteração. Não há fontes, scripts ou serviços remotos. Nomes vindos de ZIPs e pastas nunca viram caminhos no disco; SVGs com scripts ou arquivos externos são recusados. Os originais nunca são alterados.

## Atualizando de versões anteriores

Da 1.0: as cores antigas viram os esquemas oficiais (o azul do PS4 é mantido; o PS5 passa ao selo oficial preto e branco) e os lotes antigos passam a seguir a frase padrão de cada plataforma.

Da 0.x: na primeira abertura, a logo e as faixas dos modelos antigos viram o kit da loja. O selo vetorial passa a ser o padrão; as faixas antigas continuam disponíveis em **Kit da loja → Selo → Imagem própria**. O `project.json` antigo e seus arquivos não são apagados.
