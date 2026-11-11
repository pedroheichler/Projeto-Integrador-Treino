# Kronos — Treino e Dieta

Aplicativo Android para organizar treinos semanais (sozinho ou em squad), registrar séries e cargas, acompanhar dieta, hidratação e medidas corporais, e montar ou ajustar treinos com um assistente de IA.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `android/` | App Android em Java: WebView e backend embutido (servidor HTTP + SQLite) |
| `src/` | Interface (React + TypeScript), empacotada dentro do app |
| `server/` | Servidor em Spring Boot + PostgreSQL, com a mesma API do backend embutido |
| `public/` | Ícone e arquivos estáticos |

Detalhes de cada parte: [android/README.md](android/README.md) e [server/README.md](server/README.md).

## Dois modos de uso

O app fala sempre com a mesma API. O que muda é onde ela roda:

| | Modo local (padrão) | Ligado ao servidor |
|---|---|---|
| Onde ficam os dados | No próprio aparelho (SQLite) | No servidor (PostgreSQL) |
| Squads | Só entre contas do mesmo aparelho | Entre celulares diferentes |
| Kronos IA | Desligado | Ligado |
| Sem internet | Funciona sempre | Abre com a última cópia do plano; o que for registrado sobe quando a conexão voltar |
| Configuração | Nenhuma | Arquivo `.env.android` com o endereço do servidor |

## Requisitos

- Node.js 20 ou mais recente
- Android Studio (JDK 17+ e Android SDK 36)

## Instalação e execução

```bash
npm install
```

Abra a pasta `android/` no Android Studio e clique em **Run** (emulador ou celular com depuração USB). O build do Gradle compila a interface automaticamente.

Pela linha de comando:

```bash
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```

O APK sai em `android/app/build/outputs/apk/debug/app-debug.apk`.

## Ligar o app ao servidor

1. Coloque o servidor no ar (passo a passo em [server/README.md](server/README.md)).
2. Na raiz do projeto, copie `.env.example` para `.env.android` e informe o endereço:

   ```
   VITE_API_URL=https://seu-endereco/api
   ```

3. Gere o app de novo.

Sem o arquivo `.env.android`, o app usa o modo local e nenhuma variável é necessária.

## Testes

```bash
npm run lint                   # checagem de tipos da interface
cd server && ./gradlew test    # 38 testes do servidor, incluindo as regras RN01 a RN05
```

## Regras de negócio

| Regra | Onde está |
|---|---|
| RN01: a sequência só conta o dia em que todos os exercícios do treino foram concluídos | `RpcService` (`completed_training_days`) |
| RN02: recorde é a série concluída de maior carga; no empate, a de mais repetições | `RpcService` (`exercise_personal_records`) |
| RN03: meta de água sugerida pelo peso (35 ml/kg), editável | Tela de Dieta (em desenvolvimento por outro integrante) |
| RN04: só o admin gera ou revoga o código de convite e remove membros | `RpcService` e `AccessRules` |
| RN05: a IA só sugere ajuste de carga em exercício com 3 ou mais execuções registradas | `AiService` (servidor) |

As regras RN01, RN02 e RN04 existem nos dois backends: `android/.../backend/RpcService.java` e `server/.../rules/RpcService.java`.
