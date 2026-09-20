# Evolução opcional para nuvem privada

A v2.0 já protege o acervo estático com criptografia local. Para sincronização entre vários usuários/dispositivos, a evolução recomendada é adicionar autenticação de servidor e armazenamento privado.

## Arquitetura sugerida

- Frontend: este PWA/GitHub Pages.
- Autenticação: Supabase Auth, Firebase Auth ou backend próprio.
- Banco: metadados de famílias, membros, álbuns e permissões.
- Storage privado: bucket sem leitura pública.
- URLs de fotos: temporárias/assinadas.
- Convites: usuário administrador convida membros da família.
- Auditoria: registro de uploads, exclusões e compartilhamentos.

Mesmo com backend, não coloque senhas de usuário em JavaScript. O frontend deve receber apenas tokens temporários de sessão emitidos pelo provedor de autenticação.
