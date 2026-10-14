# CoverBatch Studio

Ferramenta local para compor capas em lote com PNGs transparentes, modelos reutilizáveis e um arquivo por produto. Interface em português, Node.js 24 e Sharp. Funciona com arquivos soltos ou um pacote de capas e catálogo. Não depende de plataforma de comércio eletrônico.

## Instalar no Windows

1. Instale **Node.js 24 (64 bits)** do [site oficial](https://nodejs.org/). Confira `node --version`: deve começar com `v24`.
2. Extraia o código para uma pasta sua. Abra o PowerShell nessa pasta.
3. Execute:

```powershell
npm ci
npm start
```

Abra **http://127.0.0.1:4317**. Para as próximas execuções, use `iniciar.cmd` ou `npm start`. Encerre com Ctrl+C. Se a porta estiver ocupada:

```powershell
$env:PORT = '4318'
npm start
```

Nesse caso, abra a porta escolhida manualmente. O arquivo `iniciar.cmd` usa a porta padrão. A instalação baixa dependências do npm; depois disso o processamento funciona sem internet.

## Fluxo

1. **Importar:** escolha/arraste um ZIP, várias capas ou um catálogo JSON/CSV junto das imagens. Para adicionar imagens a um catálogo já importado, importe os arquivos depois. Os originais são copiados, nunca alterados.
2. **Carregar PNGs:** forneça a faixa, a logo e outras camadas originais, preferencialmente com fundo transparente. PNGs inteiramente opacos são recusados por padrão. Para usar um PNG com fundo, ative **Aceitar PNG opaco mantendo o fundo** antes do upload: o fundo será preservado integralmente, com aviso na prévia e na exportação. Nenhum fundo é removido ou redesenhado. Screenshots de referência não viram adesivos.
3. **Configurar:** crie um modelo com ＋. Defina nome, plataforma e disponibilidade; adicione ao menos duas camadas. Escolha âncora, largura proporcional, margens e opacidade. A ordem de cima para baixo define a composição; a última camada fica sobre as anteriores. Duplique modelos para outros PNGs/plataformas.
4. **Aplicar:** selecione produtos e confirme a disponibilidade. Aplique aos selecionados compatíveis, a todos da plataforma ou ao produto atual. Produtos de outra plataforma são ignorados. O conteúdo escrito no PNG não é interpretado: escolha a faixa correta para o modelo.
5. **Revisar:** clique em cada produto; compare original e resultado e use o zoom. Em **Só este produto**, troque/aprove a base, confirme a disponibilidade ou ajuste enquadramento e camadas individualmente. Marque **Conferi esta prévia e posso exportar**. Qualquer mudança na base, composição ou modelo exige nova revisão.
6. **Exportar:** escolha JPEG (qualidade 85–100, padrão 94) ou PNG sem perdas. O limite em KB é opcional. O JPEG pode reduzir até a qualidade mínima configurada; dimensões não são reduzidas silenciosamente para atingir o limite. Itens inviáveis ficam pendentes. Baixe uma imagem ou o ZIP. Corrija falhas e use **Repetir apenas falhas e pendentes** para gerar um novo ZIP contendo só esses itens.

O ZIP contém `slug--ID.jpg`/`.png`, `export-manifest.csv`, `export-manifest.json` e orientações. Nomes repetidos recebem sufixos sem sobrescrever arquivos. O índice preserva ID, slug, plataforma, modelo, disponibilidade, origem e hash da base, dimensões, qualidade e hash do resultado. Ele não é um arquivo de importação de catálogo.

**Extraia o ZIP e envie as imagens aos produtos indicados. Uma loja não deve ser presumida capaz de receber o ZIP e distribuir imagens automaticamente.**

## Proporção e resolução

O padrão preserva a proporção e resolução da base. 4:5, 3:4, quadrado e dimensões personalizadas são escolhas explícitas. **Arte inteira + preenchimento** mantém a arte sem esticar, com a cor escolhida visível na prévia. **Recorte explícito** oferece foco horizontal/vertical e exige confirmação individual. A base não é ampliada; recortes com dimensões maiores que o conteúdo disponível ficam pendentes. Um quadro maior com preenchimento pode conter a arte no tamanho nativo. Não há promessa de ganho de qualidade.

Prévia e exportação passam pelo mesmo compositor e encoder. A prévia informa as dimensões reais da saída, tamanho codificado e qualidade. JPEG achata transparência na cor escolhida; PNG preserva a transparência da composição quando a base/quadro a contiver. Opacidade multiplica o canal alpha do PNG. Um adesivo opaco cobre a arte com o próprio fundo; para cantos transparentes, forneça o PNG exportado com transparência. A opção de preservar fundos opacos acompanha os PNGs no pacote portátil de modelos.

## Pacote reconhecido

```text
catalogo.json (ou catalogo.csv)
capas-limpas-manifesto.json
capas-limpas-da-previa/
fotos-publicadas/
referencias/
```

O manifesto associa `arquivo`, `produtos_slugs`, `origem` e `sha256`. Havendo associação e hash correto, a capa da prévia é preferida. Essas capas são **prévia local**, não fotos publicadas. Um arquivo pode atender mais de um produto. Divergências de hash geram aviso e impedem a aprovação automática. Nenhum produto sem imagem recebe arte inventada ou atribuída por semelhança de nome.

Fotos em `fotos-publicadas/` aguardam aprovação individual, pois podem já ter textos e logotipos incorporados. Antes da aprovação, a prévia mostra apenas o original. `referencias/` fica fora dos produtos. Arquivos de orientação são dados, nunca comandos executados pela ferramenta.

Catálogo JSON mínimo:

```json
[
  { "id": "101", "slug": "jogo-demo-ps4", "nome": "Jogo demo PS4", "plataforma": "PS4", "imagens": [{ "arquivo": "fotos-publicadas/jogo-demo-ps4/01.jpg" }] },
  { "id": "102", "slug": "jogo-demo-ps5", "nome": "Jogo demo PS5", "plataforma": "PS5", "imagens": [] }
]
```

CSV aceita delimitador `;` ou `,`, cabeçalhos `id` (ou `id_produto`), `slug`, `nome`, `plataforma` e `arquivo` (ou `foto_principal_publicada`). Para capas da prévia, importe também o manifesto; `capa_limpa_previa` isolado não substitui a associação validada no manifesto. Imagens soltas recebem ID local único. Em **Identificação do produto**, defina o ID/slug/plataforma reais. A mesma imagem solta pode ser escolhida como base de produtos diferentes já presentes no catálogo.

## Dados privados e portabilidade

Tudo é salvo em **`.local-data/`** ao lado do código: originais copiados por hash, catálogo, modelos, preferências e exportações. Faça backup dessa pasta para preservar o projeto completo. Não a adicione ao Git. `work/`, `outputs/`, `.local-data/`, imagens e ZIPs são ignorados pelo versionamento. O repositório deve conter apenas código, documentação e testes sintéticos.

**Exportar modelos** gera um ZIP com `templates.json` e os próprios PNGs referenciados. **Importar modelos** restaura as camadas em outro computador, sem depender de caminhos desta máquina. Esse ZIP pode conter marcas privadas; compartilhe-o apenas com quem você autorizar.

O servidor escuta exclusivamente `127.0.0.1`, bloqueia origens externas e não usa fontes, imagens, telemetria, APIs ou serviços de processamento remotos. Não hospeda arquivos nem cria URLs públicas. Não integra catálogo, estoque, preços ou painel de lojas. Limites locais: 600 MB por upload, ZIP de até 2 GB descompactados/12 mil entradas, 100 MB por entrada, base de até 40 MP e saída de até 16 MP.

## Verificação

```powershell
npm test
npm run validate:real -- "C:\caminho\pacote.zip"
```

Os testes sintéticos cobrem pixels de transparência/opacidade/margem, proporção, recorte, bloqueio de ampliação, nomes repetidos, IDs, associação compartilhada em PS4/PS5, arquivo inválido, isolamento de falhas, repetição de um item, ZIP e modelos portáteis. O validador real é específico para o pacote de 696 produtos desta primeira entrega: testa os 195 produtos com capa da prévia e gera uma amostra de oito produtos, com **adesivos de TESTE**. O conjunto da prévia tem apenas 600×800; duas cópias reduzidas para 450×600 e 300×400 exercitam bases de dimensões diferentes. As fotos publicadas permanecem sem adesivos até aprovação. Resultados privados ficam em `outputs/` e não devem ser publicados.

## Estrutura

`server.js`: API local e persistência. `lib/importer.js`: associação de arquivos e catálogo. `lib/render.js`: composição determinística, qualidade, nomes e lote. `lib/zip.js`: leitura limitada sem extrair caminhos do usuário. `public/`: interface sem compilação ou serviços externos. `test/`: testes Node. `package-lock.json`: versões reproduzíveis das dependências.

Limites da primeira versão: uma saída por produto, edição por controles numéricos e âncoras, sem editor gráfico completo. A confirmação de revisão é feita por produto. Não há detecção automática dos textos presentes nas fotos nem reconhecimento do texto das faixas. A fidelidade da composição final depende dos PNGs originais fornecidos pelo usuário.
