import json
import math
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter


ROOT = os.path.abspath(os.path.expanduser(os.environ.get("DEMO_AUDIO_DIR", "/home/ubuntu/demo/audio")))
SR = 44_100
BPM = 112
BEAT = 60 / BPM
BAR = BEAT * 4
FINAL_HIT = 45 * BAR
DURATION = FINAL_HIT + 2.05
N = int(round(DURATION * SR))
RNG = np.random.default_rng(20260603)
os.makedirs(ROOT, exist_ok=True)

lead = np.zeros((N, 2), dtype=np.float32)
bass = np.zeros_like(lead)
pad = np.zeros_like(lead)
drums = np.zeros_like(lead)
ambience = np.zeros_like(lead)

PITCH = {"D": 0, "F": 3, "G": 5, "A": 7, "C": 10}
PENT = [0, 3, 5, 7, 10]
NOTE = 293.6648


def midi_hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def add(bus, at, signal, pan=0.5, gain=1.0):
    start = max(0, int(round(at * SR)))
    if start >= len(bus):
        return
    signal = np.asarray(signal, dtype=np.float32)
    length = min(len(signal), len(bus) - start)
    if length <= 0:
        return
    if signal.ndim == 1:
        left = math.sqrt(1 - pan)
        right = math.sqrt(pan)
        bus[start:start + length, 0] += signal[:length] * (left * gain)
        bus[start:start + length, 1] += signal[:length] * (right * gain)
    else:
        bus[start:start + length] += signal[:length] * gain


def envelope(n, attack=0.005, release=0.08):
    x = np.ones(n, dtype=np.float32)
    a = min(n, int(attack * SR))
    r = min(n, int(release * SR))
    if a:
        x[:a] = np.linspace(0, 1, a, endpoint=False, dtype=np.float32)
    if r:
        x[-r:] *= np.linspace(1, 0, r, dtype=np.float32)
    return x


def k_s_string(freq, duration, seed_rng):
    count = max(64, int(duration * SR))
    delay = max(2, int(SR / freq))
    wave = np.zeros(count, dtype=np.float32)
    wave[:delay] = seed_rng.uniform(-1, 1, delay).astype(np.float32)
    for i in range(count - delay):
        wave[i + delay] = 0.498 * (wave[i] + wave[i + 1])
    wave *= np.exp(-np.arange(count, dtype=np.float32) / (SR * max(0.13, duration * 0.9)))
    wave *= envelope(count, 0.001, min(0.12, duration * 0.3))
    return np.tanh(wave * 1.35).astype(np.float32)


def pluck(at, pitch, duration=0.36, velocity=0.13, tense=0):
    f = NOTE * 2 ** ((pitch + tense) / 12)
    left = k_s_string(f * 0.9972, duration, RNG)
    right = k_s_string(f * 1.0031, duration, RNG)
    # A tiny nail transient keeps the attack woody rather than synthetic.
    transient_n = min(len(left), int(0.014 * SR))
    if transient_n:
        trans = RNG.normal(0, 0.12, transient_n).astype(np.float32)
        left[:transient_n] += trans
        right[:transient_n] += trans[::-1]
    stereo = np.column_stack((left * 0.78, right * 0.78))
    add(lead, at, stereo, gain=velocity)


def pad_note(at, midi, duration, velocity=0.035):
    count = max(1, int(duration * SR))
    t = np.arange(count, dtype=np.float32) / SR
    freq = midi_hz(midi)
    amp = np.minimum(1, t / 0.48) * np.minimum(1, (duration - t) / 0.5)
    amp = np.maximum(0, amp)
    left = (np.sin(2 * np.pi * freq * t) + 0.22 * np.sin(4 * np.pi * freq * t)) * amp
    right = (np.sin(2 * np.pi * freq * 1.003 * t + 0.08) + 0.22 * np.sin(4 * np.pi * freq * 1.003 * t)) * amp
    add(pad, at, np.column_stack((left, right)), gain=velocity)


def bass_note(at, midi, duration=0.38, velocity=0.14):
    count = max(1, int(duration * SR))
    t = np.arange(count, dtype=np.float32) / SR
    f = midi_hz(midi)
    phase = (t * f) % 1
    triangle = 2 * np.abs(2 * phase - 1) - 1
    sig = (0.76 * np.sin(2 * np.pi * f * t) + 0.24 * triangle) * np.exp(-t * 5.1)
    sig *= envelope(count, 0.008, min(0.12, duration * 0.35))
    add(bass, at, np.tanh(sig * 1.15), pan=0.48, gain=velocity)


def kick(at, gain=0.19, weight=1.0):
    duration = 0.25 * weight
    count = int(duration * SR)
    t = np.arange(count, dtype=np.float32) / SR
    f = 45 + 105 * np.exp(-t * 24)
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(phase) * np.exp(-t * 17)
    click_n = min(count, int(0.012 * SR))
    sig[:click_n] += RNG.normal(0, 0.08, click_n) * np.linspace(1, 0, click_n)
    add(drums, at, np.tanh(sig), gain=gain)


def snare(at, gain=0.095, weight=1.0):
    duration = 0.22 * weight
    count = int(duration * SR)
    t = np.arange(count, dtype=np.float32) / SR
    noise = RNG.normal(0, 1, count).astype(np.float32)
    # Band-limited, papery noise over a short drum-body tone.
    noise = lfilter(*butter(2, [900, 9000], btype="bandpass", fs=SR), noise).astype(np.float32)
    noise /= max(1e-6, np.max(np.abs(noise)))
    body = np.sin(2 * np.pi * (180 - 75 * t) * t) * np.exp(-t * 24)
    sig = (0.75 * noise * np.exp(-t * 19) + 0.25 * body) * np.minimum(1, t * 900)
    add(drums, at, np.tanh(sig), gain=gain)


def shaker(at, gain=0.025, duration=0.055):
    count = int(duration * SR)
    t = np.arange(count, dtype=np.float32) / SR
    noise = RNG.normal(0, 1, count).astype(np.float32)
    noise = lfilter(*butter(1, 5500, btype="highpass", fs=SR), noise).astype(np.float32)
    noise /= max(1e-6, np.max(np.abs(noise)))
    add(drums, at, noise * np.exp(-t * 48), gain=gain)


def tom(at, midi=43, gain=0.12):
    count = int(0.28 * SR)
    t = np.arange(count, dtype=np.float32) / SR
    f = midi_hz(midi) + 34 * np.exp(-t * 11)
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(phase) * np.exp(-t * 11)
    sig += 0.1 * RNG.normal(0, 1, count) * np.exp(-t * 42)
    add(drums, at, np.tanh(sig), gain=gain)


def tick(at, gain=0.022):
    count = int(0.024 * SR)
    t = np.arange(count, dtype=np.float32) / SR
    sig = RNG.normal(0, 1, count).astype(np.float32) * np.exp(-t * 180)
    add(drums, at, sig, gain=gain)


def sea(at, duration):
    count = int(duration * SR)
    noise = RNG.normal(0, 1, count).astype(np.float32)
    filtered = lfilter(*butter(2, 850, btype="lowpass", fs=SR), noise).astype(np.float32)
    filtered /= max(1e-6, np.max(np.abs(filtered)))
    t = np.arange(count, dtype=np.float32) / SR
    swell = 0.42 + 0.22 * np.sin(2 * np.pi * 0.12 * t) + 0.09 * np.sin(2 * np.pi * 0.31 * t + 1)
    filtered *= swell * np.minimum(1, t / 1.2) * np.minimum(1, (duration - t) / 0.8)
    stereo = np.column_stack((filtered, np.roll(filtered, int(0.011 * SR))))
    add(ambience, at, stereo, gain=0.045)


def riff(bar_index, start, tense=0, octave=0):
    main = [0, 3, 5, 7, 10, 7, 5, 3]
    answer = [0, 5, 7, 10, 7, 5, 3, 0]
    motif = main if bar_index % 2 == 0 else answer
    eighth = BEAT / 2
    for i, p in enumerate(motif):
        pluck(start + i * eighth, 62 + p + octave, duration=0.38, velocity=0.105 if octave else 0.125, tense=tense)


def chord_for(bar):
    roots = [50, 48, 55, 50]  # D, C, G, D
    return roots[((bar - 1) // 2) % len(roots)]


def add_pad_bar(bar, level=1.0, length=BAR):
    start = (bar - 1) * BAR
    root = chord_for(bar)
    for note in (root, root + 3, root + 7, root + 12):
        pad_note(start, note, length + 0.2, velocity=0.026 * level if note < root + 12 else 0.018 * level)


for bar_no in range(1, 46):
    start = (bar_no - 1) * BAR
    section = (
        "intro" if bar_no <= 4 else
        "entry" if bar_no <= 8 else
        "full" if bar_no <= 14 else
        "tutorial" if bar_no <= 24 else
        "chaos" if bar_no <= 31 else
        "pitch" if bar_no <= 37 else
        "finale"
    )
    pad_level = 1.0 if section in ("intro", "pitch") else 0.66
    if section == "finale":
        pad_level = 0.82
    add_pad_bar(bar_no, pad_level)

    if section == "intro":
        if bar_no == 1:
            sea(0, 8.57)
        if bar_no in (1, 3):
            pluck(start + 0.18, 62, duration=0.8, velocity=0.13)
            pluck(start + 1.15, 69, duration=0.64, velocity=0.11)
        else:
            pluck(start + 0.7, 67 if bar_no == 2 else 65, duration=0.52, velocity=0.09)
        continue

    if section == "entry":
        for beat in (0, 2):
            kick(start + beat * BEAT, gain=0.15)
        for eighth in range(8):
            shaker(start + eighth * BEAT / 2, gain=0.018)
        riff(bar_no - 5, start)
        continue

    if section == "full":
        for beat in (0, 2):
            kick(start + beat * BEAT, gain=0.19)
        if bar_no % 2 == 0:
            kick(start + 3.5 * BEAT, gain=0.095)
        for beat in (1, 3):
            snare(start + beat * BEAT, gain=0.082)
        for eighth in range(8):
            shaker(start + eighth * BEAT / 2, gain=0.026 if eighth % 2 == 0 else 0.018)
        root = chord_for(bar_no) - 24
        bass_note(start, root, velocity=0.16)
        bass_note(start + 1.5 * BEAT, root + 7, duration=0.26, velocity=0.12)
        bass_note(start + 2 * BEAT, root, velocity=0.145)
        riff(bar_no - 9, start, octave=12 if bar_no % 3 == 0 else 0)
        continue

    if section == "tutorial":
        for beat in (0, 2):
            kick(start + beat * BEAT, gain=0.14)
        for beat in (1, 3):
            snare(start + beat * BEAT, gain=0.065)
        for beat in range(4):
            tick(start + beat * BEAT, gain=0.027)
        for eighth, p in enumerate([0, 3, 7, 10, 7, 3, 5, 7]):
            pluck(start + eighth * BEAT / 2, 62 + p, duration=0.27, velocity=0.078)
        bass_note(start, chord_for(bar_no) - 24, velocity=0.105)
        bass_note(start + 2 * BEAT, chord_for(bar_no) - 24, velocity=0.095)
        continue

    if section == "chaos":
        for beat in (0, 1.5, 2, 3.25):
            kick(start + beat * BEAT, gain=0.22 if beat in (0, 2) else 0.11)
        for beat in (1, 3):
            snare(start + beat * BEAT, gain=0.11)
        for eighth in range(8):
            shaker(start + eighth * BEAT / 2, gain=0.037)
        root = chord_for(bar_no) - 24
        bass_note(start, root, duration=0.36, velocity=0.17)
        bass_note(start + 1.5 * BEAT, root + 5, duration=0.24, velocity=0.14)
        bass_note(start + 2 * BEAT, root + 2, duration=0.36, velocity=0.17)
        riff(bar_no - 25, start, tense=2)
        if bar_no in (26, 28, 30):
            for j, note in enumerate((43, 48, 50)):
                tom(start + 3.25 * BEAT + j * 0.19, midi=note, gain=0.12)
        continue

    if section == "pitch":
        kick(start, gain=0.17)
        snare(start + 2 * BEAT, gain=0.078)
        for beat in (0, 2):
            shaker(start + beat * BEAT, gain=0.022, duration=0.09)
        bass_note(start, chord_for(bar_no) - 24, duration=0.5, velocity=0.13)
        slow = [0, 5, 7, 3]
        for i, p in enumerate(slow):
            pluck(start + i * BEAT, 62 + p, duration=0.7, velocity=0.094, tense=1)
        continue

    # Finale: original hook with a second dombra line one octave above.
    for beat in (0, 2):
        kick(start + beat * BEAT, gain=0.21)
    if bar_no % 2 == 0:
        kick(start + 3.5 * BEAT, gain=0.11)
    for beat in (1, 3):
        snare(start + beat * BEAT, gain=0.097)
    for eighth in range(8):
        shaker(start + eighth * BEAT / 2, gain=0.031)
    root = chord_for(bar_no) - 24
    bass_note(start, root, velocity=0.17)
    bass_note(start + 1.5 * BEAT, root + 7, duration=0.27, velocity=0.13)
    bass_note(start + 2 * BEAT, root, velocity=0.16)
    riff(bar_no - 38, start)
    riff(bar_no - 38, start, octave=12, tense=0)
    if bar_no == 45:
        for eighth in range(8):
            shaker(start + eighth * BEAT / 2, gain=0.05 + eighth * 0.007)
        for beat in range(4):
            kick(start + beat * BEAT, gain=0.1 + beat * 0.035)
        snare(start + 2.5 * BEAT, gain=0.17)
        tom(start + 3.2 * BEAT, midi=50, gain=0.15)

# Final downbeat of bar 46: a warm, wide unison hit and a short ring-out.
for note, level in ((38, 0.17), (45, 0.15), (50, 0.21), (57, 0.13), (62, 0.08)):
    pad_note(FINAL_HIT, note, 1.55, velocity=level)
kick(FINAL_HIT, gain=0.29, weight=1.45)
snare(FINAL_HIT, gain=0.14, weight=1.2)
for i, pitch in enumerate((50, 57, 62)):
    pluck(FINAL_HIT, pitch, duration=1.15, velocity=0.16 - i * 0.02)

# A compact cross-feedback delay gives the plucks and pads a natural island-room tail.
dry = lead + bass + pad + drums + ambience
wet = np.zeros_like(dry)
delays = [int(0.112 * SR), int(0.187 * SR), int(0.293 * SR), int(0.421 * SR)]
for index, delay in enumerate(delays):
    decay = 0.24 / (index + 1)
    if index % 2:
        wet[delay:, 0] += dry[:-delay, 1] * decay
        wet[delay:, 1] += dry[:-delay, 0] * decay
    else:
        wet[delay:, 0] += dry[:-delay, 0] * decay
        wet[delay:, 1] += dry[:-delay, 1] * decay
mix = dry + wet * 0.78
mix[int(FINAL_HIT * SR):] *= 0.52

# Sidechain-style ducking: kicks gently move the bass and pad out of the way.
duck = np.ones(N, dtype=np.float32)
for at in np.arange(0, FINAL_HIT + 0.1, BEAT):
    start = int(at * SR)
    length = min(N - start, int(0.27 * SR))
    if length > 0:
        t = np.arange(length, dtype=np.float32) / SR
        duck[start:start + length] = np.minimum(duck[start:start + length], 1 - 0.29 * np.exp(-t * 13))
mix[:, 0] -= bass[:, 0] + pad[:, 0]
mix[:, 1] -= bass[:, 1] + pad[:, 1]
mix[:, 0] += bass[:, 0] * duck + pad[:, 0] * duck
mix[:, 1] += bass[:, 1] * duck + pad[:, 1] * duck

# Gentle tape-like saturation and bus compression keep the final hit from setting the
# gain for the whole cue.
mix = np.tanh(mix * 1.22) / np.tanh(1.22)
mix *= np.linspace(0.985, 1.0, N, dtype=np.float32)[:, None]
level = np.abs(mix)
threshold = 0.19
ratio = 3.0
compressed = np.where(level > threshold, threshold + (level - threshold) / ratio, level)
mix = np.sign(mix) * compressed
rms = float(np.sqrt(np.mean(mix * mix)))
mix *= 10 ** (-14 / 20) / max(rms, 1e-8)
peak = float(np.max(np.abs(mix)))
if peak > 10 ** (-1 / 20):
    mix *= (10 ** (-1 / 20)) / peak
peak = float(np.max(np.abs(mix)))
final_rms = float(np.sqrt(np.mean(mix * mix)))


def write_stereo(path, audio, target_peak_db=-1.5):
    audio = np.asarray(audio, dtype=np.float32)
    audio = np.tanh(audio * 1.08) / np.tanh(1.08)
    peak = float(np.max(np.abs(audio)))
    ceiling = 10 ** (target_peak_db / 20)
    if peak > ceiling:
        audio *= ceiling / peak
    pcm = np.clip(audio, -1, 1)
    wavfile.write(path, SR, (pcm * 32767).astype(np.int16))


write_stereo(f"{ROOT}/music.wav", mix)
bar_starts = [round(i * BAR, 6) for i in range(46)]
with open(f"{ROOT}/beats.json", "w", encoding="utf-8") as f:
    json.dump({
        "tempo": BPM,
        "timeSignature": "4/4",
        "barSeconds": round(BAR, 9),
        "durationSeconds": round(N / SR, 6),
        "finalHitSeconds": round(FINAL_HIT, 6),
        "barStarts": bar_starts,
    }, f, indent=2)
    f.write("\n")


def one_pole(data, cutoff, highpass=False):
    alpha = math.exp(-2 * math.pi * cutoff / SR)
    out = np.empty_like(data, dtype=np.float32)
    if highpass:
        previous_x = 0.0
        previous_y = 0.0
        for i, x in enumerate(data):
            y = alpha * (previous_y + x - previous_x)
            out[i] = y
            previous_x, previous_y = x, y
    else:
        previous = 0.0
        for i, x in enumerate(data):
            previous += (1 - alpha) * (x - previous)
            out[i] = previous
    return out


def synth_sfx(name, duration, make):
    count = int(duration * SR)
    audio = np.asarray(make(count), dtype=np.float32)
    if audio.ndim == 1:
        audio = np.column_stack((audio, np.roll(audio, int(0.006 * SR))))
    audio = np.tanh(audio * 1.4) / np.tanh(1.4)
    peak = float(np.max(np.abs(audio)))
    if peak > 0:
        audio *= 10 ** (-2 / 20) / peak
    wavfile.write(f"{ROOT}/{name}.wav", SR, (np.clip(audio, -1, 1) * 32767).astype(np.int16))


def whoosh(n):
    t = np.arange(n, dtype=np.float32) / SR
    noise = RNG.normal(0, 1, n).astype(np.float32)
    cutoff = 450 + 7000 * (t / 0.5) ** 2
    # White noise through a moving lowpass; the taper gives it a clear in/out.
    filtered = np.empty_like(noise)
    previous = 0.0
    for i, sample in enumerate(noise):
        alpha = 1 - math.exp(-2 * math.pi * cutoff[i] / SR)
        previous += alpha * (sample - previous)
        filtered[i] = previous
    amp = np.sin(np.pi * np.clip(t / 0.5, 0, 1)) ** 1.7
    sweep = np.sin(2 * np.pi * (160 * t + 1800 * t * t)) * 0.08
    return (filtered * amp + sweep) * 0.65


def pop(n):
    t = np.arange(n, dtype=np.float32) / SR
    f = 760 * np.exp(-t * 14) + 130
    phase = 2 * np.pi * np.cumsum(f) / SR
    bubble = np.sin(phase) * np.exp(-t * 12)
    click = RNG.normal(0, 0.6, n).astype(np.float32) * np.exp(-t * 350)
    return bubble * 0.8 + click * 0.2


def coin(n):
    t = np.arange(n, dtype=np.float32) / SR
    sig = np.zeros(n, dtype=np.float32)
    for freq, amp, decay in ((1318, 0.7, 8), (1760, 0.45, 11), (2637, 0.2, 14), (3520, 0.1, 17)):
        sig += amp * np.sin(2 * np.pi * freq * t) * np.exp(-t * decay)
    return sig * np.minimum(1, t * 500)


def kaching(n):
    t = np.arange(n, dtype=np.float32) / SR
    sig = np.zeros(n, dtype=np.float32)
    for offset, freq, amp in ((0, 988, 0.55), (0.045, 1568, 0.4), (0.22, 2093, 0.3), (0.39, 2637, 0.24)):
        local = np.maximum(0, t - offset)
        sig += (t >= offset) * amp * np.sin(2 * np.pi * freq * local) * np.exp(-local * 12)
    rattle = RNG.normal(0, 1, n).astype(np.float32)
    rattle = one_pole(rattle, 6500, highpass=True)
    sig += rattle * np.exp(-t * 24) * (np.sin(2 * np.pi * 19 * t) > 0) * 0.08
    return sig


def thunder(n):
    t = np.arange(n, dtype=np.float32) / SR
    noise = RNG.normal(0, 1, n).astype(np.float32)
    rumble = one_pole(noise, 135)
    swell = np.sin(np.pi * np.clip(t / 2, 0, 1)) ** 0.7
    low = np.sin(2 * np.pi * (38 * t + 3 * t * t))
    return (rumble * 0.85 + low * 0.15) * swell * (0.8 + 0.2 * np.sin(2 * np.pi * 1.7 * t))


def gull(n):
    t = np.arange(n, dtype=np.float32) / SR
    sig = np.zeros(n, dtype=np.float32)
    for offset, dur, base, glide in ((0.0, 0.19, 980, -360), (0.21, 0.25, 1280, -640), (0.43, 0.16, 830, -330)):
        mask = (t >= offset) & (t < offset + dur)
        local = t[mask] - offset
        freq = base + glide * local / dur + 80 * np.sin(local * 2 * np.pi * 7)
        phase = 2 * np.pi * np.cumsum(freq) / SR
        sig[mask] += (np.sin(phase) + 0.22 * np.sin(phase * 2.01)) * np.sin(np.pi * local / dur)
    noise = one_pole(RNG.normal(0, 1, n).astype(np.float32), 3200, highpass=True)
    return sig * 0.8 + noise * 0.035


def boing(n):
    t = np.arange(n, dtype=np.float32) / SR
    f = 210 + 500 * np.exp(-t * 7) * np.sin(2 * np.pi * 3.4 * t)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t * 5.8) + 0.13 * np.sin(phase * 2.01) * np.exp(-t * 9)


def small_tick(n):
    t = np.arange(n, dtype=np.float32) / SR
    click = RNG.normal(0, 1, n).astype(np.float32) * np.exp(-t * 330)
    return 0.7 * click + 0.3 * np.sin(2 * np.pi * 2900 * t) * np.exp(-t * 200)


def scratch(n):
    t = np.arange(n, dtype=np.float32) / SR
    f = 1500 - 1050 * np.sin(np.pi * np.clip(t / 0.6, 0, 1))
    phase = 2 * np.pi * np.cumsum(f) / SR
    noise = RNG.normal(0, 1, n).astype(np.float32)
    grit = one_pole(noise, 4500, highpass=True)
    envelope = np.sin(np.pi * np.clip(t / 0.6, 0, 1)) ** 0.65
    return (np.sin(phase) * 0.55 + grit * 0.28) * envelope


for name, duration, synth in (
    ("whoosh", 0.5, whoosh),
    ("pop", 0.24, pop),
    ("coin", 0.8, coin),
    ("kaching", 0.95, kaching),
    ("thunder", 2.0, thunder),
    ("gull", 0.6, gull),
    ("boing", 0.7, boing),
    ("tick", 0.08, small_tick),
    ("scratch", 0.6, scratch),
):
    synth_sfx(name, duration, synth)


sections = {
    "intro": (0, 8.571429),
    "entry": (8.571429, 17.142857),
    "full": (17.142857, 30.0),
    "tutorial": (30.0, 51.428571),
    "chaos": (51.428571, 66.428571),
    "pitch": (66.428571, 79.285714),
    "finale": (79.285714, FINAL_HIT),
    "ringout": (FINAL_HIT, DURATION),
}
print(f"music.wav: {N / SR:.3f}s, stereo {SR} Hz, peak {20 * np.log10(max(peak, 1e-9)):.2f} dBFS, RMS {20 * np.log10(max(final_rms, 1e-9)):.2f} dBFS")
for label, (start, end) in sections.items():
    segment = mix[int(start * SR):int(end * SR)]
    section_rms = float(np.sqrt(np.mean(segment * segment))) if len(segment) else 0
    print(f"  {label:8s} {start:7.2f}-{end:7.2f}s RMS {20 * np.log10(max(section_rms, 1e-9)):6.2f} dBFS")
for name, _, _ in (
    ("whoosh", 0.5, None), ("pop", 0.24, None), ("coin", 0.8, None),
    ("kaching", 0.95, None), ("thunder", 2.0, None), ("gull", 0.6, None),
    ("boing", 0.7, None), ("tick", 0.08, None), ("scratch", 0.6, None),
):
    rate, audio = wavfile.read(f"{ROOT}/{name}.wav")
    print(f"  {name:8s} {len(audio) / rate:.2f}s peak {np.max(np.abs(audio)) / 32768:.3f}")
