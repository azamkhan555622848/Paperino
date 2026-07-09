"""PaperBanana as an MCP stdio server.

Drives the existing PaperBanana pipeline (Planner -> Stylist -> Visualizer -> Critic)
without touching its internals. We deliberately do NOT import demo.py: that module
imports streamlit and gradio at the top, which a headless server has no use for. The
same pipeline objects it builds are constructed here instead.

Models are PINNED and never inherited from the chat session (umbrella spec, 3.2).
PaperBanana resolves them from the environment:

  IMAGE_GEN_MODEL_NAME  google/gemini-3.1-flash-image-preview   ("Nano Banana")
  MAIN_MODEL_NAME       google/gemini-3.5-flash                 (vision-INPUT VLM; the
                                                                 Critic must see the
                                                                 rendered candidate)
  OPENROUTER_API_KEY    read from the opencode auth store

So a figure looks and costs the same whichever model the user is chatting with.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

PAPERBANANA = Path(__file__).resolve().parent.parent / "PaperBanana-main"
sys.path.insert(0, str(PAPERBANANA))

IMAGE_MODEL = os.environ.get("PAPERINO_FIGURE_IMAGE_MODEL", "google/gemini-3.1-flash-image-preview")
VLM_MODEL = os.environ.get("PAPERINO_FIGURE_VLM", "google/gemini-3.5-flash")

os.environ.setdefault("IMAGE_GEN_MODEL_NAME", IMAGE_MODEL)
os.environ.setdefault("MAIN_MODEL_NAME", VLM_MODEL)


def _extension(blob: bytes) -> str:
    """PaperBanana's result keys say jpg, but sniff rather than trust the key name."""
    if blob[:4] == b"\x89PNG":
        return ".png"
    if blob[:2] == b"\xff\xd8":
        return ".jpg"
    return ".bin"


def _openrouter_key() -> str:
    """PaperBanana reads OPENROUTER_API_KEY; opencode keeps it in its auth store."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key
    auth = Path.home() / ".local" / "share" / "opencode" / "auth.json"
    if auth.exists():
        data = json.loads(auth.read_text(encoding="utf-8"))
        key = (data.get("openrouter") or {}).get("key", "")
        if key:
            os.environ["OPENROUTER_API_KEY"] = key
            return key
    raise RuntimeError("no OpenRouter key: set OPENROUTER_API_KEY, or sign in to the openrouter provider in the app")


def _build_processor(exp_mode: str):
    """The object graph demo.py's process_parallel_candidates builds, minus the UI."""
    from agents.critic_agent import CriticAgent
    from agents.planner_agent import PlannerAgent
    from agents.polish_agent import PolishAgent
    from agents.retriever_agent import RetrieverAgent
    from agents.stylist_agent import StylistAgent
    from agents.vanilla_agent import VanillaAgent
    from agents.visualizer_agent import VisualizerAgent
    from utils import config
    from utils.paperviz_processor import PaperVizProcessor

    exp_config = config.ExpConfig(
        dataset_name="PaperBananaBench",
        task_name="diagram",
        split_name="demo",
        exp_mode=exp_mode,
        retrieval_setting="none",  # PaperBananaBench is not installed; no few-shot retrieval
        main_model_name=VLM_MODEL,
        image_gen_model_name=IMAGE_MODEL,
        work_dir=PAPERBANANA,
    )
    processor = PaperVizProcessor(
        exp_config=exp_config,
        vanilla_agent=VanillaAgent(exp_config=exp_config),
        planner_agent=PlannerAgent(exp_config=exp_config),
        visualizer_agent=VisualizerAgent(exp_config=exp_config),
        stylist_agent=StylistAgent(exp_config=exp_config),
        critic_agent=CriticAgent(exp_config=exp_config),
        retriever_agent=RetrieverAgent(exp_config=exp_config),
        polish_agent=PolishAgent(exp_config=exp_config),
    )
    return processor, exp_config


async def _generate(method_content: str, caption: str, aspect_ratio: str, candidates: int, critic_rounds: int):
    _openrouter_key()
    from utils.legacy_generation_options import generation_additional_info, normalize_legacy_input_content
    from utils.legacy_ui_results import resolve_final_output

    exp_mode = "demo_planner_critic" if critic_rounds > 0 else "dev_planner"
    processor, _ = _build_processor(exp_mode)

    base = {
        "filename": "paperino_input",
        "caption": caption,
        "content": normalize_legacy_input_content(method_content, "diagram"),
        "visual_intent": caption,
        "additional_info": generation_additional_info(aspect_ratio, None),
        "max_critic_rounds": critic_rounds,
        "task_name": "diagram",
    }
    inputs = []
    for i in range(candidates):
        item = base.copy()
        item["filename"] = f"paperino_candidate_{i}"
        item["candidate_id"] = i
        inputs.append(item)

    images: list[bytes] = []
    async for result in processor.process_queries_batch(inputs, max_concurrent=candidates, do_eval=False):
        key = resolve_final_output(result, exp_mode=exp_mode).image_key
        if key and key in result:
            images.append(base64.b64decode(result[key]))
    return images


def _serve() -> None:
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("paperbanana-mcp")

    @mcp.tool()
    async def generate_figure(
        workspace: str,
        name: str,
        method_content: str,
        caption: str,
        aspect_ratio: str = "16:9",
        candidates: int = 2,
        critic_rounds: int = 1,
    ) -> str:
        """Generate a figure as a rendered IMAGE using the PaperBanana multi-agent
        pipeline (Planner -> Stylist -> Visualizer -> Critic).

        Choose this for pictorial, illustrative or conceptual art. For schematics,
        card galleries, charts and tables, the figures-mcp tools are better: those
        produce vector PDFs, are linted, and bind numbers to data.json.

        Slow (a minute or more) and each candidate costs an image-generation call.
        Writes figures/<name>/<name>.jpg (plus -candidate-N) and returns the paths.
        Image synthesis always uses Nano Banana, whatever chat model you are.
        """
        out_dir = Path(workspace) / "figures" / name
        out_dir.mkdir(parents=True, exist_ok=True)
        images = await _generate(method_content, caption, aspect_ratio, candidates, critic_rounds)
        if not images:
            return "PaperBanana produced no image (every candidate failed). Check the OpenRouter key and model access."

        paths = []
        for index, blob in enumerate(images):
            stem = name if index == 0 else f"{name}-candidate-{index}"
            path = out_dir / f"{stem}{_extension(blob)}"
            path.write_bytes(blob)
            paths.append(str(path))
        winner = Path(paths[0]).name
        return (
            f"generated {len(paths)} candidate(s) with {IMAGE_MODEL}\n"
            + "\n".join(paths)
            + f"\n\nEmbed the winner: \\includegraphics[width=\\linewidth]{{figures/{name}/{winner}}}"
        )

    mcp.run()


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        # Offline: models pinned, key resolvable, pipeline importable without streamlit.
        _openrouter_key()
        processor, cfg = _build_processor("demo_planner_critic")
        print(
            json.dumps(
                {
                    "image_model": cfg.image_gen_model_name,
                    "vlm_model": cfg.main_model_name,
                    "processor": type(processor).__name__,
                }
            )
        )
    else:
        _serve()
