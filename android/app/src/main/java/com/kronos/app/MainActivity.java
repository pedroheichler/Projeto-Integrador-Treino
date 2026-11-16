package com.kronos.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

/**
 * Tela única do app: uma WebView que carrega o frontend React servido pelo
 * backend local. A interface é exatamente a mesma da versão web.
 */
public class MainActivity extends Activity {

    private static final int BACKGROUND = 0xFF0B0F1A;
    private static final int PICK_FILE_REQUEST = 1001;

    private WebView webView;
    /** Resposta que a página espera depois de abrir o seletor de arquivos */
    private ValueCallback<Uri[]> filePicked;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // localStorage: sessão, tema e fila offline
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient() {
            // Sem isso, <input type="file"> não faz nada na WebView
            // (trocar foto de perfil, foto da refeição para a IA)
            @Override
            public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePicked != null) filePicked.onReceiveValue(null);
                filePicked = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException noPicker) {
                    filePicked = null;
                    return false;
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("127.0.0.1".equals(url.getHost())) return false;
                // Links externos abrem no navegador, não dentro do app
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {
                    // Sem navegador instalado: ignora o clique
                }
                return true;
            }
        });

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // Permite inspecionar pelo chrome://inspect no computador
            WebView.setWebContentsDebuggingEnabled(true);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        root.addView(webView);
        applySystemBarInsets(root);
        setContentView(root);

        registerBackHandler();

        String baseUrl = KronosApplication.baseUrl();
        if (baseUrl == null) {
            webView.loadData(
                "<body style='background:#0B0F1A;color:#E6EAF2;font-family:sans-serif;padding:24px'>" +
                "<h3>Não foi possível iniciar o backend</h3><p>Feche e abra o app novamente.</p>",
                "text/html; charset=utf-8", "UTF-8");
        } else if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(baseUrl);
        }
    }

    /**
     * No Android 15+ o app desenha atrás das barras do sistema; o padding
     * evita que o cabeçalho fique embaixo da barra de status e o teclado
     * cubra os campos.
     */
    private void applySystemBarInsets(FrameLayout root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    /** Voltar do celular navega no histórico do app antes de fechar. */
    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBackOrFinish);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBackOrFinish();
    }

    private void goBackOrFinish() {
        if (webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILE_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (filePicked != null) {
            // null quando o usuário cancela: a página precisa da resposta mesmo assim
            filePicked.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePicked = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
