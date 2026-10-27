"""从 wd-icons.ttf 提取图标，渲染成 tabBar 用的 PNG。

为什么需要这个脚本：
    tabBar 是原生控件，只接受图片文件（iconPath），不接受字体图标 /
    wd-icon 组件。所以必须把组件库字体里的字形渲染成 PNG。
    直接复用 wd-icons.ttf，保证 tabBar 图标与页面内图标风格一致。

为什么每套主题色都要出一份：
    PNG 的颜色是烤死在像素里的，setTabBarStyle 只能改文字颜色，
    改不了图片。所以 6 套预设色各生成一组 selectedIconPath，
    切换主题时用 uni.setTabBarItem 动态替换路径。

用法：
    python scripts/gen-tabbar-icons.py

输出：
    static/tabbar/{name}.png                  未选中（浅色，灰）
    static/tabbar/{name}-dark.png             未选中（深色，浅灰）
    static/tabbar/{name}-active-{preset}.png  选中（对应主题色）
"""

import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_PATH = os.path.join(
    ROOT, "node_modules", "wot-design-uni", "components", "wd-icon", "wd-icons.ttf"
)
SCSS_PATH = os.path.join(
    ROOT, "node_modules", "wot-design-uni", "components", "wd-icon", "index.scss"
)
OUT_DIR = os.path.join(ROOT, "static", "tabbar")

# tabBar 图标建议 81x81（3 倍图），uni-app 自动缩放
SIZE = 81

# 未选中态：浅色主题用深灰，深色主题用浅灰
NORMAL_LIGHT = (150, 151, 153)     # #969799
NORMAL_DARK = (142, 142, 147)      # #8E8E93

# 选中态：与 utils/theme.js 的 THEME_PRESETS 保持一致
PRESET_COLORS = {
    "green":  (7, 193, 96),        # #07C160
    "blue":   (25, 137, 250),      # #1989FA
    "orange": (255, 143, 31),      # #FF8F1F
    "purple": (125, 95, 255),      # #7D5FFF
    "red":    (238, 10, 36),       # #EE0A24
    "grey":   (50, 50, 51),        # #323233
}

# 四个 tab 对应的图标名（scss 里的 .wd-icon-NAME），按优先级取第一个存在的
TAB_ICONS = {
    "home":    ["home", "home1", "view-list"],
    "account": ["money-circle", "creditcard", "wallet"],
    "stats":   ["chart-bar", "chart", "chart-pie"],
    "mine":    ["user", "user-circle", "setting"],
}


def parse_codepoints():
    """从 index.scss 解析 name -> codepoint 的映射"""
    with open(SCSS_PATH, "r", encoding="utf-8") as f:
        scss = f.read()

    # content 可能是 '\eXXX' 或 "\eXXX"，两种引号都要匹配
    pattern = re.compile(
        r'\.wd-icon-([a-z0-9\-]+):before\s*\{\s*content:\s*[\'"]\\([0-9a-fA-F]+)[\'"]'
    )
    result = {}
    for m in pattern.finditer(scss):
        result[m.group(1)] = int(m.group(2), 16)
    return result


def pick_icon(candidates, codemap):
    for name in candidates:
        if name in codemap:
            return name, codemap[name]
    return None, None


def render(char, color, out_path):
    """把单个字符渲染成透明背景 PNG，并居中"""
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    font_size = int(SIZE * 0.72)
    try:
        font = ImageFont.truetype(FONT_PATH, font_size)
    except Exception as e:
        print(f"FONT LOAD FAILED: {e}")
        return False

    bbox = draw.textbbox((0, 0), char, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (SIZE - w) / 2 - bbox[0]
    y = (SIZE - h) / 2 - bbox[1]

    draw.text((x, y), char, font=font, fill=color)
    image.save(out_path, "PNG")
    return True


def main():
    if not os.path.exists(FONT_PATH):
        print(f"FONT NOT FOUND: {FONT_PATH}")
        print("请先执行 npm install")
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    codemap = parse_codepoints()
    print(f"parsed {len(codemap)} icons from scss\n")

    total = 0
    expected = 0

    for tab, candidates in TAB_ICONS.items():
        name, cp = pick_icon(candidates, codemap)
        if name is None:
            print(f"FAIL {tab}: none of {candidates} exists")
            expected += 2 + len(PRESET_COLORS)
            continue

        char = chr(cp)

        # 未选中：浅色 / 深色
        jobs = [
            (NORMAL_LIGHT, os.path.join(OUT_DIR, f"{tab}.png")),
            (NORMAL_DARK, os.path.join(OUT_DIR, f"{tab}-dark.png")),
        ]
        # 选中：每套主题色
        for key, color in PRESET_COLORS.items():
            jobs.append((color, os.path.join(OUT_DIR, f"{tab}-active-{key}.png")))

        expected += len(jobs)
        ok_all = True
        for color, path in jobs:
            if not render(char, color, path):
                ok_all = False
            else:
                total += 1

        if ok_all:
            print(f"OK   {tab:8s} <- wd-icon-{name} (U+{cp:04X})  {len(jobs)} files")
        else:
            print(f"FAIL {tab}: render error")

    print(f"\n{total}/{expected} files -> static/tabbar/")
    return 0 if total == expected else 1


if __name__ == "__main__":
    sys.exit(main())
