# Desenvolvimento

Como rodar, testar e empacotar o CoverBatch Studio. O que o programa faz está no [README](../README.md); as regras para quem mexe no código, em [CLAUDE.md](../CLAUDE.md).

## Rodar e testar

Requer Node.js 22 ou mais recente (o pacote do Windows leva o 24; o do Mac, o 22, que ainda roda no macOS 11).

```powershell
npm ci
npm start
npm test
```

`npm start` abre em http://127.0.0.1:4317 (ou na próxima porta livre). Opções do lançador: `--data <pasta>`, `--profile <pasta>`, `--port <n>`, `--no-browser`. Sem `--data`, os dados ficam em `.local-data/`.

Os testes criam pastas em `work/testes/` e as apagam ao terminar (`KEEP_TEST_DIRS=1` mantém, para depurar). Usam só material sintético marcado TESTE.

```powershell
npm run validate:real -- "C:\caminho\capas.zip" --logo "C:\caminho\logo.png"
```

Processa capas reais com o mesmo motor, confere que os originais ficaram intactos e que cada selo está dentro da capa, e grava uma folha de contato e um relatório em `outputs/`. Sem `--logo`, usa uma logo marcada TESTE.

## Pacotes

```powershell
npm run package:windows
npm run verify:windows
npm run package:macos
npm run verify:macos
```

Tudo sai em `outputs/`: o instalador e o ZIP portátil do Windows, o ZIP do Mac e um `…-como-instalar-*.html` de cada sistema para enviar junto com o link de download. As pastas de montagem ficam em `work/builds/` (só a última de cada tipo).

**Windows.** `package:windows` baixa o Node.js oficial fixado por versão e SHA-256 em `packaging/windows.json` e gera o ZIP portátil e o `Instalar-*.exe`. O `.exe` do programa e o instalador (fontes em `packaging/windows/`, C# 5) são compilados com o `csc.exe` que já vem no Windows (.NET Framework 4.8). O `.exe` inicia o motor sem console, abre a interface numa janela própria do Edge (modo app, perfil separado) e o programa se encerra alguns segundos depois que a última janela fecha.

`verify:windows` testa o pacote como o cliente usa, numa pasta nova e só com o runtime incluído: o `.exe` portátil (incluindo a segunda abertura), a instalação silenciosa, o programa instalado carimbando duas capas com os selos oficiais e a desinstalação. Com `-- --com-registro`, confere também os atalhos e a entrada em Configurações > Aplicativos (criados e removidos durante o teste).

**Mac.** `package:macos` roda em qualquer sistema (inclusive Windows) e monta um `.app` universal: os Node.js oficiais para Apple silicon e Intel (fixados por SHA-256 em `packaging/macos.json`), o Sharp e a libvips de cada processador, `Info.plist`, ícone `.icns` e o lançador `packaging/macos/launcher.sh`. O ZIP guarda as permissões Unix e um link para Aplicativos. O lançador escolhe o runtime do processador, tira a quarentena dos próprios arquivos depois que a pessoa autorizou o app, pede para mover o app quando ele roda translocado (aberto direto de Downloads), inicia o motor numa sessão própria e abre a janela.

`verify:macos` confere o ZIP sem um Mac (permissões, link para Aplicativos, binários Mach-O de cada processador, `Info.plist`, `.icns`, perfil) e roda o lançador de verdade no Git Bash, com substitutos para `open`, `sysctl`, `xattr` e `osascript`, contra o motor deste código. Falta só a confirmação do Gatekeeper e a janela num Mac de verdade.

**Assinatura.** Nenhum dos dois é assinado: o Windows mostra o SmartScreen e o Mac pede "Abrir Mesmo Assim" na primeira abertura. Para tirar os avisos: no Windows, assinar `Instalar-*.exe` e o `.exe` do programa com um certificado de assinatura de código (por exemplo, Azure Trusted Signing); no Mac, assinar com Developer ID e notarizar (`codesign` + `notarytool`, num Mac, com conta Apple Developer).

## Edição privada (perfil da loja)

Um perfil privado deixa o kit pronto na primeira abertura. A pasta (`perfil/`, ignorada pelo Git) contém:

- `profile.json`: `{ "version": 1, "id": "...", "title": "...", "developer": "ZIRTUNO" }`
- `kit.zip`: exportado pelo próprio programa em **Kit da loja → Exportar kit** (o `templates.zip` da versão 0.x também é aceito e convertido)
- `developer-logo.svg` (opcional)

```powershell
npm run package:windows -- --profile-dir perfil
npm run package:macos -- --profile-dir perfil
npm run verify:windows -- --private-profile
npm run verify:macos -- --private-profile
```

O kit é instalado uma única vez por `id` de perfil e vira o "original" dos botões Restaurar; atualizações preservam os ajustes do cliente. Nunca publique o perfil nem os pacotes privados.

## Estrutura

| Pasta ou arquivo | O que tem |
| --- | --- |
| `server.js` | API local e segurança |
| `lib/sticker.js` | selo vetorial com os logotipos oficiais (`assets/marks`) e o texto em curvas (opentype.js + Open Sans, em `assets/fonts`) |
| `lib/layout.js` | geometria para qualquer tamanho de capa; logo dimensionada pela área |
| `lib/compose.js` | compositor único de prévias, miniaturas, amostras da logo e arquivos finais |
| `lib/detect.js` | plataforma pelo nome e detecção de selo PS4 ou PS5 já aplicado |
| `lib/batch.js` | lotes: leitura de ZIP e pastas, fila, nomes, frases por plataforma, ZIP final |
| `lib/kit.js`, `lib/profile.js` | kit da loja, original para restaurar, migrações e perfil privado |
| `public/` | interface sem etapa de build (`app.js`, `js/*`, fonte Archivo local) |
| `scripts/` | lançador do motor, pacotes de Windows e Mac e suas verificações, validação com capas reais |
| `packaging/` | lançadores (C# e bash) e o guia ilustrado `como-instalar.html` |
| `assets/` | fontes, logotipos PS4/PS5 e o ícone (`icon*.svg`; `icon-macos*` no grid da Apple; `*-small` abaixo de 48 px) |
| `test/` | testes (`node --test`) |
| `docs/` | esta página, botões de download e capturas de tela do README |

Pastas locais, fora do Git: `work/` (rascunho: dados da prévia, downloads, montagem dos pacotes), `outputs/` (pacotes prontos), `perfil/` (perfil privado), `.local-data/` (dados do `npm start`).

Os dados do programa ficam em `.local-data/` (código), `dados-locais/` (pacote do Windows) ou `~/Library/Application Support/<nome>/dados` (Mac): `kit.json`, `kit/` (com `kit/original/`) e `batches/` (originais copiados, imagens prontas e miniaturas de cada lote).
