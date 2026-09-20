# Memórias em Família — v1.8.0

Site/PWA responsivo para organizar fotos pessoais e familiares com visual profissional.

## O que já funciona

- Capas visuais para os álbuns, com capa dinâmica para álbuns com fotos e capa estilizada para álbuns vazios
- Banner principal na página inicial com destaque visual para fotos recentes e atalhos rápidos
- Melhoria visual premium com layout mais elegante, cartões refinados, hero aprimorado e interface mais moderna
- Upload múltiplo de imagens pela galeria, câmera ou arrastar/soltar
- Aceita JPG/JPEG/JFIF, PNG, WebP, AVIF, GIF, BMP e armazena HEIC/HEIF quando selecionados pelo navegador
- Geração de miniaturas leves para a galeria
- Progresso de processamento durante o envio
- Editor integrado: corte, giro, espelhamento, brilho, contraste, saturação e preto e branco
- Preenchimento inteligente ao converter foto horizontal em vertical (e vice-versa), com fundo desfocado, fundo neutro, recorte ou ampliação das bordas
- Conversão horizontal ↔ vertical com preenchimento sem cortar a foto principal
- Modos de preenchimento: fundo desfocado, recorte para preencher ou fundo neutro
- Controle da intensidade do desfoque e posicionamento da foto no novo quadro
- Edição não destrutiva: salva uma nova cópia e preserva a original
- Armazenamento local em IndexedDB
- Álbuns
- Favoritos
- Busca por nome, álbum e tags
- Ordenação
- Lixeira com restauração/exclusão definitiva
- Visualização em tela cheia com navegação
- Download do arquivo original
- Tema claro/escuro
- PWA instalável
- Layout responsivo para PC e celular
- Rádio online integrado com mini player persistente enquanto você navega nas fotos
- Busca de rádios brasileiras, play/pause, anterior/próxima, volume e player recolhível
- Última estação e volume lembrados neste dispositivo
- Opção para adicionar manualmente um stream HTTPS
- Exportação de metadados em JSON


## Fotos incluídas nesta versão

- 70 fotos WebP incorporadas ao projeto
- Álbum automático **Fotos da Família**
- 70 miniaturas WebP separadas para acelerar a galeria
- As fotos originais ficam em `assets/family-photos/lote-*`
- A galeria registra apenas os metadados no IndexedDB; os arquivos incluídos não são duplicados no banco do navegador
- Fotos incluídas continuam compatíveis com favoritos, lixeira, download e editor

## Importante sobre privacidade

A versão entregue usa **IndexedDB**, portanto as fotos ficam salvas apenas no navegador/dispositivo onde foram adicionadas. É ótimo para testar e usar localmente, mas **não sincroniza automaticamente entre celulares e computadores**.

Para uma família acessar de vários aparelhos, use um backend privado com autenticação e armazenamento de objetos (por exemplo Supabase, Firebase, Cloudflare R2 + backend próprio ou outro serviço semelhante). Não publique fotos familiares diretamente dentro do repositório do GitHub Pages.

## Publicar no GitHub Pages

1. Crie um repositório.
2. Envie todos os arquivos da raiz deste projeto.
3. Em Settings > Pages, publique a branch principal pela raiz (`/`).
4. Abra o endereço gerado pelo GitHub Pages.

## Observação sobre HEIC/HEIF

O site permite selecionar e armazenar HEIC/HEIF quando o navegador entrega esses arquivos, mas a visualização e a edição dependem do suporte nativo do navegador. Se o aparelho não conseguir decodificar o formato, a foto continua armazenada e disponível para download, porém aparece sem miniatura.

## Próxima evolução recomendada

A versão cloud deve ter login individual para cada familiar, convite por e-mail, grupos/famílias, bucket privado, permissões por álbum, miniaturas otimizadas, backup e sincronização entre dispositivos.

## Rádio online

A lista de estações é consultada pelo diretório público Radio Browser em tempo de execução. O áudio vem diretamente da URL informada por cada emissora; por isso uma estação específica pode ficar temporariamente indisponível. Em GitHub Pages, prefira streams HTTPS.
