# -*- coding: utf-8 -*-
"""用《用户手册》HTML 生成应用内离线帮助页 public/help.html（图片压到 900px、JPEG 内联）"""
import base64
import io
import os
import re

ROOT = r"D:\dshwork\课件知识点助手"
SRC = os.path.join(ROOT, "docs", "用户手册.html")
OUT = os.path.join(ROOT, "public", "help.html")

from PIL import Image

html = open(SRC, encoding="utf-8").read()

SHOT = os.path.join(ROOT, "截图")
cache = {}


def inline(match):
    name = match.group(1)
    if name in cache:
        return cache[name]
    path = os.path.join(SHOT, name)
    if not os.path.exists(path):
        cache[name] = match.group(0)
        return cache[name]
    im = Image.open(path).convert("RGB")
    if im.width > 900:
        im = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    out = 'src="data:image/jpeg;base64,%s"' % data
    cache[name] = out
    print("  内联", name, "->", round(len(data) / 1024, 1), "KB")
    return out


html = re.sub(r'src="\.\./截图/([^"]+)"', inline, html)

# 顶部加返回条 + 打印按钮；去掉打印时多余元素
extra_css = """
.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 3mm;
  padding: 2.5mm 4mm; background: #2f5d4b; color: #fff; font-size: 10pt; }
.topbar a, .topbar button { color: #fff; background: rgba(255,255,255,.16); border: 0; border-radius: 2mm;
  padding: 1.6mm 3.2mm; font-size: 9.5pt; text-decoration: none; cursor: pointer; }
.topbar .sp { margin-left: auto; }
.topbar .t { font-weight: 700; }
@media print { .topbar { display: none; } }
"""
html = html.replace("</style>", extra_css + "</style>", 1)
html = html.replace(
    "<body>",
    '<body><div class="topbar"><span class="t">用户手册</span>'
    '<a href="javascript:history.back()">← 返回应用</a>'
    '<span class="sp"></span><button onclick="window.print()">打印 / 存为 PDF</button></div>',
    1,
)

open(OUT, "w", encoding="utf-8").write(html)
print("written:", OUT, round(os.path.getsize(OUT) / 1024, 1), "KB")
