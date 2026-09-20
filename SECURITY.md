# Segurança — Memórias em Família v2

## Como a senha é protegida

A senha **não é gravada** no HTML, JavaScript, `localStorage`, manifesto PWA ou arquivos do projeto.

O navegador usa a senha apenas em memória para derivar uma chave com **PBKDF2-SHA256 (350.000 iterações)**. Essa chave abre o cofre **AES-256-GCM**. Ao bloquear ou recarregar a página, a chave em memória é descartada e a senha precisa ser digitada novamente.

As 70 fotos do casamento e as miniaturas estão publicadas apenas como arquivos `.bin` criptografados. Abrir a URL direta de um desses arquivos não revela a foto.

## O que continua público em hospedagem estática

O código do aplicativo e o manifesto criptográfico (sal, IVs e parâmetros do KDF) podem ser vistos. Isso é normal em criptografia baseada em senha: eles **não são a senha nem a chave**. A segurança depende de uma senha forte.

O nome do álbum e alguns metadados não sensíveis permanecem no manifesto do cofre. As imagens permanecem criptografadas.

## Trocar a senha

A troca de senha exige recriptografar os arquivos do projeto. O utilitário `tools/rekey.py` faz isso sem salvar a senha em disco:

1. Instale Python e `cryptography`.
2. Na raiz do projeto, execute `python tools/rekey.py`.
3. Digite a senha atual e a nova senha quando solicitado.
4. Publique novamente os arquivos alterados de `assets/vault/manifest.json` e `assets/vault/`.

Nunca coloque a senha em README, JavaScript, variável pública do GitHub Pages ou nome de arquivo.
