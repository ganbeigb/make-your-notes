package com.dshwork.coursenotes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.system.Os;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.animation.PropertyValuesHolder;
import android.graphics.drawable.GradientDrawable;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 课件知识助手 · 手机本地版
 *
 * 整个应用跑在手机上：APK 里打包了服务端（server/ + public/）和 Node.js 运行时（nodejs-mobile）。
 * 首次启动把资源解压到私有目录，用内置 Node 起本地服务，再用 WebView 打开 http://127.0.0.1:PORT。
 * 数据存在应用私有目录的 userdata/ 里，升级重装不会丢。
 */
public class MainActivity extends Activity {
    private static final String TAG = "CourseNotes";
    private static final String ASSET_ZIP = "app.zip";
    private static final String PAYLOAD_DIR = "app";
    private static final String VERSION_FILE = ".payload-version";
    private static final String PAYLOAD_VERSION = "1";
    private static final int REQ_FILE = 1001;
    private static final int MAX_LOG_LINES = 300;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private TextView logView;
    private final StringBuilder logBuf = new StringBuilder();

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCapture;

    private int port = 18713;
    private String baseUrl;
    private volatile boolean showedWeb = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        try (ServerSocket probe = new ServerSocket(0)) {
            port = probe.getLocalPort();
        } catch (Throwable ignored) {}
        baseUrl = "http://127.0.0.1:" + port;

        getWindow().setStatusBarColor(Color.parseColor("#F4F1EA"));
        getWindow().setNavigationBarColor(Color.parseColor("#F4F1EA"));
        if (Build.VERSION.SDK_INT >= 23) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        // Android 15 起系统强制 edge-to-edge：让页面自己吃掉状态栏/导航栏/输入法的 inset，
        // 否则顶栏会贴到状态栏底下。
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F4F1EA"));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            // Android 11+ 显式 edge-to-edge，需要自己让出系统栏；更老的系统默认已经避开
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                v.setPadding(0, bars.top, 0, bars.bottom);
            }
            return insets;
        });
        setContentView(root);
        root.requestApplyInsets();

        showSplash();
        android.util.Log.i(TAG, "boot: " + Build.MANUFACTURER + " " + Build.MODEL
                + " · Android " + Build.VERSION.RELEASE + " (" + Build.SUPPORTED_ABIS[0] + ")");
        new Thread(this::boot, "boot").start();
    }

    // ---- 启动流程 -------------------------------------------------------------------------------------------

    private void boot() {
        final File payload = new File(getFilesDir(), PAYLOAD_DIR);

        try {
            if (needsUnpack(payload)) {
                android.util.Log.i(TAG, "first launch: unpacking assets…");
                unpack(payload);
                writeVersion(payload);
                android.util.Log.i(TAG, "assets unpacked");
            }
        } catch (Throwable t) {
            log("!! 解压失败：" + t);
            ui.post(this::showLogScreen);
            return;
        }

        final File entry = new File(payload, "server/server.js");
        if (!entry.isFile()) {
            log("!! 找不到入口文件：" + entry);
            ui.post(this::showLogScreen);
            return;
        }

        final File dataDir = new File(getFilesDir(), "userdata");
        //noinspection ResultOfMethodCallIgnored
        dataDir.mkdirs();

        // Android 上 Node 的默认信任库可能为空，额外挂一份 Mozilla CA 作为兜底
        final File ca = new File(getFilesDir(), "cacert.pem");
        if (!ca.isFile()) copyAsset("cacert.pem", ca);

        setEnv("PORT", String.valueOf(port));
        setEnv("HOST", "127.0.0.1");
        setEnv("NO_OPEN", "1");
        setEnv("APP_EMBEDDED", "1");
        setEnv("APP_DATA_DIR", dataDir.getAbsolutePath());
        setEnv("HOME", getFilesDir().getAbsolutePath());
        if (ca.isFile()) setEnv("NODE_EXTRA_CA_CERTS", ca.getAbsolutePath());

        NodeRunner.setLogFile(new File(getFilesDir(), "node.log").getAbsolutePath());
        android.util.Log.i(TAG, "starting embedded node server…");

        new Thread(() -> {
            try {
                int code = NodeRunner.startNode(new String[]{"node", entry.getAbsolutePath()});
                log("Node 已退出（code " + code + "）");
            } catch (Throwable t) {
                log("!! Node 启动失败：" + t);
                ui.post(this::showLogScreen);
            }
        }, "node").start();

        pollThenShow();
    }

    private static void setEnv(String key, String value) {
        try {
            Os.setenv(key, value, true);
        } catch (Throwable ignored) {}
    }

    private void copyAsset(String name, File dest) {
        try (InputStream in = getAssets().open(name);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Throwable t) {
            android.util.Log.w(TAG, "copy asset " + name + " failed", t);
        }
    }

    private boolean needsUnpack(File payload) {
        if (!new File(payload, "server/server.js").isFile()) return true;
        File vf = new File(payload, VERSION_FILE);
        if (!vf.isFile()) return true;
        try (InputStream in = new FileInputStream(vf)) {
            byte[] b = new byte[32];
            int n = in.read(b);
            return n <= 0 || !PAYLOAD_VERSION.equals(new String(b, 0, n).trim());
        } catch (Throwable t) {
            return true;
        }
    }

    private void writeVersion(File payload) {
        try (OutputStream out = new FileOutputStream(new File(payload, VERSION_FILE))) {
            out.write(PAYLOAD_VERSION.getBytes());
        } catch (Throwable ignored) {}
    }

    private void unpack(File dest) throws Exception {
        deleteTree(dest);
        if (!dest.mkdirs() && !dest.isDirectory()) throw new Exception("无法创建 " + dest);

        long files = 0;
        try (InputStream raw = getAssets().open(ASSET_ZIP);
             ZipInputStream zin = new ZipInputStream(new BufferedInputStream(raw, 1 << 16))) {
            byte[] buf = new byte[1 << 16];
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                File out = new File(dest, e.getName());
                String canonical = out.getCanonicalPath();
                if (!canonical.startsWith(dest.getCanonicalPath())) throw new Exception("bad entry " + e.getName());
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                }
                try (OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 1 << 16)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) os.write(buf, 0, n);
                }
                files++;
            }
        }
        android.util.Log.i(TAG, "unpacked files: " + files);
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private void pollThenShow() {
        new Thread(() -> {
            for (int i = 0; i < 120; i++) {
                if (isServerUp()) {
                    android.util.Log.i(TAG, "server ready: " + baseUrl);
                    ui.post(this::showWeb);
                    return;
                }
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    return;
                }
            }
            log("!! 60 秒内服务没有响应，以下是 Node 的输出：");
            dumpNodeLog();
            log("可以把这张截图发给我。");
            ui.post(this::showLogScreen);
        }, "poll").start();
    }

    private boolean isServerUp() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(baseUrl + "/healthz").openConnection();
            c.setConnectTimeout(1200);
            c.setReadTimeout(1200);
            return c.getResponseCode() == 200;
        } catch (Throwable t) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void dumpNodeLog() {
        File f = new File(getFilesDir(), "node.log");
        if (!f.isFile()) {
            log("  (node.log 不存在)");
            return;
        }
        java.io.BufferedReader r = null;
        try {
            r = new java.io.BufferedReader(new java.io.InputStreamReader(new FileInputStream(f)));
            java.util.ArrayDeque<String> tail = new java.util.ArrayDeque<>();
            String line;
            while ((line = r.readLine()) != null) {
                tail.addLast(line);
                if (tail.size() > 30) tail.removeFirst();
            }
            for (String s : tail) log("  | " + s);
        } catch (Throwable t) {
            log("  读取 node.log 失败：" + t);
        } finally {
            try {
                if (r != null) r.close();
            } catch (Throwable ignored) {}
        }
    }

    // ---- 界面 -----------------------------------------------------------------------------------------------


    // ---- 启动动画 -------------------------------------------------------------------------------------------

    /** 启动中的最小展示：图标呼吸 + 三点跳动；失败时才切到日志页 */
    private void showSplash() {
        root.removeAllViews();

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        int size = dp(96);
        box.addView(icon, new LinearLayout.LayoutParams(size, size));

        // 呼吸：缩放 0.94~1.06 + 透明度 0.8~1.0
        ObjectAnimator breathe = ObjectAnimator.ofPropertyValuesHolder(icon,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 0.94f, 1.06f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.94f, 1.06f),
                PropertyValuesHolder.ofFloat(View.ALPHA, 0.82f, 1f));
        breathe.setDuration(1100);
        breathe.setRepeatCount(ValueAnimator.INFINITE);
        breathe.setRepeatMode(ValueAnimator.REVERSE);
        breathe.start();

        // 三点跳动
        LinearLayout dots = new LinearLayout(this);
        dots.setOrientation(LinearLayout.HORIZONTAL);
        dots.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(7), dp(7));
        dotLp.leftMargin = dp(5);
        dotLp.rightMargin = dp(5);
        final View[] dotViews = new View[3];
        for (int i = 0; i < 3; i++) {
            View dot = new View(this);
            GradientDrawable d = new GradientDrawable();
            d.setShape(GradientDrawable.OVAL);
            d.setColor(Color.parseColor("#2F5D4B"));
            dot.setBackground(d);
            dot.setAlpha(0.35f);
            dotViews[i] = dot;
            dots.addView(dot, dotLp);
        }
        LinearLayout.LayoutParams dotsLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dotsLp.topMargin = dp(22);
        box.addView(dots, dotsLp);

        for (int i = 0; i < 3; i++) {
            ObjectAnimator fade = ObjectAnimator.ofFloat(dotViews[i], View.ALPHA, 0.25f, 1f);
            fade.setDuration(520);
            fade.setStartDelay(i * 170L);
            fade.setRepeatCount(ValueAnimator.INFINITE);
            fade.setRepeatMode(ValueAnimator.REVERSE);
            fade.start();
        }

        root.addView(box, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 日志视图不显示，但保留引用以便失败时切换
        logView = new TextView(this);
    }

    private void showLogScreen() {
        if (logView == null) logView = new TextView(this);
        logView.setText(logBuf.toString());
        root.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        logView = new TextView(this);
        logView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        logView.setTypeface(android.graphics.Typeface.MONOSPACE);
        logView.setTextColor(Color.parseColor("#332F28"));
        logView.setPadding(dp(16), dp(16), dp(16), dp(16));
        logView.setLineSpacing(dp(2), 1f);
        scroll.addView(logView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void log(final String line) {
        android.util.Log.i(TAG, line);
        ui.post(() -> {
            logBuf.append(line).append('\n');
            int lines = 0;
            for (int i = 0; i < logBuf.length(); i++) if (logBuf.charAt(i) == '\n') lines++;
            if (lines > MAX_LOG_LINES) logBuf.delete(0, logBuf.indexOf("\n") + 1);
            if (logView != null) logView.setText(logBuf.toString());
        });
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void showWeb() {
        if (showedWeb) return;
        showedWeb = true;

        root.removeAllViews();
        logView = null;

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        web.setBackgroundColor(Color.parseColor("#F4F1EA"));
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                return openFileChooser(cb, params);
            }

            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage msg) {
                android.util.Log.i(TAG, "web: " + msg.message());
                return true;
            }

            // WebView 默认不弹 alert/confirm/prompt：不实现的话 confirm 会直接返回 false，
            // 表现就是「点删除没反应」。应用里已经改用自绘弹窗，这里作为兜底。
            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue,
                                      final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue == null ? "" : defaultValue);
                input.setSelection(input.getText().length());
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton("确定", (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String disposition, String mime, long len) {
                startDownload(url, userAgent, disposition, mime);
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(baseUrl + "/");
    }

    // ---- 选图 / 拍照 ----------------------------------------------------------------------------------------

    private boolean openFileChooser(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
        }
        filePathCallback = cb;
        pendingCapture = null;

        try {
            Intent content = params.createIntent();
            content.addCategory(Intent.CATEGORY_OPENABLE);
            Intent chooser = Intent.createChooser(content, "选择课件图片");

            Intent camera = buildCameraIntent();
            if (camera != null) {
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new android.os.Parcelable[]{camera});
            }
            startActivityForResult(chooser, REQ_FILE);
            return true;
        } catch (Throwable t) {
            filePathCallback = null;
            cb.onReceiveValue(null);
            toast("无法打开选择器：" + t);
            return false;
        }
    }

    private Intent buildCameraIntent() {
        try {
            Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            if (i.resolveActivity(getPackageManager()) == null) return null;

            ContentValues v = new ContentValues();
            v.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "slide_" + System.currentTimeMillis() + ".jpg");
            v.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= 29) {
                v.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/CourseNotes");
            }
            pendingCapture = getContentResolver().insert(
                    android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (pendingCapture == null) return null;

            i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, pendingCapture);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return i;
        } catch (Throwable t) {
            android.util.Log.w(TAG, "camera intent unavailable", t);
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }

        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            try {
                if (data == null || (data.getData() == null && data.getClipData() == null)) {
                    if (pendingCapture != null) result = new Uri[]{pendingCapture};
                } else if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    result = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        result[i] = clip.getItemAt(i).getUri();
                    }
                } else {
                    result = new Uri[]{data.getData()};
                }
            } catch (Throwable t) {
                android.util.Log.w(TAG, "file chooser result failed", t);
            }
        }

        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
        pendingCapture = null;
    }

    // ---- 下载（导出 Markdown / JSON）-------------------------------------------------------------------------

    private void startDownload(String url, String userAgent, String disposition, String mime) {
        try {
            String name = android.webkit.URLUtil.guessFileName(url, disposition, mime);
            android.app.DownloadManager.Request req = new android.app.DownloadManager.Request(Uri.parse(url));
            req.addRequestHeader("User-Agent", userAgent);
            req.setMimeType(mime);
            req.setTitle(name);
            req.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            android.app.DownloadManager dm =
                    (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            dm.enqueue(req);
            toast("已开始下载：" + name);
        } catch (Throwable t) {
            toast("下载失败：" + t.getMessage());
        }
    }

    private void toast(final String msg) {
        ui.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    // ---- 生命周期 -------------------------------------------------------------------------------------------

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
