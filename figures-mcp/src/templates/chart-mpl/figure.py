"""Replace this with the figure. The rules lint enforces, so read them first:

  * Every number that appears as INK must come from data(). A literal typed into a label
    is lint rule 8, and rule 8 is the reason this subsystem exists. Axis tick labels are
    exempt automatically -- they are computed, and matplotlib marks them as such.
  * Colours come from the module: ACCENT, ACCENT_WARM, MUTED, GRID, INK. A raw hex here
    is lint rule 5.
  * Never set an rcParam and never call savefig yourself. figure() owns the print-true
    size for this paper's venue, and save() owns the SVG text mode and Type-42 embedding
    -- both fail silently if you override them.
  * Name anything you may want to patch later: line.set_gid("series-keys") becomes an id
    in the SVG, and lint reports against that selector.

You have matplotlib's whole vocabulary here: log scales, fill_between bands, markers,
axhline references, annotate arrows, twin axes, multi-panel. Use it.
"""

from paperino_mpl import ACCENT, ACCENT_WARM, data, figure, save

d = data()

# figure("narrow") for one column, figure("full") for text width. panels=2 with
# ratios=[1, 1.35] gives two panels of unequal width.
fig, (ax,) = figure("full")

ax.plot(d["x"], d["y"], marker="o", color=ACCENT, label="replace me")
ax.set_xlabel("replace me")
ax.set_ylabel("replace me")
ax.legend()

save(fig)
