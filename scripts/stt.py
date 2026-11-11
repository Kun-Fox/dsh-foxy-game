#!/usr/bin/env python3
"""Local SenseVoice STT for dsh-foxy-game.

Reads a 16 kHz mono WAV file and prints {"text": "..."} on stdout.
Requires: pip install sherpa-onnx
"""
from __future__ import annotations

import argparse
import json
import sys
import wave
from array import array
from pathlib import Path

DEFAULT_DIR = Path.home() / ".dsh" / "speech-to-text" / "sensevoice" / "models" / "sensevoice-onnx"

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def read_wav(path: Path) -> tuple[int, array]:
    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 1:
            raise RuntimeError("SenseVoice input must be mono")
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())
    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder == "big":
        samples.byteswap()
    return rate, samples


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", required=True)
    parser.add_argument("--model", default=str(DEFAULT_DIR / "model.int8.onnx"))
    parser.add_argument("--tokens", default=str(DEFAULT_DIR / "tokens.txt"))
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()

    try:
        import sherpa_onnx
    except Exception as exc:  # pragma: no cover
        print(f"sherpa-onnx is not available: {exc}", file=sys.stderr)
        return 2

    model = Path(args.model)
    tokens = Path(args.tokens)
    if not model.is_file() or not tokens.is_file():
        print(f"model or tokens not found: {model} / {tokens}", file=sys.stderr)
        return 2

    rate, samples = read_wav(Path(args.wav))
    if rate != 16000:
        print(f"expected 16 kHz wav, got {rate}", file=sys.stderr)
        return 2
    if not samples:
        print(json.dumps({"text": ""}, ensure_ascii=False))
        return 0

    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model),
        tokens=str(tokens),
        num_threads=max(1, args.threads),
        use_itn=True,
        language=args.language,
        debug=False,
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(rate, [s / 32768.0 for s in samples])
    recognizer.decode_stream(stream)
    print(json.dumps({"text": (stream.result.text or "").strip()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
