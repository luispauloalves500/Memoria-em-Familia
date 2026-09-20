# Arquitetura cloud recomendada

## Objetivo
Transformar o site em um cofre familiar privado, multiusuário e sincronizado.

## Camadas

- Front-end: este projeto (HTML/CSS/JS), hospedável no GitHub Pages.
- Autenticação: login por e-mail/senha ou magic link.
- Banco: metadados de famílias, membros, álbuns e fotos.
- Storage privado: arquivos originais e thumbnails.
- Segurança: bucket privado + regras por usuário/família + links temporários assinados.

## Estrutura de dados sugerida

### families
- id
- name
- owner_id
- created_at

### family_members
- family_id
- user_id
- role: owner | editor | viewer
- created_at

### albums
- id
- family_id
- title
- description
- cover_photo_id
- created_by
- created_at

### photos
- id
- family_id
- album_id
- storage_path
- thumb_path
- filename
- mime_type
- size
- width
- height
- taken_at
- tags
- favorite
- uploaded_by
- created_at
- deleted_at

## Regras de segurança

1. O arquivo nunca deve ser público por padrão.
2. Um usuário só lê fotos da família da qual é membro.
3. Viewer não pode excluir ou substituir imagens.
4. Editor pode enviar e organizar, mas não remover a família.
5. Owner gerencia membros e permissões.
6. A lixeira deve ser lógica antes da exclusão física.
7. URLs de visualização devem expirar.
8. Nunca coloque senha, service key ou segredo dentro do JavaScript público.

## Evoluções úteis

- Convites por e-mail
- Reconhecimento e agrupamento manual de pessoas (sem exigir biometria)
- Linha do tempo por data
- Mapa opcional por localização EXIF
- Upload automático de celular
- Compressão WebP/AVIF para miniaturas mantendo original intacto
- Download de álbum em ZIP
- Comentários e reações privadas
- Compartilhamento temporário por link com expiração
- Backup externo programado
