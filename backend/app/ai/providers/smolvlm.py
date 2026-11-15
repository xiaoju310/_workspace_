from __future__ import annotations

from pathlib import Path

from PIL import Image


class SmolVLMProvider:
    """Local image understanding with HuggingFaceTB/SmolVLM-256M-Instruct."""

    version = "HuggingFaceTB/SmolVLM-256M-Instruct"

    def __init__(self, model_path: str | Path, device: str = "cpu") -> None:
        import torch
        from transformers import AutoProcessor, AutoModelForImageTextToText

        self.device = device
        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(model_path)
        self.model = AutoModelForImageTextToText.from_pretrained(
            model_path, dtype=torch.float32
        ).to(device).eval()

    def understand(self, image_path: Path, page_no: int, text: str):
        prompt = "Name the most prominent visible object. Answer in one to four words only."
        image = Image.open(image_path).convert("RGB")
        messages = [{"role": "user", "content": [
            {"type": "image"}, {"type": "text", "text": prompt}
        ]}]
        rendered = self.processor.apply_chat_template(messages, add_generation_prompt=True)
        inputs = self.processor(text=rendered, images=[image], return_tensors="pt").to(self.device)
        with self.torch.inference_mode():
            output = self.model.generate(**inputs, max_new_tokens=32, do_sample=False)
        response = self.processor.batch_decode(
            output[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True
        )[0]
        self.last_response = response.strip()
        if not self.last_response or len(self.last_response.split()) > 8:
            raise ValueError("VLM response was not a short object name")
        return [{"name": self.last_response.strip(" ."), "kind": "object",
                 "confidence": 0.5}], [], 0.5
