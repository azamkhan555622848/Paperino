"""Live smoke test: one candidate, no critic rounds. Costs one image-generation call.

Run: .venv\\Scripts\\python.exe smoke_test.py
Writes fixtures/demo-paper/figures/fig-banana-smoke/fig-banana-smoke.jpg
"""

import asyncio
from pathlib import Path

from server import IMAGE_MODEL, _extension, _generate

WORKSPACE = Path(__file__).resolve().parent.parent / "fixtures" / "demo-paper"
NAME = "fig-banana-smoke"

METHOD = (
    "Our pipeline compiles a LaTeX manuscript, renders it to PDF, and shows it in a preview panel. "
    "A watcher recompiles on every save, and compile errors are surfaced with file and line."
)
CAPTION = "Overview of the Paperino compile-and-preview loop."


async def main() -> None:
    images = await _generate(METHOD, CAPTION, aspect_ratio="16:9", candidates=1, critic_rounds=0)
    print(f"candidates returned: {len(images)}")
    if not images:
        raise SystemExit("FAIL: no image produced")
    out_dir = WORKSPACE / "figures" / NAME
    out_dir.mkdir(parents=True, exist_ok=True)
    extension = _extension(images[0])
    path = out_dir / f"{NAME}{extension}"
    path.write_bytes(images[0])
    print(f"model: {IMAGE_MODEL}")
    print(f"wrote: {path} ({len(images[0])} bytes)")
    print("recognised image format:", extension != ".bin")


if __name__ == "__main__":
    asyncio.run(main())
