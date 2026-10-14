# CoverBatch Studio — usar no Windows

1. Baixe **CoverBatch-Studio-Windows-x64.zip** na [página de download](https://github.com/JonathanDelmonte/coverbatch-studio/releases/latest).
2. Clique com o botão direito no ZIP e escolha **Extrair tudo**. Escolha uma pasta sua com permissão de gravação, como Documentos. Não execute de dentro do ZIP.
3. Dentro da pasta **CoverBatch Studio**, dê dois cliques em **Abrir CoverBatch Studio.cmd**.
4. O navegador abrirá a ferramenta. Mantenha a janela do programa aberta durante o uso. Para encerrar, feche essa janela.

O pacote já inclui Node.js 24 e as dependências. Não precisa instalar Node.js, usar terminal, criar conta ou conectar a internet para editar/exportar. Destinado a Windows 10/11 de 64 bits (x64).

## Preparar suas capas

1. **Importar:** selecione/arraste suas imagens ou o ZIP de capas e catálogo.
2. **Configurar:** carregue seus PNGs e crie os modelos. Se recebeu um ZIP de modelos, clique em **Importar modelos**: os PNGs vêm junto.
3. **Revisar:** selecione produtos, confirme plataforma/disponibilidade, aplique o modelo e confira cada prévia.
4. **Exportar:** gere e baixe o ZIP; extraia as imagens e envie cada arquivo ao produto indicado no manifesto.

A ferramenta não envia arquivos à loja, não muda produtos e não publica suas imagens. Fotos publicadas usadas como base exigem aprovação porque podem já conter adesivos.

## Seus arquivos e atualizações

Imagens copiadas, modelos, preferências e exportações ficam na pasta **dados-locais**, ao lado de **app** e **runtime**. Os arquivos originais importados permanecem intactos.

Faça backup de **dados-locais**. Para mudar de computador, feche o programa e copie a pasta completa **CoverBatch Studio**, incluindo **dados-locais**. Para enviar só os modelos e adesivos a outra pessoa, use **Exportar modelos**; o ZIP pode conter marcas privadas, então envie-o diretamente ao destinatário.

Para atualizar, encerre o programa, faça backup de **dados-locais** e extraia a nova versão na mesma pasta. O pacote de atualização não contém essa pasta e não substitui seus arquivos privados. A ferramenta não se atualiza automaticamente.

## Se não abrir

- Confira que extraiu o ZIP inteiro e que as pastas **app** e **runtime** estão ao lado do arquivo **Abrir CoverBatch Studio.cmd**.
- Use uma pasta sua, com permissão de gravação. Uma pasta de rede ou protegida pode impedir a gravação.
- A janela mostra o endereço local: copie-o para o navegador se ele não abrir automaticamente.
- Se outra aplicação ocupar a porta padrão, a ferramenta escolhe outra porta local automaticamente. Abrir o mesmo pacote novamente reabre a sessão existente.

Código e novas versões: https://github.com/JonathanDelmonte/coverbatch-studio
