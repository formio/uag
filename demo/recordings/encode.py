#!/usr/bin/env python3
"""
Turn a recorded scene (PNG frames plus timeline.json, from director.mjs) into
an animated GIF.

    python3 encode.py <frames dir> <out.gif> [--width 960] [--fps 10] [--hold 3]

The timeline's edits are applied first: a `cut` is left out, and a `speed`
segment plays `factor` times faster, never longer than `max` seconds. Each
frame is cropped to the timeline's view at that moment (the director's
`focus`), easing from one view to the next, and scaled to the GIF's size. The
result is resampled at a fixed rate, unchanged frames are merged into one
longer frame, and each frame gets its own palette, without dithering, so text
and flat UI colors stay crisp.
"""
import argparse
import bisect
import json
import os
import sys

from PIL import Image


def pieces(t0, t1, edits):
    """Piecewise map from recorded time to GIF time: (rec_start, rec_end, gif_start, gif_end)."""
    out = []
    cursor, gif = t0, 0.0
    for edit in sorted(edits, key=lambda e: e['start']):
        start, end = max(edit['start'], t0), min(edit['end'], t1)
        if end <= cursor:
            continue
        start = max(start, cursor)
        if start > cursor:
            out.append((cursor, start, gif, gif + start - cursor))
            gif += start - cursor
        length = 0.0 if edit['kind'] == 'cut' else min((end - start) / edit.get('factor', 8), edit.get('max', 2.5))
        out.append((start, end, gif, gif + length))
        gif += length
        cursor = end
    if t1 > cursor:
        out.append((cursor, t1, gif, gif + t1 - cursor))
        gif += t1 - cursor
    return out, gif


def to_gif(t, mapping):
    for rec_start, rec_end, gif_start, gif_end in mapping:
        if rec_start <= t < rec_end:
            return gif_start + (t - rec_start) * (gif_end - gif_start) / ((rec_end - rec_start) or 1)
    return mapping[-1][3]


def to_recorded(t_gif, mapping):
    for rec_start, rec_end, gif_start, gif_end in mapping:
        if gif_start <= t_gif < gif_end:
            return rec_start + (t_gif - gif_start) * (rec_end - rec_start) / (gif_end - gif_start)
    return mapping[-1][1]


PAN = 0.45  # seconds to ease from one view to the next, as the caption does


def view_at(t, views, full):
    """The crop (x, y, w, h) at recorded time `t`, in fractions of the screen."""
    index = bisect.bisect_right([v['t'] for v in views], t) - 1
    if index < 0:
        return full
    current = tuple(views[index]['view'][k] for k in 'xywh') if views[index]['view'] else full
    previous = full
    if index > 0 and views[index - 1]['view']:
        previous = tuple(views[index - 1]['view'][k] for k in 'xywh')
    k = min(1.0, (t - views[index]['t']) / PAN)
    k = 2 * k * k if k < 0.5 else 1 - (-2 * k + 2) ** 2 / 2
    return tuple(round(a + (b - a) * k, 4) for a, b in zip(previous, current))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('frames')
    parser.add_argument('out')
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--fps', type=float, default=10)
    parser.add_argument('--hold', type=float, default=1.0, help='extra seconds to hold the last frame before the loop')
    args = parser.parse_args()

    with open(os.path.join(args.frames, 'timeline.json')) as f:
        timeline = json.load(f)
    frames = timeline['frames']
    if not frames:
        sys.exit('No frames were recorded.')
    times = [f['t'] for f in frames]
    begin = max(times[0], (timeline.get('begin') or times[0]) - 0.2)
    # A still screen sends no frames, so the scene's last hold ends at `end`.
    end = max(times[-1], timeline.get('end') or times[-1])
    mapping, length = pieces(begin, end, timeline['edits'])
    full = (0, 0, 1, 1)
    views = timeline.get('views') or []

    # Which recorded frame is on screen at each tick of the GIF.
    step = 1.0 / args.fps
    picks = []
    tick = 0.0
    while tick < length:
        t = to_recorded(tick, mapping)
        picks.append((max(0, bisect.bisect_right(times, t) - 1), view_at(t, views, full)))
        tick += step
    picks.append((len(frames) - 1, view_at(end, views, full)))

    # Merge runs of the same frame into one, and hold the last.
    runs = []
    for pick in picks:
        if runs and runs[-1][0] == pick:
            runs[-1][1] += step
        else:
            runs.append([pick, step])
    runs[-1][1] += args.hold

    with Image.open(os.path.join(args.frames, frames[0]['file'])) as first:
        frame_width, frame_height = first.size

    def load(pick):
        index, view = pick
        image = Image.open(os.path.join(args.frames, frames[index]['file'])).convert('RGB')
        if view != full:
            x, y, w, h = view
            image = image.crop((round(x * image.width), round(y * image.height), round((x + w) * image.width), round((y + h) * image.height)))
        # The screen can be narrowed (keeping its shape) for part of a scene.
        height = round(args.width * frame_height / frame_width)
        if image.size != (args.width, height):
            image = image.resize((args.width, height), Image.LANCZOS)
        return image

    # One palette for every frame, from a mosaic of frames across the scene, so
    # a pixel that does not change keeps its index and only the changed region
    # of each frame is stored.
    used = sorted({pick for pick, _ in runs})
    samples = [load(used[round(i * (len(used) - 1) / 23)]) for i in range(min(24, len(used)))]
    tile = (samples[0].width // 2, samples[0].height // 2)
    mosaic = Image.new('RGB', (tile[0] * 6, tile[1] * ((len(samples) + 5) // 6)))
    for i, sample in enumerate(samples):
        mosaic.paste(sample.resize(tile, Image.LANCZOS), ((i % 6) * tile[0], (i // 6) * tile[1]))
    palette = mosaic.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

    images, durations = [], []
    previous = None
    for pick, seconds in runs:
        image = load(pick)
        # Two recorded frames can look the same once scaled; keep one.
        if previous is not None and image.tobytes() == previous.tobytes():
            durations[-1] += seconds
            continue
        previous = image
        images.append(image.quantize(palette=palette, dither=Image.Dither.NONE))
        durations.append(seconds)

    images[0].save(
        args.out,
        save_all=True,
        append_images=images[1:],
        duration=[max(20, round(d * 1000)) for d in durations],
        loop=0,
        optimize=True,
        disposal=1,
    )
    size = os.path.getsize(args.out) / 1e6
    marks = timeline.get('marks') or []
    if marks:
        at = [to_gif(m['t'], mapping) for m in marks] + [length]
        print('  steps: ' + ', '.join(f"{m['step']}: {at[i + 1] - at[i]:.1f} s" for i, m in enumerate(marks)))
    print(f'{args.out}: {len(images)} frames, {sum(durations):.1f} s, {size:.1f} MB')


if __name__ == '__main__':
    main()
