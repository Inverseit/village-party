#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FRAME_ROOT="$ROOT/demo/out/frames"
AUDIO="$ROOT/demo/out/mix.wav"
OUTPUT="$ROOT/demo/out/village-party-demo.mp4"
SHOTS=(open lobby orchard forest workshop site upkeep tutor gulls storm tax bench results end)

if [[ ! -f "$AUDIO" ]]; then
  printf 'Missing audio mix: %s\n' "$AUDIO" >&2
  exit 1
fi

inputs=()
filters=()
labels=()
for index in "${!SHOTS[@]}"; do
  shot="${SHOTS[$index]}"
  directory="$FRAME_ROOT/$shot"
  shopt -s nullglob
  frames=("$directory"/*.jpg)
  if ((${#frames[@]} == 0)); then
    printf 'No JPG frames found for shot %s in %s\n' "$shot" "$directory" >&2
    exit 1
  fi

  first="${frames[0]##*/}"
  number="${first%.jpg}"
  if [[ ! "$number" =~ ^[0-9]{5}$ ]]; then
    printf 'Expected five-digit frame names, found %s\n' "$first" >&2
    exit 1
  fi
  start_number=$((10#$number))

  inputs+=(-framerate 24 -start_number "$start_number" -i "$directory/%05d.jpg")
  label="shot${index}"
  labels+=("[$label]")
  filters+=("[$index:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[$label]")
done

audio_index="${#SHOTS[@]}"
inputs+=(-i "$AUDIO")
joined_labels=""
for label in "${labels[@]}"; do
  joined_labels+="$label"
done
filters+=("${joined_labels}concat=n=${#SHOTS[@]}:v=1:a=0[vout]")
filter_complex="$(IFS=';'; printf '%s' "${filters[*]}")"

ffmpeg -hide_banner -y \
  "${inputs[@]}" \
  -filter_complex "$filter_complex" \
  -map '[vout]' -map "${audio_index}:a:0" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -vsync cfr \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  "$OUTPUT"
