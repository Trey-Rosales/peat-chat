#!/usr/bin/env python3
"""DTAK Interface Guide token generator.

Source of truth for the seven OKLCH color scales and the per-mode
semantic token mappings. Run from repo root:

    python3 scripts/generate-tokens.py

Emits:
    web/src/styles/tokens.json                     machine-readable
    web/src/styles/themes/dark.css                 OKLCH CSS vars
    web/src/styles/themes/light.css
    web/src/styles/themes/low-detection.css

Anchors come from the user's Figma DTAK file. To change them, edit the
ANCHORS dict below, re-run, commit the regenerated files.
"""
from __future__ import annotations
import json, math, os, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STOPS = (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950)

# ── Anchor hexes (locked v1) ───────────────────────────────────────────
# Source: user's Figma DTAK file, 2026-05-01.
GRAY_50, GRAY_500, GRAY_950 = "#ECEDEE", "#3F4447", "#070808"
ANCHORS_500 = {
    "gray":   GRAY_500,
    "blue":   "#1879C7",   # USAF institutional
    "red":    "#C7181B",
    "orange": "#C75314",
    "yellow": "#FFAC1C",   # vivid amber-yellow at L=80%
    "green":  "#137D3B",   # forest / military
    "violet": "#8B5CF6",   # Tailwind violet (no anchor provided)
}

# ── OKLCH math ─────────────────────────────────────────────────────────
def srgb_to_linear(c): return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def linear_to_srgb(c): return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055

def hex_to_rgb01(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))

def linear_srgb_to_oklab(r, g, b):
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = l**(1/3), m**(1/3), s**(1/3)
    return (
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_,
    )

def oklab_to_linear_srgb(L, a, b):
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    return (
        +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
        -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
        -0.0041960863*l - 0.7034186147*m + 1.7076147010*s,
    )

def in_gamut(L, C, H):
    a = C*math.cos(math.radians(H)); b = C*math.sin(math.radians(H))
    rl, gl, bl = oklab_to_linear_srgb(L, a, b)
    return all(-1e-4 <= v <= 1.0001 for v in (rl, gl, bl))

def gamut_map(L, C, H):
    if in_gamut(L, C, H): return L, C, H
    lo, hi = 0.0, C
    for _ in range(40):
        mid = (lo + hi) / 2
        if in_gamut(L, mid, H): lo = mid
        else: hi = mid
    return L, lo, H

def oklch_to_hex(L, C, H):
    L, C, H = gamut_map(L, C, H)
    a = C*math.cos(math.radians(H)); b = C*math.sin(math.radians(H))
    rl, gl, bl = oklab_to_linear_srgb(L, a, b)
    rgb = [max(0, min(1, linear_to_srgb(c))) for c in (rl, gl, bl)]
    return "#{:02X}{:02X}{:02X}".format(*[round(c*255) for c in rgb]), (L, C, H)

def hex_to_oklch(h):
    r, g, b = (srgb_to_linear(c) for c in hex_to_rgb01(h))
    L, a, b_ = linear_srgb_to_oklab(r, g, b)
    return L, math.hypot(a, b_), math.degrees(math.atan2(b_, a)) % 360

# ── Scale derivation ────────────────────────────────────────────────────
def derive_scale(anchor_500, light_extreme=0.946, dark_extreme=0.133, gamut_safe=True):
    """Build an 11-stop scale anchored at 500 = anchor."""
    aL, aC, aH = hex_to_oklch(anchor_500)
    L_vals = []
    for i in range(6):              # 50, 100, 200, 300, 400, 500
        t = i / 5.0
        L_vals.append(light_extreme + (aL - light_extreme) * (t ** 1.4))
    for i in range(1, 6):           # 600..950
        t = i / 5.0
        L_vals.append(aL + (dark_extreme - aL) * (t ** 1.1))

    C_REL = [0.20, 0.40, 0.65, 0.85, 0.97, 1.00, 0.95, 0.85, 0.65, 0.45, 0.25]
    peak_C = aC * 1.05
    out = {}
    for stop, L_, c_rel in zip(STOPS, L_vals, C_REL):
        if stop == 500:
            out[stop] = (anchor_500.upper(), (aL, aC, aH))
        else:
            C_ = peak_C * c_rel if anchor_500 != GRAY_500 else max(0.0015, 0.003*(1-abs(L_-0.5)*1.4))
            hex_, oklch = oklch_to_hex(L_, C_, aH)
            out[stop] = (hex_, oklch)
    return out

def derive_gray():
    """Gray uses 3-anchor curve: 50, 500, 950 from user."""
    fam = {}
    pre_500 = [
        (50,  "#ECEDEE"), (100, "#D2D4D5"), (200, "#A9ACAD"),
        (300, "#878A8C"), (400, "#666A6D"), (500, "#3F4447"),
    ]
    post_500 = [
        (600, "#32373A"), (700, "#262A2D"), (800, "#1B1F21"),
        (900, "#111416"), (950, "#070808"),
    ]
    for stop, hex_ in pre_500 + post_500:
        L, C, H = hex_to_oklch(hex_)
        fam[stop] = (hex_, (L, C, H))
    return fam

# ── Main: build all scales, then semantic mappings, then write outputs ─
def build_scales():
    scales = {"gray": derive_gray()}
    for name in ("blue", "red", "orange", "yellow", "green", "violet"):
        scales[name] = derive_scale(ANCHORS_500[name])
    return scales

def lch_str(LCH):
    L, C, H = LCH
    return f"{L*100:.1f}% {C:.3f} {H:.1f}"

# Per-mode semantic mappings — value is "scale-stop" key into scales
SEMANTIC_MAPS = {
    "dark": {
        "surface-canvas": ("gray", 950),
        "surface-1":      ("gray", 800),
        "surface-2":      ("gray", 700),
        "surface-3":      ("gray", 600),
        # surface-overlay handled separately (alpha)
        "fg-primary":     ("gray", 50),
        "fg-secondary":   ("gray", 200),
        "fg-tertiary":    ("gray", 300),
        "fg-disabled":    ("gray", 400),
        "fg-on-brand":    ("WHITE", None),
        "border-subtle":  ("gray", 700),
        "border-default": ("gray", 600),
        "border-strong":  ("gray", 400),
        "border-focus":   ("blue", 400),
        "brand":          ("blue", 500),
        "brand-hover":    ("blue", 400),
        "brand-active":   ("blue", 600),
        "status-info":    ("blue", 400),
        "status-success": ("green", 400),
        "status-warning": ("yellow", 500),
        "status-critical":("red", 500),
        "cot-friendly":   ("blue", 300),
        "cot-hostile":    ("red", 500),
        "cot-neutral":    ("yellow", 500),
        "cot-unknown":    ("gray", 200),
        "voice-active":   ("green", 400),
        "voice-listening":("blue", 400),
        "voice-muted":    ("gray", 300),
        "transport-wifi": ("blue", 400),
        "transport-ble":  ("violet", 400),
        "transport-relay":("yellow", 500),
        "transport-offline":("gray", 400),
    },
    "light": {
        "surface-canvas": ("gray", 50),
        "surface-1":      ("WHITE", None),
        "surface-2":      ("gray", 50),
        "surface-3":      ("WHITE", None),
        "fg-primary":     ("gray", 950),
        "fg-secondary":   ("gray", 700),
        "fg-tertiary":    ("gray", 500),
        "fg-disabled":    ("gray", 300),
        "fg-on-brand":    ("WHITE", None),
        "border-subtle":  ("gray", 100),
        "border-default": ("gray", 200),
        "border-strong":  ("gray", 500),
        "border-focus":   ("blue", 500),
        "brand":          ("blue", 600),
        "brand-hover":    ("blue", 500),
        "brand-active":   ("blue", 700),
        "status-info":    ("blue", 500),
        "status-success": ("green", 500),
        "status-warning": ("yellow", 600),
        "status-critical":("red", 600),
        "cot-friendly":   ("blue", 600),
        "cot-hostile":    ("red", 600),
        "cot-neutral":    ("yellow", 600),
        "cot-unknown":    ("gray", 400),
        "voice-active":   ("green", 500),
        "voice-listening":("blue", 500),
        "voice-muted":    ("gray", 500),
        "transport-wifi": ("blue", 500),
        "transport-ble":  ("violet", 600),
        "transport-relay":("yellow", 600),
        "transport-offline":("gray", 300),
    },
    "ld": {
        "surface-canvas": ("BLACK", None),
        "surface-1":      ("BLACK", None),
        "surface-2":      ("BLACK", None),
        "surface-3":      ("BLACK", None),
        "fg-primary":     ("red", 500),
        "fg-secondary":   ("red", 700),
        "fg-tertiary":    ("red", 800),
        "fg-disabled":    ("red", 900),
        "fg-on-brand":    ("BLACK", None),
        "border-subtle":  ("red", 950),
        "border-default": ("red", 800),
        "border-strong":  ("red", 700),
        "border-focus":   ("red", 400),
        "brand":          ("red", 500),
        "brand-hover":    ("red", 400),
        "brand-active":   ("red", 600),
        "status-info":    ("yellow", 500),
        "status-success": ("green", 400),
        "status-warning": ("yellow", 500),
        "status-critical":("red", 400),
        "cot-friendly":   ("green", 500),
        "cot-hostile":    ("red", 400),
        "cot-neutral":    ("yellow", 600),
        "cot-unknown":    ("red", 800),
        "voice-active":   ("yellow", 500),
        "voice-listening":("red", 500),
        "voice-muted":    ("red", 800),
        "transport-wifi": ("red", 500),
        "transport-ble":  ("yellow", 500),
        "transport-relay":("yellow", 400),
        "transport-offline":("red", 800),
    },
}

WHITE = "100% 0 0"
BLACK = "0% 0 0"

def resolve_var(scales, ref):
    name, stop = ref
    if name == "WHITE": return WHITE
    if name == "BLACK": return BLACK
    return lch_str(scales[name][stop][1])

def write_theme_css(mode, scales, mapping, out_path):
    lines = [
        f"/* GENERATED by scripts/generate-tokens.py — do not edit by hand. */",
        f"[data-theme=\"{mode}\"] {{",
    ]
    for token, ref in mapping.items():
        lines.append(f"  --color-{token}: oklch({resolve_var(scales, ref)});")
    # surface-overlay (alpha-bearing) — already in full oklch() form
    if mode == "dark":
        lines.append(f"  --color-surface-overlay: oklch(13.3% 0.002 196.9 / 0.7);")
    elif mode == "light":
        lines.append(f"  --color-surface-overlay: oklch(72% 0.002 220 / 0.5);")
    else:  # ld
        lines.append(f"  --color-surface-overlay: oklch(0% 0 0 / 0.85);")
    lines.append("}")
    out_path.write_text("\n".join(lines) + "\n")

def write_tokens_json(scales, semantic_maps, out_path):
    data = {
        "scales": {
            name: {
                str(stop): {
                    "hex": hex_,
                    "oklch": f"oklch({lch_str(oklch)})",
                    "L": round(oklch[0]*100, 2),
                    "C": round(oklch[1], 4),
                    "H": round(oklch[2], 2),
                }
                for stop, (hex_, oklch) in fam.items()
            }
            for name, fam in scales.items()
        },
        "semantic": semantic_maps,
    }
    out_path.write_text(json.dumps(data, indent=2) + "\n")

def write_tokens_css(scales, out_path):
    """Emit the v4 @theme block (DTAK tokens + shadcn aliases + radius)
    and @utility rules. Dark-theme values are used as defaults; per-theme
    CSS files override --color-X vars at render time via [data-theme] selectors."""
    lines = [
        "/* GENERATED by scripts/generate-tokens.py — do not edit by hand. */",
        "",
        "@theme {",
        "  /* DTAK semantic tokens — dark-theme defaults.",
        "     Per-theme CSS files (themes/{dark,light,low-detection}.css) override",
        "     these via [data-theme=\"X\"] selectors. The declarations here register",
        "     the Tailwind utility (e.g., bg-surface-canvas) for v4. */",
    ]
    # Emit DTAK tokens (using dark values as defaults)
    for token, ref in SEMANTIC_MAPS["dark"].items():
        lines.append(f"  --color-{token}: oklch({resolve_var(scales, ref)});")
    # surface-overlay (alpha-bearing)
    lines.append(f"  --color-surface-overlay: oklch(13.3% 0.002 196.9 / 0.7);")
    lines.append("")
    lines.append("  /* shadcn aliases — each maps to a DTAK semantic token whose value")
    lines.append("     is set per-theme above. */")
    aliases = [
        ("background",            "surface-canvas"),
        ("foreground",            "fg-primary"),
        ("card",                  "surface-1"),
        ("card-foreground",       "fg-primary"),
        ("popover",               "surface-2"),
        ("popover-foreground",    "fg-primary"),
        ("primary",               "brand"),
        ("primary-foreground",    "fg-on-brand"),
        ("secondary",             "surface-2"),
        ("secondary-foreground",  "fg-primary"),
        ("muted",                 "surface-2"),
        ("muted-foreground",      "fg-tertiary"),
        ("accent",                "surface-3"),
        ("accent-foreground",     "fg-primary"),
        ("destructive",           "status-critical"),
        ("destructive-foreground","fg-on-brand"),
        ("border",                "border-default"),
        ("input",                 "border-default"),
        ("ring",                  "border-focus"),
    ]
    for alias, target in aliases:
        lines.append(f"  --color-{alias}: var(--color-{target});")
    lines.append("")
    lines.append("  --radius:    0.375rem;")
    lines.append("  --radius-lg: var(--radius);")
    lines.append("  --radius-md: calc(var(--radius) - 2px);")
    lines.append("  --radius-sm: calc(var(--radius) - 4px);")
    lines.append("}")
    lines.append("")
    lines.append("@utility min-h-touch {")
    lines.append("  min-height: 44px;")
    lines.append("}")
    lines.append("")
    lines.append("[data-theme=\"ld\"] .min-h-touch {")
    lines.append("  min-height: 48px;")
    lines.append("}")
    out_path.write_text("\n".join(lines) + "\n")

def main():
    scales = build_scales()
    styles_dir = REPO / "web" / "src" / "styles"
    themes_dir = styles_dir / "themes"
    themes_dir.mkdir(parents=True, exist_ok=True)
    for mode, mapping in SEMANTIC_MAPS.items():
        write_theme_css(
            mode, scales, mapping,
            themes_dir / f"{'low-detection' if mode == 'ld' else mode}.css",
        )
    write_tokens_json(scales, SEMANTIC_MAPS, styles_dir / "tokens.json")
    write_tokens_css(scales, styles_dir / "tokens.css")
    print("✓ Generated:")
    print(f"  {themes_dir / 'dark.css'}")
    print(f"  {themes_dir / 'light.css'}")
    print(f"  {themes_dir / 'low-detection.css'}")
    print(f"  {styles_dir / 'tokens.json'}")
    print(f"  {styles_dir / 'tokens.css'}")

if __name__ == "__main__":
    main()
