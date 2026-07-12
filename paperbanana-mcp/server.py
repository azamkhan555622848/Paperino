"""PaperBanana as an MCP stdio server.

Drives the existing PaperBanana pipeline (Planner -> Stylist -> Visualizer -> Critic)
without touching its internals. We deliberately do NOT import demo.py: that module
imports streamlit and gradio at the top, which a headless server has no use for. The
same pipeline objects it builds are constructed here instead.

Models are PINNED and never inherited from the chat session (umbrella spec, 3.2), so a figure
looks and costs the same whichever model the user is chatting with. Nano Banana does the image
synthesis; a vision-INPUT VLM backs the Critic, which must SEE the rendered candidate.

The key comes from whichever provider the user connected in onboarding — OpenRouter or Google
direct — and that choice also decides the id shape and the endpoint. PaperBanana needs no patch
for either: its router auto-detects (OpenRouter > Gemini) and the Visualizer falls back to native
Gemini image generation when no OpenRouter client exists. See resolve_credentials().
"""

from __future__ import annotations

import base64
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

# In a packaged install the PaperBanana source lives in the app's resources, not beside
# this file, so the app passes PAPERBANANA_ROOT. Dev keeps working with no env at all.
PAPERBANANA = Path(
    os.environ.get("PAPERBANANA_ROOT") or (Path(__file__).resolve().parent.parent / "PaperBanana-main")
)
sys.path.insert(0, str(PAPERBANANA))

# (Nano Banana, Critic VLM) per key source. OpenRouter namespaces every model ("google/x");
# Google's own API takes the bare id and would not recognise the prefixed one. Same weights.
_MODELS = {
    "openrouter": ("google/gemini-3.1-flash-image-preview", "google/gemini-3.5-flash"),
    "google": ("gemini-3.1-flash-image-preview", "gemini-3.5-flash"),
}


def _extension(blob: bytes) -> str:
    """PaperBanana's result keys say jpg, but sniff rather than trust the key name."""
    if blob[:4] == b"\x89PNG":
        return ".png"
    if blob[:2] == b"\xff\xd8":
        return ".jpg"
    return ".bin"


@dataclass(frozen=True)
class Credentials:
    source: str  # "openrouter" | "google"
    key: str
    image_model: str
    vlm_model: str


def resolve_credentials(env: dict, auth: dict) -> Credentials:
    """Pick the figure-generation credential. Env beats the auth store; OpenRouter beats Google.

    Pure on purpose — the precedence rules ARE the behaviour, so they should be testable without
    an auth.json on disk. `auth` is a parsed auth.json: {"openrouter": {"key": "..."}, ...}.
    """

    def make(source: str, key: str) -> Credentials:
        image, vlm = _MODELS[source]
        # An explicit pin still wins, so a different image model can be tried without a code edit.
        return Credentials(
            source=source,
            key=key,
            image_model=env.get("PAPERINO_FIGURE_IMAGE_MODEL") or image,
            vlm_model=env.get("PAPERINO_FIGURE_VLM") or vlm,
        )

    if env.get("OPENROUTER_API_KEY"):
        return make("openrouter", env["OPENROUTER_API_KEY"])
    for name in ("GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"):
        if env.get(name):
            return make("google", env[name])
    for source in ("openrouter", "google"):
        key = (auth.get(source) or {}).get("key", "")
        if key:
            return make(source, key)
    raise RuntimeError(
        "No figure-generation key. Paste an OpenRouter key (openrouter.ai/keys) or a Google AI "
        "Studio key (aistudio.google.com/apikey) in Paperino's onboarding, or set "
        "OPENROUTER_API_KEY / GOOGLE_API_KEY."
    )


def _auth_store() -> dict:
    # The packaged app isolates its auth store inside its own userData (XDG_DATA_HOME) so it never
    # shares credentials with InteJer; dev falls back to the standard location.
    data_home = os.environ.get("XDG_DATA_HOME")
    base = Path(data_home) if data_home else Path.home() / ".local" / "share"
    auth = base / "opencode" / "auth.json"
    if not auth.exists():
        return {}
    try:
        return json.loads(auth.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def apply_credentials() -> Credentials:
    """Resolve, then shape the environment PaperBanana's client factory reads."""
    creds = resolve_credentials(dict(os.environ), _auth_store())
    if creds.source == "openrouter":
        os.environ["OPENROUTER_API_KEY"] = creds.key
    else:
        # OpenRouter wins PaperBanana's own auto-detection (generation_utils.call_model_with_retry
        # _async), so a stale OPENROUTER_API_KEY would route a Google user through OpenRouter
        # carrying a Google key — a 401 with the wrong provider's name on it.
        os.environ.pop("OPENROUTER_API_KEY", None)
        os.environ["GOOGLE_API_KEY"] = creds.key
    os.environ["IMAGE_GEN_MODEL_NAME"] = creds.image_model
    os.environ["MAIN_MODEL_NAME"] = creds.vlm_model
    return creds


def _build_processor(exp_mode: str, creds: Credentials):
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
        main_model_name=creds.vlm_model,
        image_gen_model_name=creds.image_model,
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
    # Resolve BEFORE importing PaperBanana: generation_utils builds its API clients at import
    # time from the environment, so the key and the model ids have to be in place first.
    creds = apply_credentials()
    from utils.legacy_generation_options import generation_additional_info, normalize_legacy_input_content
    from utils.legacy_ui_results import resolve_final_output

    exp_mode = "demo_planner_critic" if critic_rounds > 0 else "dev_planner"
    processor, _ = _build_processor(exp_mode, creds)

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
        creds = apply_credentials()
        images = await _generate(method_content, caption, aspect_ratio, candidates, critic_rounds)
        if not images:
            return (
                f"PaperBanana produced no image (every candidate failed). Check the {creds.source} "
                f"key and that it can reach {creds.image_model}."
            )

        paths = []
        for index, blob in enumerate(images):
            stem = name if index == 0 else f"{name}-candidate-{index}"
            path = out_dir / f"{stem}{_extension(blob)}"
            path.write_bytes(blob)
            paths.append(str(path))
        winner = Path(paths[0]).name
        return (
            f"generated {len(paths)} candidate(s) with {creds.image_model} via {creds.source}\n"
            + "\n".join(paths)
            + f"\n\nEmbed the winner: \\includegraphics[width=\\linewidth]{{figures/{name}/{winner}}}"
        )

    mcp.run()


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        # Offline: models pinned, key resolvable, pipeline importable without streamlit.
        creds = apply_credentials()
        processor, cfg = _build_processor("demo_planner_critic", creds)
        print(
            json.dumps(
                {
                    "key_source": creds.source,
                    "image_model": cfg.image_gen_model_name,
                    "vlm_model": cfg.main_model_name,
                    "processor": type(processor).__name__,
                }
            )
        )
    else:
        _serve()
