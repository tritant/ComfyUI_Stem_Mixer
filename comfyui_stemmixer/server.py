"""
Custom HTTP routes for the StemMixer node.

Adds an upload endpoint for stems. Audio playback uses ComfyUI's native /view
endpoint, no GET route needed here.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from typing import Any

from aiohttp import web

import folder_paths
from server import PromptServer


SUBFOLDER = "stem_mixer"
ALLOWED_EXT = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aiff", ".aif"}
MAX_BYTES = 500 * 1024 * 1024  # 500 MB per file


def _safe_stem(name: str) -> str:
    """Strip path components and dangerous chars from a filename stem."""
    base = os.path.basename(name)
    stem, _ = os.path.splitext(base)
    stem = re.sub(r"[^A-Za-z0-9_\-]", "_", stem)
    return stem[:64] or "stem"


def _stem_dir() -> str:
    d = os.path.join(folder_paths.get_input_directory(), SUBFOLDER)
    os.makedirs(d, exist_ok=True)
    return d


async def _upload_stem(request: web.Request) -> web.Response:
    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "file":
        return web.json_response(
            {"error": "Expected multipart field 'file'"}, status=400
        )

    original = field.filename or "stem.wav"
    ext = os.path.splitext(original)[1].lower()
    if ext not in ALLOWED_EXT:
        return web.json_response(
            {"error": f"Unsupported extension: {ext}"}, status=400
        )

    stem = _safe_stem(original)
    unique = f"{stem}_{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"
    out_path = os.path.join(_stem_dir(), unique)

    size = 0
    with open(out_path, "wb") as f:
        while True:
            chunk = await field.read_chunk(64 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                f.close()
                try:
                    os.remove(out_path)
                except OSError:
                    pass
                return web.json_response(
                    {"error": f"File exceeds {MAX_BYTES} bytes"}, status=413
                )
            f.write(chunk)

    # Filename ComfyUI's /view will serve, and that we'll store in the state.
    rel = f"{SUBFOLDER}/{unique}"

    # /view URL for the JS to feed WaveSurfer.
    view_url = f"/view?filename={unique}&type=input&subfolder={SUBFOLDER}"

    return web.json_response({
        "filename": rel,
        "url": view_url,
        "size": size,
        "original_name": original,
    })


def register_routes() -> None:
    """Attach our routes to the running PromptServer aiohttp app."""
    server = PromptServer.instance
    server.routes.post("/stem_mixer/upload")(_upload_stem)
