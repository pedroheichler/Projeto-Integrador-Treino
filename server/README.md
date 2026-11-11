# Kronos — Servidor

Backend do Kronos em Spring Boot + PostgreSQL. Expõe a mesma API do backend que roda dentro do app Android, então a interface é a mesma: basta apontar o app para o endereço do servidor.

Com o servidor:

- squads funcionam entre celulares diferentes;
- o Kronos IA funciona (a chave da API fica só no servidor);
- os dados não se perdem se o app for desinstalado.

```
┌──────── App Android ────────┐         ┌──────────────── Servidor ────────────────┐
│ WebView (React/TypeScript)  │  HTTPS  │ ApiController                            │
│ fila offline + cópia local  │ ──────► │  ├─ /api/auth   → AuthService            │
└─────────────────────────────┘         │  ├─ /api/query  → QueryService           │
                                        │  ├─ /api/rpc/*  → RpcService (RN01–RN04) │
                                        │  ├─ /api/ai     → AiService (RN05) ──► API da Anthropic
                                        │  └─ /api/files  → FileService            │
                                        │                 PostgreSQL               │
                                        └──────────────────────────────────────────┘
```

## Requisitos

- JDK 17 ou mais recente (o projeto foi testado com o JDK 21)

Não é preciso instalar o Gradle nem o PostgreSQL para desenvolver.

## Rodar no seu computador

```bash
cd server
./gradlew bootTestRun        # Windows: gradlew.bat bootTestRun
```

Sobe o servidor em `http://localhost:8080` com um PostgreSQL embutido. Os dados ficam em `build/dev-postgres` e são mantidos entre uma execução e outra.

Para ver a interface no navegador usando esse servidor, crie na raiz do projeto o arquivo `.env.local` com a linha abaixo e rode `npm run dev` em outro terminal:

```
VITE_API_URL=http://localhost:8080/api
```

Abra `http://localhost:3005/treino/`.

Para testar as telas de IA sem chave e sem custo, suba o servidor com `KRONOS_FAKE_AI=1`: as respostas da IA passam a ser fixas, só para ver a tela funcionando.

## Testes

```bash
./gradlew test
```

São 38 testes que sobem o servidor inteiro sobre um PostgreSQL embutido e falam com ele por HTTP, como a interface faz. A API da Anthropic é trocada por um servidor falso (`FakeAnthropic`), então os testes não usam chave nem gastam créditos.

| Arquivo | O que cobre |
|---|---|
| `AuthTest` | RF01: cadastro, login, logout, sessão inválida |
| `QueryTest` | CRUD genérico, formatos de data, upsert e isolamento de dados entre usuários e squads |
| `BusinessRulesTest` | RN01 (sequência), RN02 (recorde), RN04 (admin do squad), sessão de treino e dieta |
| `ai/AiTest` | RF07 e RN05: chat em streaming, ferramenta de treino, análise de comida |
| `FilesTest` | Envio de fotos de perfil e de squad |

## Variáveis de ambiente

Nenhuma credencial fica no código (RNF04). Tudo vem do ambiente:

| Variável | Para que serve | Padrão |
|---|---|---|
| `KRONOS_DB_URL` | Endereço JDBC do banco | `jdbc:postgresql://localhost:5432/kronos` |
| `KRONOS_DB_USER` | Usuário do banco | `kronos` |
| `KRONOS_DB_PASSWORD` | Senha do banco | `kronos` |
| `DATABASE_URL` | Alternativa às três acima, no formato `postgres://usuario:senha@host:porta/banco` que Render e Railway entregam | — |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic. Sem ela o servidor funciona e só o Kronos IA fica desligado | — |
| `KRONOS_AI_MODEL` | Modelo usado pelo Kronos IA | `claude-opus-5-5` |
| `PORT` | Porta HTTP | `8080` |

As tabelas são criadas na primeira execução pelas migrações em `src/main/resources/db/migration`.

## Colocar no ar

### Com Docker

```bash
cd server
KRONOS_DB_PASSWORD=escolha-uma-senha docker compose up --build
```

Sobe o PostgreSQL e o servidor na porta 8080. Para ligar a IA, defina também `ANTHROPIC_API_KEY`.

### Em uma hospedagem (Render, Railway e parecidas)

1. Crie um banco PostgreSQL na hospedagem.
2. Crie um serviço web a partir deste repositório, com a pasta `server` como raiz e o `Dockerfile` dela.
3. Defina `DATABASE_URL` (a hospedagem costuma oferecer esse valor pronto) e, se quiser a IA, `ANTHROPIC_API_KEY`.
4. Confira em `https://seu-endereco/api/health`: a resposta deve ser `{"data":"ok"}`.

## Ligar o app ao servidor

Na raiz do projeto, crie o arquivo `.env.android` (ele não vai para o repositório):

```
VITE_API_URL=https://seu-endereco/api
```

Gere o app de novo (`gradlew assembleDebug` na pasta `android/`). Sem esse arquivo, o app continua usando o backend embutido, com os dados só no aparelho.

O endereço precisa ser HTTPS. A única exceção é `http://10.0.2.2:8080/api`, que é o seu computador visto de dentro do emulador.

## Estrutura do código

| Pacote | Função |
|---|---|
| `web` | `ApiController` (rotas), `ErrorHandler` (formato dos erros), `WebConfig` (CORS) |
| `auth` | `AuthService`: cadastro, login e sessões. Senha com hash PBKDF2; do token de sessão fica só o SHA-256 |
| `data` | `QueryService` (CRUD genérico), `Schema` (tabelas e tipos lidos do banco), `AccessRules` (quem lê e grava o quê) |
| `rules` | `RpcService`: regras de negócio RN01, RN02 e RN04 e as funções de squad, treino e dieta |
| `ai` | `AiService`: Kronos IA pelo SDK oficial da Anthropic, com a regra RN05 |
| `files` | `FileService`: fotos de perfil e de squad, guardadas no banco |

### Regras de acesso

No app o banco era de um aparelho só. No servidor ele é de todos os usuários, então toda consulta passa por `AccessRules`:

- dados pessoais (dieta, peso, séries, progresso): só o dono lê e grava;
- squad, dias e exercícios: só quem é membro do squad;
- nome e foto do squad: só o admin;
- código de convite: só o admin enxerga, e ninguém consegue filtrar por ele;
- entrar em squad, trocar o código e remover membro: só pelas funções do `RpcService`, que conferem o papel de quem pediu.
