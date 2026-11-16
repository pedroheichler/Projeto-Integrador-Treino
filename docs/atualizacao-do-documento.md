# Atualização do Documento de Projeto

O arquivo `Kronos_Documento_Projeto_N1 (2).docx` descreve, na seção 8, uma versão do Kronos em que o servidor remoto, a IA e o envio de imagens ainda não existiam. Este arquivo traz o texto já atualizado para colar no documento.

O `.docx` não foi alterado diretamente porque a seção 9 dele está sendo preenchida por outro integrante: dois integrantes editando o mesmo arquivo binário em branches diferentes gera um conflito que o Git não consegue juntar.

O que muda no documento:

| Seção | O que fazer |
|---|---|
| 8 (texto de abertura e itens) | Substituir pelo texto abaixo |
| Figura 2 | Redesenhar com o servidor; o esquema está abaixo |
| 8.1 | Substituir pelo texto abaixo |
| 7.1 | Acrescentar o parágrafo indicado no fim deste arquivo |
| 1 a 6 | Nada muda: requisitos e regras continuam os mesmos e agora estão todos implementados |

---

## Seção 8 — texto novo

**8. Definição arquitetural e justificativa da pilha tecnológica**

A implementação, disponível no repositório do projeto, é composta por três partes: (i) um aplicativo Android nativo em Java, que hospeda em uma WebView a interface escrita em React e TypeScript, empacotada dentro do próprio app; (ii) um backend em Java embutido no aplicativo, que persiste os dados em SQLite; e (iii) um servidor em Spring Boot com banco PostgreSQL, que expõe a mesma API do backend embutido. Essa arquitetura substitui a proposta inicial de Flutter + Firebase, adotada neste documento apenas como estimativa antes da decisão final da equipe.

Como os dois backends expõem a mesma API, o aplicativo funciona em dois modos sem mudança na interface. No modo local, padrão, a interface conversa com o backend embutido e os dados ficam no aparelho. No modo ligado ao servidor, definido por uma única configuração de build (o endereço do servidor), a interface conversa com o servidor remoto.

*Figura 2 – Arquitetura implementada do Kronos (app Android/Java + WebView + backend embutido + servidor Spring Boot/PostgreSQL).*

- MainActivity abre uma WebView apontando para http://127.0.0.1:8765, endereço local onde roda o backend embutido no próprio app (classe ApiServer, baseada em NanoHTTPD), que também entrega os arquivos da interface.
- Os dois backends expõem os mesmos grupos de rotas: /api/auth (AuthService – cadastro e login, com senha em hash PBKDF2 e sessão por token), /api/query (QueryService – operações CRUD genéricas, com validação de tabelas e colunas), /api/rpc/* (RpcService – regras de negócio, como create_squad, join_squad_by_code, completed_training_days e finish_workout_session) e /api/files (fotos de perfil e de squad).
- A persistência local (item R5) é feita em SQLite por meio da classe Database, cobrindo cadastro/login, plano de treino, séries e cargas, sequência e progresso, dados de dieta (água, refeições, rotina alimentar, favoritos) e squads. No modo ligado ao servidor, o aplicativo mantém no aparelho uma cópia do último plano carregado e uma fila com os registros feitos sem conexão, enviados quando a rede volta (RF11 e RNF01).
- A persistência remota (item R6) é feita pelo servidor Spring Boot sobre PostgreSQL, com o esquema criado por migrações versionadas (Flyway). Com ela, os squads funcionam entre dispositivos diferentes. No servidor, toda consulta é restrita aos dados que o usuário pode ver: dados pessoais só para o dono, plano de treino só para os membros do squad e alterações do squad só para o administrador.
- A integração com IA (Kronos IA, item R7) é feita pelo servidor, na rota /api/ai, usando o SDK oficial da Anthropic. A chave de acesso fica apenas nas variáveis de ambiente do servidor e nunca no aplicativo nem no código versionado (RNF04). A conversa de treino é transmitida em tempo real, com indicador de carregamento na interface (RNF02), e a IA grava o treino de um dia no plano por meio de uma ferramenta com formato validado.
- O envio de imagens de perfil e de squad (item R8) está implementado nos dois backends: no aplicativo, as imagens ficam na área de arquivos do app; no servidor, ficam no banco de dados. Só o próprio usuário troca a sua foto e só o administrador troca a foto do squad.
- O servidor possui 38 testes automatizados, que sobem a aplicação completa sobre um PostgreSQL real e cobrem autenticação, isolamento de dados entre usuários e as regras de negócio RN01, RN02, RN04 e RN05.

### Esquema para redesenhar a Figura 2

```
┌───────────────── App Android (Java) ─────────────────┐
│  MainActivity ── WebView (React + TypeScript)        │
│                    │ cópia local do plano            │
│                    │ fila de registros offline       │
│                    ▼                                 │
│   modo local                    modo servidor        │
│   ApiServer (NanoHTTPD)              │               │
│   AuthService / QueryService         │ HTTPS         │
│   RpcService                         │               │
│        │                             │               │
│     SQLite                           │               │
└──────────────────────────────────────┼───────────────┘
                                       ▼
              ┌───────── Servidor (Spring Boot) ─────────┐
              │ ApiController                            │
              │  ├─ AuthService      ├─ AiService ──────────► API da Anthropic
              │  ├─ QueryService     └─ FileService      │
              │  └─ RpcService                           │
              │                PostgreSQL                │
              └──────────────────────────────────────────┘
```

## Seção 8.1 — texto novo

**8.1 Visão em camadas**

- Camada de apresentação – frontend em React/TypeScript, rodando dentro da WebView do app Android e empacotado nos assets do próprio APK. Inclui a fila de registros offline e a cópia local do plano.
- Camada de API – ApiServer (NanoHTTPD) no aplicativo e ApiController (Spring MVC) no servidor, que expõem as mesmas rotas HTTP e direcionam as requisições aos serviços.
- Camada de aplicação/domínio – AuthService (autenticação), RpcService (regras de negócio RN01, RN02 e RN04, criação/entrada em squad, sessão de treino e dieta) e, no servidor, AiService (Kronos IA e regra RN05). A regra RN03 é aplicada na tela de Dieta.
- Camada de dados – QueryService (CRUD genérico com validação de tabelas/colunas) sobre SQLite no aplicativo (classe Database) e sobre PostgreSQL no servidor, onde a classe AccessRules restringe cada consulta aos dados do usuário e dos seus squads.
- Camada nativa Android – KronosApplication (sobe o backend embutido quando o app abre) e MainActivity (hospeda a WebView, botão voltar, barras do sistema e seletor de arquivos).

## Seção 7.1 — parágrafo a acrescentar

Na implementação, a entidade Recorde não é uma tabela própria: o recorde de cada exercício é calculado a partir de Serie_Executada (tabela set_logs), conforme a RN02, o que evita manter o mesmo dado em dois lugares. O servidor acrescenta duas tabelas de apoio que não fazem parte do domínio: auth_sessions (sessões de login) e files (imagens de perfil e de squad).

---

## Como cada regra de negócio foi implementada

Para conferência com a seção 6 do documento:

| Regra | Implementação |
|---|---|
| RN01 | A função completed_training_days devolve apenas os dias em que todos os exercícios do treino feito naquela data foram concluídos. A interface calcula a sequência a partir desses dias e a zera quando um dia planejado fica sem treino completo. |
| RN02 | A função exercise_personal_records considera a série concluída de maior carga e, em caso de empate de carga, a de mais repetições. A interface marca o recorde no momento em que a série é concluída. |
| RN03 | A meta de água é sugerida a partir do último peso registrado (35 ml/kg) e pode ser alterada manualmente. Esta regra está sendo implementada por outro integrante; confirme que ela foi entregue antes de fechar o documento. |
| RN04 | As funções regenerate_invite_code, revoke_invite_code e remove_squad_member recusam quem não é administrador do squad. Nome e foto do squad também só mudam pelo administrador. |
| RN05 | Antes de cada conversa, o servidor monta o histórico de carga apenas dos exercícios com 3 ou mais execuções registradas e instrui a IA a não sugerir ajuste de carga para os demais. |
