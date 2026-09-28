# Kronos — App Android (beta)

App Android em Java que roda o Kronos. O backend também é Java e roda dentro do próprio app.

```
┌──────────────── App Android (Java) ─────────────────┐
│  MainActivity ── WebView ──► http://127.0.0.1:8765  │
│                                  │                  │
│  ApiServer (NanoHTTPD)  ◄────────┘                  │
│   ├─ /           → frontend React (assets/www)      │
│   ├─ /api/auth   → AuthService   (cadastro/login)   │
│   ├─ /api/query  → QueryService  (CRUD genérico)    │
│   └─ /api/rpc/*  → RpcService    (regras de negócio)│
│                         │                           │
│                    SQLite (Database)                │
└─────────────────────────────────────────────────────┘
```

## Como rodar

1. Na raiz do projeto: `npm install`
2. Abra a pasta `android/` no Android Studio e clique em **Run**.

O Gradle roda o `npm run build:android` sozinho quando algum arquivo do frontend muda. O resultado vai para `app/src/main/assets/www`.

Pela linha de comando: `cd android` e depois `gradlew assembleDebug`. O APK sai em `app/build/outputs/apk/debug/`.

## O que funciona no beta

- Cadastro e login (senha guardada como hash PBKDF2, sessão por token)
- Treino: plano da semana, exercícios, séries/cargas, sessão de treino, sequência, progresso
- Dieta: água, refeições, rotina alimentar, favoritos, peso e medidas
- Squads: criar e entrar por código (só entre contas do mesmo aparelho, porque o banco é local)

**Ainda não tem:** IA (chat, análise de comida, resumo semanal) e envio de fotos de perfil ou de squad. O app mostra "indisponível na versão beta".

## Estrutura do código Java

| Arquivo | Função |
|---|---|
| `KronosApplication` | Sobe o backend quando o app abre |
| `MainActivity` | WebView com o frontend, botão voltar, barras do sistema |
| `backend/ApiServer` | Servidor HTTP: rotas da API e arquivos do frontend |
| `backend/Database` | Esquema SQLite (tabelas do app) |
| `backend/AuthService` | Cadastro, login, logout, validação de token |
| `backend/QueryService` | select/insert/update/upsert/delete com filtros, validando tabelas e colunas |
| `backend/RpcService` | create_squad, join_squad_by_code, finish_workout_session etc. |

## Desenvolvendo o frontend com hot reload

Com o app aberto no emulador, rode:

```
adb forward tcp:8765 tcp:8765
npm run dev
```

O Vite repassa `/api` para o backend do emulador.

## Próximos passos sugeridos

1. Levar o backend para um servidor (Spring Boot + PostgreSQL). Assim os squads funcionam entre celulares diferentes, e o frontend só precisa de `VITE_API_URL`.
2. IA pelo backend (rota `/api/ai`)
3. Upload de imagens
4. Trocar telas da WebView por telas nativas em Java, uma de cada vez
