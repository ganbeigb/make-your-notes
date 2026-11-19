# -*- coding: utf-8 -*-
"""生成项目目录树示意图（分两部分，便于嵌入手册分页）：
   docs/tree-1.png / docs/tree-2.png（位图，嵌 docx）与 docs/目录树.svg（矢量源）"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\dshwork\课件知识点助手"
FONT = r"C:\Windows\Fonts\msyh.ttc"
FONT_B = r"C:\Windows\Fonts\msyhbd.ttc"

PART1 = [
    (0, "课件知识点助手/", "项目根", "root"),
    (1, "public/", "前端 · 无框架", "dir"),
    (2, "index.html", "1.4K  页面骨架", "file"),
    (2, "app.js", "132.5K  视图与逻辑 3361 行", "key"),
    (2, "draw.js", "91.5K  画板引擎 2316 行", "key"),
    (2, "symbols.js", "15.2K  41 个元件符号", "file"),
    (2, "styles.css", "52.4K  样式 1153 行", "file"),
    (2, "manifest.webmanifest", "0.4K  PWA 清单", "file"),
    (2, "icon / favicon（4 张 PNG）", "应用图标", "file"),
    (2, "vendor/", "KaTeX + qrcode（勿改）", "dir"),
    (1, "server/", "后端 · Node 原生 http", "dir"),
    (2, "server.js", "98.4K  路由/导出/备份 2406 行", "key"),
    (2, "deepseek.js", "55.6K  模型调用 + 10 段提示词", "key"),
    (2, "store.js", "7.4K  数据读写 238 行", "file"),
    (2, "zip.js", "4.0K  手写 zip 113 行", "file"),
    (2, "secret.js", "2.3K  Key / 令牌加密", "file"),
]

PART2 = [
    (0, "课件知识点助手/（续）", "", "root"),
    (1, "android/", "手机外壳 · 内嵌 Node", "dir"),
    (2, "build.ps1", "9.0K  一键打包 187 行", "file"),
    (2, "AndroidManifest.xml", "1.6K  版本 83 / 2.9.10", "file"),
    (2, "coursenotes.keystore", "2.7K  签名证书（务必备份）", "file"),
    (2, "jni / node_bridge.cpp", "3.6K  启动 Node 104 行", "file"),
    (2, "src/…/MainActivity.java", "25.3K  WebView + 启动动画 565 行", "key"),
    (2, "src/…/NodeRunner.java", "0.9K  调 JNI 18 行", "file"),
    (2, "res/mipmap-*/", "5 档图标", "dir"),
    (1, "data/", "运行时生成 · 已 gitignore", "dir"),
    (2, "db.json", "全部业务数据（10 个顶层键）", "key"),
    (2, "images/", "课件原图 + AI 配图", "dir"),
    (2, "server.pid", "进程号（停止.bat 用）", "file"),
    (1, "docs/", "参赛材料与手册", "dir"),
    (2, "项目文档-*.docx", "参赛项目文档 633K", "file"),
    (2, "项目说明手册-*.pdf", "本手册", "file"),
    (2, "build_*.py / make_tree.py", "生成文档、手册与目录树", "file"),
    (1, "handoff/web-version-handoff.md", "上下文交接（唯一事实来源）", "key"),
    (1, "截图/", "10 张界面截图", "dir"),
    (1, "CHANGELOG.md", "79 个版本 + 编号规则", "file"),
    (1, "README.md", "使用说明 31K", "file"),
    (1, "启动.bat / 后台启动.vbs / 停止.bat", "启动与停止", "file"),
    (1, "MakeYourNotes-v2.9.10.apk", "当前 APK 20.4M", "key"),
]

ROW_H, PAD_X, PAD_Y, INDENT, BOX_H = 44, 34, 34, 32, 32
COL_W_NAME, COL_W_NOTE = 372, 330
WIDTH = PAD_X * 2 + COL_W_NAME + COL_W_NOTE + 28
BG, INK, MUTED = (250, 249, 245), (31, 36, 33), (110, 118, 112)
ACCENT, ACCENT_SOFT = (47, 93, 75), (230, 239, 233)
KEYC, KEY_SOFT = (120, 80, 20), (248, 239, 223)
LINE, WHITE = (206, 199, 182), (255, 255, 255)
S = 2.6

svg_all = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
           % (WIDTH, 40, WIDTH, 40),
           '<style>text{font-family:"Microsoft YaHei",sans-serif}</style>']
svg_rows = []


def render(tree, out_png):
    height = PAD_Y * 2 + ROW_H * len(tree) + 26
    img = Image.new("RGB", (int(WIDTH * S), int(height * S)), BG)
    d = ImageDraw.Draw(img)
    f_name = ImageFont.truetype(FONT, int(15 * S))
    f_b = ImageFont.truetype(FONT_B, int(15 * S))
    f_note = ImageFont.truetype(FONT, int(12 * S))
    f_hint = ImageFont.truetype(FONT, int(11 * S))

    def px(v):
        return int(v * S)

    d.text((px(PAD_X), px(PAD_Y - 24)), "目录 / 文件", font=f_hint, fill=MUTED)
    d.text((px(PAD_X + COL_W_NAME + 16), px(PAD_Y - 24)), "规模与职责", font=f_hint, fill=MUTED)
    svg_rows.append(('hint', PAD_X, PAD_Y - 24, "目录 / 文件"))
    svg_rows.append(('hint', PAD_X + COL_W_NAME + 16, PAD_Y - 24, "规模与职责"))

    for i, (depth, name, note, kind) in enumerate(tree):
        top = PAD_Y + i * ROW_H
        left = PAD_X + depth * INDENT
        bw = COL_W_NAME - depth * INDENT

        if kind == 'dir':
            fill, outline, tcol, bold = ACCENT_SOFT, None, ACCENT, True
        elif kind == 'key':
            fill, outline, tcol, bold = KEY_SOFT, None, KEYC, True
        elif kind == 'root':
            fill, outline, tcol, bold = ACCENT, None, WHITE, True
        else:
            fill, outline, tcol, bold = WHITE, LINE, INK, False

        if depth > 0:
            pxs = PAD_X + (depth - 1) * INDENT
            mid = top + BOX_H / 2
            d.line([(px(pxs + 10), px(top - ROW_H / 2)), (px(pxs + 10), px(mid))], fill=LINE, width=max(1, int(1.2 * S)))
            d.line([(px(pxs + 10), px(mid)), (px(left - 6), px(mid))], fill=LINE, width=max(1, int(1.2 * S)))
            svg_rows.append(('conn', pxs + 10, top - ROW_H / 2, mid, left - 6))

        d.rounded_rectangle([px(left), px(top), px(left + bw), px(top + BOX_H)], radius=px(8),
                            fill=fill, outline=outline, width=max(1, int(1.2 * S)) if outline else 0)
        svg_rows.append(('box', left, top, bw, BOX_H, fill, outline))
        d.text((px(left + 11), px(top + BOX_H / 2 - 9)), name, font=(f_b if bold else f_name), fill=tcol)
        svg_rows.append(('text', left + 11, top + BOX_H / 2 - 3, name, tcol, bold))
        d.text((px(PAD_X + COL_W_NAME + 16), px(top + BOX_H / 2 - 7)), note, font=f_note, fill=MUTED)
        if note:
            svg_rows.append(('note', PAD_X + COL_W_NAME + 16, top + BOX_H / 2 + 3, note))

    img.save(out_png, "PNG", optimize=True)
    return img.size, height


size1, h1 = render(PART1, os.path.join(ROOT, "docs", "tree-1.png"))
size2, h2 = render(PART2, os.path.join(ROOT, "docs", "tree-2.png"))
print("tree-1:", size1, "| tree-2:", size2)

# 合成一份矢量 SVG（两部分上下排列）
total_h = h1 + h2 + 16
svg = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
       % (WIDTH, total_h, WIDTH, total_h),
       '<rect width="%d" height="%d" fill="#faf9f5"/>' % (WIDTH, total_h),
       '<style>text{font-family:"Microsoft YaHei",sans-serif}</style>']

off_y = 0
for part in (0, 1):
    for row in svg_rows:
        pass
    break

# 简单做法：把两份位图的矢量等价重画一遍（坐标 y 加偏移）
def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def emit(tree, offset):
    out = []
    out.append('<g transform="translate(0,%.1f)">' % offset)
    for i, (depth, name, note, kind) in enumerate(tree):
        top = PAD_Y + i * ROW_H
        left = PAD_X + depth * INDENT
        bw = COL_W_NAME - depth * INDENT
        if kind == 'dir':
            fill, outline, tcol, bold = "#e6efe9", None, "#2f5d4b", True
        elif kind == 'key':
            fill, outline, tcol, bold = "#f8efdf", None, "#785014", True
        elif kind == 'root':
            fill, outline, tcol, bold = "#2f5d4b", None, "#ffffff", True
        else:
            fill, outline, tcol, bold = "#ffffff", "#cec7b6", "#1f2421", False
        if depth > 0:
            pxs = PAD_X + (depth - 1) * INDENT
            mid = top + BOX_H / 2
            out.append('<path d="M%.1f %.1f V%.1f H%.1f" stroke="#cec7b6" stroke-width="1.2" fill="none"/>'
                       % (pxs + 10, top - ROW_H / 2, mid, left - 6))
        r = '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="8" fill="%s"' % (left, top, bw, BOX_H, fill)
        if outline:
            r += ' stroke="%s" stroke-width="1.2"' % outline
        out.append(r + '/>')
        out.append('<text x="%.1f" y="%.1f" font-size="15" fill="%s"%s>%s</text>'
                   % (left + 11, top + BOX_H / 2 + 5, tcol, ' font-weight="bold"' if bold else '', esc(name)))
        if note:
            out.append('<text x="%.1f" y="%.1f" font-size="12" fill="#6e7670">%s</text>'
                       % (PAD_X + COL_W_NAME + 16, top + BOX_H / 2 + 4, esc(note)))
    out.append('</g>')
    return out


svg += emit(PART1, 0)
svg += emit(PART2, h1 + 16)
svg.append('</svg>')
with open(os.path.join(ROOT, "docs", "目录树.svg"), "w", encoding="utf-8") as f:
    f.write("\n".join(svg))
print("svg written:", os.path.getsize(os.path.join(ROOT, "docs", "目录树.svg")))
