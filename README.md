# Kronos — Treino e Dieta

Aplicativo Android para organizar treinos semanais (sozinho ou em squad), registrar séries e cargas e acompanhar dieta, hidratação e medidas corporais.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `android/` | App Android em Java: WebView e backend (servidor HTTP + SQLite) |
| `src/` | Interface (React + TypeScript), empacotada dentro do app |
| `public/` | Ícone e arquivos estáticos |

Detalhes da arquitetura estão em [android/README.md](android/README.md).

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

## Variáveis de ambiente

Copie `.env.example` para `.env`. No app Android nenhuma variável é necessária: o frontend fala com o backend na mesma origem (`/api`).
.