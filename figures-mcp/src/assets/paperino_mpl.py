# paperino-mpl v3.0
"""Machine-owned style module for Figure Studio's matplotlib engine.

Vendored per workspace and refreshed when the version marker on line 1 differs, exactly
like tokens.css. Do not edit it inside a workspace: figure_scaffold overwrites it.

figure.py never sets an rcParam and never opens data.json. Two rcParams in particular are
owned here because getting them wrong fails SILENTLY:

  svg.fonttype = "none"  -- the default ("path") OUTLINES text into <path> elements. The
                            lint manifest is built by walking text nodes in Chromium, so
                            an outlined figure measures as having no text at all: overlap,
                            contrast, the 7pt floor, the font allowlist and PROVENANCE
                            would every one of them pass vacuously.
  pdf.fonttype = 42      -- Type 3 fonts are rejected outright by IEEE, ACM and Elsevier.
"""

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

_DIR = os.environ["PAPERINO_FIG_DIR"]
_NAME = os.environ["PAPERINO_FIG_NAME"]
# Spelled with spaces on purpose. matplotlib normalizes font.family to the name recorded
# INSIDE the font file, so asking for "TeXGyreTermes" still emits 'TeX Gyre Termes' in the
# SVG -- and tokens.css must declare that same spelling or Chromium silently substitutes a
# system serif. Same string on both sides, or the two engines drift without an error.
_FACE = os.environ.get("PAPERINO_FIG_FACE", "TeX Gyre Termes")
_MATH = os.environ.get("PAPERINO_FIG_MATH", "stix")
_FONTS = os.environ.get("PAPERINO_FIG_FONTS", "")
_INCHES = json.loads(os.environ.get("PAPERINO_FIG_INCHES", '{"narrow": 3.25, "full": 5.5}'))

# Register the vendored faces so the SVG names the same family the browser resolves from
# tokens.css. Without this matplotlib falls back to DejaVu Serif and rule 13 fails.
# .otf is listed first because Termes ships as OTF: its outlines are CFF, FreeType reads
# that natively, and converting to glyf would re-outline every glyph for nothing.
if _FONTS and os.path.isdir(_FONTS):
    for entry in sorted(os.listdir(_FONTS)):
        if entry.lower().endswith((".otf", ".ttf")):
            font_manager.fontManager.addfont(os.path.join(_FONTS, entry))

# The ink. Mirrors tokens.css so the two engines cannot drift; a raw hex typed into
# figure.py is lint rule 5.
INK = "#111111"
MUTED = "#555555"
GRID = "#999999"
ACCENT = "#1a4f9c"
ACCENT_WARM = "#b03a2e"

plt.rcParams.update(
    {
        "svg.fonttype": "none",
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "font.family": _FACE,
        "mathtext.fontset": _MATH,
        # 9pt body at the 96dpi print mapping. Lint rule 3 hard-fails below 7pt, and a
        # figure is authored print-true rather than drawn large and scaled down, so these
        # are the sizes that reach the page. Nothing here may go below 7.
        "font.size": 9,
        "axes.labelsize": 9,
        "axes.titlesize": 9,
        "xtick.labelsize": 8,
        "ytick.labelsize": 8,
        "legend.fontsize": 8,
        # Strokes: lint rule 6 floors every stroke at 0.75px, and matplotlib's linewidths
        # reach it ONE-TO-ONE. getComputedStyle().strokeWidth reports the SVG user-unit
        # value without applying the viewBox scale, so a 0.7 linewidth measures as 0.7px
        # and fails -- there is no 1.333 pt-to-px conversion to hide behind. Nothing here
        # may go below 0.8; a hairline thinner than that also drops out on real paper.
        "axes.linewidth": 0.8,
        "xtick.major.width": 0.8,
        "ytick.major.width": 0.8,
        "xtick.minor.width": 0.8,
        "ytick.minor.width": 0.8,
        "lines.linewidth": 1.3,
        "lines.markersize": 4.0,
        # Warm first: it is the more salient of the two accents, and a one-series figure
        # should get the colour the eye lands on. Both survive grayscale.
        "axes.prop_cycle": plt.cycler(color=[ACCENT_WARM, ACCENT, MUTED, INK]),
        "axes.grid": True,
        "axes.grid.axis": "y",
        "grid.color": GRID,
        # 0.8 for the same reason as the axis strokes; alpha keeps it visually a hairline
        # without putting the measured width under the floor.
        "grid.linewidth": 0.8,
        "grid.alpha": 0.5,
        # Paper idiom: two rules, not a box.
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.edgecolor": INK,
        "text.color": INK,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.unicode_minus": True,
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
        "legend.frameon": False,
        # Bar and marker edges are strokes too, and the default 1.0 is fine — but an
        # explicit floor keeps a future edgecolor tweak from sliding under rule 6.
        "patch.linewidth": 0.8,
    }
)


def data():
    """The figure's numbers. The ONLY sanctioned source: lint rule 8 requires every number
    rendered as ink to trace back to a value reachable in this file."""
    # utf-8-sig, not utf8: this is Windows, and any editor that saves data.json with a BOM
    # would otherwise blow up in json.load with a decode error that reads like corruption.
    # utf-8-sig strips a BOM if present and is identical to utf8 when it is not.
    with open(os.path.join(_DIR, "data.json"), encoding="utf-8-sig") as fh:
        return json.load(fh)


def figure(width="full", panels=1, ratios=None, height=None):
    """A print-true figure.

    `width` is "narrow" (one column) or "full" (text width); the inches behind those names
    come from the workspace's venue, so the same call yields 7.16in in an IEEE paper and
    5.5in in a NeurIPS one. Always returns a LIST of axes, so unpacking is uniform:

        fig, (ax,) = figure("narrow")
        fig, (a, b) = figure("full", panels=2, ratios=[1, 1.35])
    """
    if width not in _INCHES:
        raise ValueError(f"width must be one of {sorted(_INCHES)}, got {width!r}")
    inches = _INCHES[width]
    # The default aspect has to know how many panels it is dividing, or a full-width figure
    # comes out squat: one panel at 7.16in wide needs ~4.3in of height to read, while two
    # side by side each get half the width and want ~2.9in total. A single flat factor gave
    # a 2.4:1 letterbox that looked stretched at every size.
    if height is None:
        height = inches * (0.60 if panels == 1 else 0.40)
    fig, axes = plt.subplots(
        1,
        panels,
        figsize=(inches, height),
        gridspec_kw={"width_ratios": ratios} if ratios else None,
    )
    return fig, (list(axes) if panels > 1 else [axes])


def save(fig):
    """Emit the three artifacts the pipeline expects. The SVG is what lint measures; the
    PDF is what LaTeX includes; the PNG is what the vision review looks at."""
    fig.tight_layout(pad=0.3)
    build = os.path.join(_DIR, "build")
    os.makedirs(build, exist_ok=True)
    for ext in ("svg", "pdf", "png"):
        fig.savefig(
            os.path.join(build, f"{_NAME}.{ext}"),
            dpi=600 if ext == "png" else None,
            bbox_inches="tight",
            pad_inches=0.02,
        )
