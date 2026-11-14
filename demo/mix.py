import json
import os
import re
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from scipy.io import wavfile


SAMPLE_RATE = 44_100
BPM = 112
BAR_SECONDS = 60 / BPM * 4
BARS = 40
DURATION = BARS * BAR_SECONDS
FRAME_COUNT = round(DURATION * SAMPLE_RATE)
TARGET_I = -14
TARGET_TP = -1.5

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out" / "mix.wav"
AUDIO_DIR = Path(os.environ.get("DEMO_AUDIO_DIR", "/home/ubuntu/demo/audio")).expanduser()
OUT.parent.mkdir(parents=True, exist_ok=True)


def read_stereo(path):
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frame_count = wav.getnframes()
        if sample_width != 2 or sample_rate != SAMPLE_RATE:
            raise ValueError(f"{path}: expected 44.1 kHz 16-bit PCM")
        samples = np.frombuffer(wav.readframes(frame_count), dtype="<i2")
    samples = samples.reshape(-1, channels).astype(np.float32) / 32768.0
    if channels == 1:
        samples = np.repeat(samples, 2, axis=1)
    elif channels > 2:
        samples = samples[:, :2]
    return samples


def add_cue(mix, name, at_seconds, reference_peak, peak_db=-6):
    source = read_stereo(AUDIO_DIR / f"{name}.wav")
    source_peak = float(np.max(np.abs(source)))
    if source_peak == 0:
        return
    target_peak = reference_peak * 10 ** (peak_db / 20)
    gain = target_peak / source_peak
    start = round(at_seconds * SAMPLE_RATE)
    if start >= len(mix):
        return
    count = min(len(source), len(mix) - start)
    mix[start:start + count] += source[:count] * gain


def run_loudnorm(path):
    command = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
        "-af", f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, flags=re.DOTALL)
    if not matches:
        raise RuntimeError(f"ffmpeg loudnorm did not return measurements:\n{result.stderr}")
    return json.loads(matches[-1])


def main():
    music_path = AUDIO_DIR / "music.wav"
    music = read_stereo(music_path)
    music_peak = float(np.max(np.abs(music[:FRAME_COUNT])))
    if music_peak == 0:
        raise ValueError(f"{music_path}: music is silent")

    mix = np.zeros((FRAME_COUNT, 2), dtype=np.float32)
    count = min(FRAME_COUNT, len(music))
    mix[:count] = music[:count]

    duck = np.ones(FRAME_COUNT, dtype=np.float32)
    duck_start = round(66.43 * SAMPLE_RATE)
    duck_end = round(68.57 * SAMPLE_RATE)
    ramp = round(0.1 * SAMPLE_RATE)
    duck_level = 10 ** (-5 / 20)
    duck[duck_start:duck_start + ramp] = np.linspace(1, duck_level, ramp, endpoint=False)
    duck[duck_start + ramp:duck_end - ramp] = duck_level
    duck[duck_end - ramp:duck_end] = np.linspace(duck_level, 1, ramp, endpoint=True)
    mix *= duck[:, None]

    cue_groups = {
        "whoosh": [6.429, 15.0, 17.143, 19.286, 21.429, 23.571, 27.857, 45.0, 49.286, 53.571, 57.857, 68.571, 77.143],
        "pop": [0.5, 7.6, 10.83, 15.1, 17.24, 19.39, 21.53, 28.15, 74.0, 77.44],
        "coin": [30.66, 35.56],
        "gull": [45.15, 46.2],
        "thunder": [49.39],
        "kaching": [53.67, 54.7, 78.0],
        "scratch": [57.86],
        "boing": [68.97],
        "tick": [40.7, 40.85, 41.0],
    }
    for name, cue_times in cue_groups.items():
        peak_db = 0 if name == "thunder" else -6
        for cue_time in cue_times:
            add_cue(mix, name, cue_time, music_peak, peak_db)

    fade_frames = round(1.8 * SAMPLE_RATE)
    fade_start = FRAME_COUNT - fade_frames
    mix[fade_start:] *= np.linspace(1, 0, fade_frames, endpoint=True, dtype=np.float32)[:, None]

    with tempfile.TemporaryDirectory(prefix=".mix-", dir=OUT.parent) as temp_dir:
        temp_dir = Path(temp_dir)
        raw_path = temp_dir / "premix.wav"
        normalized_path = temp_dir / "normalized.wav"
        wavfile.write(raw_path, SAMPLE_RATE, mix.astype(np.float32))

        measured = run_loudnorm(raw_path)
        loudnorm = (
            f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA=11:"
            f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
            f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
            f"offset={measured['target_offset']}:linear=true:print_format=json"
        )
        subprocess.run([
            "ffmpeg", "-hide_banner", "-nostats", "-y", "-i", str(raw_path),
            "-af", loudnorm, "-t", f"{DURATION:.12f}", "-ar", str(SAMPLE_RATE), "-ac", "2",
            "-c:a", "pcm_s16le", str(normalized_path),
        ], check=True, capture_output=True, text=True)

        rate, normalized = wavfile.read(normalized_path)
        if rate != SAMPLE_RATE:
            raise RuntimeError(f"ffmpeg output sample rate was {rate}, expected {SAMPLE_RATE}")
        if normalized.ndim != 2 or normalized.shape[1] != 2 or normalized.dtype != np.int16:
            raise RuntimeError("ffmpeg did not produce stereo 16-bit PCM")
        exact = np.zeros((FRAME_COUNT, 2), dtype=np.int16)
        exact[:min(FRAME_COUNT, len(normalized))] = normalized[:FRAME_COUNT]
        wavfile.write(OUT, SAMPLE_RATE, exact)

    final = run_loudnorm(OUT)
    with wave.open(str(OUT), "rb") as wav:
        frames = wav.getnframes()
        duration = frames / wav.getframerate()
    print(f"Wrote {OUT}")
    print(f"Duration: {duration:.6f} s ({frames} frames, {BARS} bars at {BPM} BPM)")
    print(f"Integrated loudness: {float(final['input_i']):.1f} LUFS")
    print(f"True peak: {float(final['input_tp']):.1f} dBTP")


if __name__ == "__main__":
    main()
