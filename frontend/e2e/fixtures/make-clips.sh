#!/usr/bin/env bash
# Writes the synthetic clips the tests use (needs ffmpeg 6+). The files are
# committed, so the tests themselves don't need ffmpeg.
#   clip-h264.mp4      1280×720 H.264 + AAC, index at the end, with a location
#                      in both the QuickTime and the iPhone-style metadata:
#                      should be copied, not re-encoded, and lose the location
#   clip-portrait.mp4  1280×720 H.264 stored sideways with a 90° rotation flag,
#                      so it plays as 720×1280 portrait
#   clip-vp9.webm      2560×1440 VP9 + Opus: should be re-encoded to 1920×1080 H.264
#   clip-sound-only.mp4  AAC sound without video: should be turned away
set -euo pipefail
cd "$(dirname "$0")"
LOC="+12.3456+065.4321/" # made up, in open sea

ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "sine=frequency=330:sample_rate=48000" -t 3 \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -b:v 900k -g 30 -c:a aac -b:a 96k \
  -metadata location="$LOC" -metadata "com.apple.quicktime.location.ISO6709=$LOC" -movflags use_metadata_tags \
  clip-h264.mp4

ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -t 2 \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -b:v 700k -g 30 -an clip-portrait.tmp.mp4
ffmpeg -v error -y -display_rotation 90 -i clip-portrait.tmp.mp4 -c copy clip-portrait.mp4
rm clip-portrait.tmp.mp4

ffmpeg -v error -y -f lavfi -i "testsrc2=size=2560x1440:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 2 \
  -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -c:a libopus -b:a 64k clip-vp9.webm

ffmpeg -v error -y -f lavfi -i "sine=frequency=220:sample_rate=48000" -t 1 -c:a aac -b:a 64k clip-sound-only.mp4

ls -la clip-*
