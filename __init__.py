"""
ComfyUI-StemMixer
A multitrack stem mixer node with interactive WaveSurfer UI.
"""

from .comfyui_stemmixer.nodes.audio_stem_mixer import AudioStemMixer
from .comfyui_stemmixer.server import register_routes

# Register custom HTTP routes (upload endpoint, etc.)
register_routes()

NODE_CLASS_MAPPINGS = {
    "AudioStemMixer": AudioStemMixer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AudioStemMixer": "Audio Stem Mixer 🎚️",
}

# Tells ComfyUI where to find our JS extension files
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
