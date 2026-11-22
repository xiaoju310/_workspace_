"""Serve the single supported desktop UI; never fall back to retired code."""
from pathlib import Path

DESKTOP_FRONTENDS = ("frontend-wonderland",)


def resolve_desktop_frontend(project_root: Path, selected: str | None = None) -> Path:
    # Keep explicit validation: an old setting must not resurrect the retired UI.
    name = "frontend-wonderland" if selected is None else selected
    if name not in DESKTOP_FRONTENDS:
        raise RuntimeError("DESKTOP_FRONTEND must be frontend-wonderland; the legacy frontend is retired")
    dist = project_root / name / "dist"
    if not (dist / "index.html").is_file():
        raise RuntimeError(f"Build the desktop UI first: npm --prefix {name} run build")
    return dist
