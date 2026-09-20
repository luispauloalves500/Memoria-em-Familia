# Memórias em Família — v2.0.0 Secure

Galeria/PWA privada para organizar, editar e rever fotos da família. Esta versão transforma o projeto em um **cofre criptografado** e mantém o álbum de casamento com 70 fotos.

## Segurança

- Senha **não fica gravada** no HTML, JavaScript, `localStorage`, manifesto ou repositório.
- PBKDF2-SHA256 com 350.000 iterações para derivação de chave.
- AES-256-GCM para as fotos e miniaturas do casamento.
- As 70 fotos públicas do projeto foram removidas e substituídas por arquivos `.bin` criptografados.
- Fotos adicionadas pelo navegador também são criptografadas antes de irem para o IndexedDB.
- Bloqueio manual e bloqueio automático por inatividade.
- Política CSP restringindo scripts e conteúdo ativo.
- Consulte `SECURITY.md` para detalhes e troca de senha.

## Galeria e casamento

- 70 fotos no álbum **Casamento**.
- Miniaturas reais e leves (as originais só são descriptografadas quando necessário).
- Banner/carrossel automático na home.
- Banner interno do álbum.
- Capa manual com posição, zoom e slideshow automático.
- Grade e modo **Timeline**.
- Categorias do casamento: Preparativos, Cerimônia, Noivos, Família, Convidados, Festa e Detalhes.
- Favoritos, busca, ordenação e lixeira.
- Seleção múltipla para favoritar, mover ou excluir várias fotos.
- Renomear álbum, editar descrição, mover fotos e excluir álbuns criados pelo usuário.

## Visualização e compartilhamento

- Lightbox em tela cheia.
- Slideshow com velocidade configurável e efeito de zoom suave/fade.
- Gestos de swipe no celular.
- Pinça e duplo toque para zoom.
- Informações da foto: arquivo, álbum, resolução, tamanho, formato e data.
- Compartilhamento de arquivo usando Web Share quando o navegador oferecer suporte.

## Editor

- Recorte e proporções 1:1, 4:3, 16:9, 4:5, 3:4 e 9:16.
- Girar e espelhar.
- Preenchimento desfocado, neutro ou ampliação visual das bordas.
- Brilho, contraste, saturação e preto e branco.
- **Auto melhorar**.
- Redução de ruído.
- Nitidez.
- Temperatura de cor.
- Upscale de saída 2×.
- Edição não destrutiva: salva uma nova cópia e preserva a original.

## Backup

- Exportação de backup criptografado em JSON.
- Inclui álbuns, favoritos, configurações das fotos e cópias criptografadas das imagens locais.
- O backup das fotos do casamento pode incluir também os bytes criptografados do cofre.
- Restauração pelo menu Configurações.

## Rádio

- Mini player persistente enquanto navega pelas fotos.
- Busca de rádios brasileiras por diretório público.
- Volume, play/pause, anterior/próxima e URL manual HTTPS.
- O Service Worker não intercepta nem armazena streams externos de rádio.

## PWA e desempenho

- Instalável como aplicativo.
- Ícones próprios em vários tamanhos.
- Atalhos de Fotos, Álbuns e Favoritos.
- Service Worker separado por app shell e mídia criptografada.
- Sem fallback incorreto de `index.html` para imagens ou JavaScript.
- Streams e APIs externas não entram no cache do PWA.

## GitHub Pages

Envie o conteúdo desta pasta para o repositório e habilite **Settings > Pages**. O GitHub Pages continuará sendo uma hospedagem estática; a proteção das fotos nesta versão vem da criptografia do próprio arquivo, não de uma senha escondida em JavaScript.

**Importante:** não adicione novamente as fotos originais em uma pasta pública do repositório. Use somente `assets/vault/` para o acervo incluído.
