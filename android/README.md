# Kronos — App Android

App Android em Java que roda o Kronos. O backend também é Java e roda dentro do próprio app, com os dados no aparelho. Para usar o servidor no lugar dele, veja [../server/README.md](../server/README.md).

```
┌──────────────── App Android (Java) ─────────────────┐
│  MainActivity ── WebView ──► http://127.0.0.1:8765  │
│                                  │                  │
│  ApiServer (NanoHTTPD)  ◄────────┘                  │
│   ├─ /           → frontend React (assets/www)      │
│   ├─ /api/auth   → AuthService   (cadastro/login)   │
│   ├─ /api/query  → QueryService  (CRUD genérico)    │
│   ├─ /api/rpc/*  → RpcService    (regras de negócio)│
│   └─ /api/files  → fotos de perfil e de squad       │
│                         │                           │
│                    SQLite (Database)                │
└─────────────────────────────────────────────────────┘
```

## Como rodar

1. Na raiz do projeto: `npm install`
2. Abra a pasta `android/` no Android Studio e clique em **Run**.

O Gradle roda o `npm run build:android` sozinho quando algum arquivo do frontend muda. O resultado vai para `app/src/main/assets/www`.

Pela linha de comando: `cd android` e depois `gradlew assembleDebug`. O APK sai em `app/build/outputs/apk/debug/`.

## O que funciona no modo local

- Cadastro e login (senha guardada como hash PBKDF2, sessão por token)
- Treino: plano da semana, exercícios, séries/cargas, sessão de treino, progresso
- Sequência de dias: só conta o dia com o treino concluído por inteiro (RN01)
- Recordes: série concluída de maior carga e, no empate, mais repetições (RN02)
- Dieta: água, refeições, rotina alimentar, favoritos, peso e medidas
- Squads: criar e entrar por código; o admin gera ou revoga o código e remove membros (RN04)
- Fotos de perfil e de squad

No modo local os squads só funcionam entre contas do mesmo aparelho, porque o banco fica nele, e a IA fica desligada (a chave da IA não pode ir dentro do app). Os dois passam a funcionar com o app ligado ao servidor.

## Estrutura do código Java

| Arquivo | Função |
|---|---|
| `KronosApplication` | Sobe o backend quando o app abre |
| `MainActivity` | WebView com o frontend, botão voltar, barras do sistema, seletor de arquivos |
| `backend/ApiServer` | Servidor HTTP: rotas da API, fotos e arquivos do frontend |
| `backend/Database` | Esquema SQLite (tabelas do app) |
| `backend/AuthService` | Cadastro, login, logout, validação de token |
| `backend/QueryService` | select/insert/update/upsert/delete com filtros, validando tabelas e colunas |
| `backend/RpcService` | Regras de negócio: sequência, recordes, convite e membros do squad, sessão de treino, dieta |

## Desenvolvendo o frontend com hot reload

Com o app aberto no emulador, rode:

```
adb forward tcp:8765 tcp:8765
npm run dev
```

O Vite repassa `/api` para o backend do emulador.

## Ligado ao servidor

Com o arquivo `.env.android` na raiz do projeto apontando para o servidor, a interface passa a falar com ele em vez do backend embutido:

```
VITE_API_URL=https://seu-endereco/api
```

O Gradle refaz a interface quando esse arquivo muda. O backend embutido continua no app, só deixa de ser chamado.
