#!/usr/bin/env python3
"""Usage: python canvas_poster.py title output.png --subtitle 'Text' --font path/to/font.ttf"""
import argparse
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument("title")
parser.add_argument("output")
parser.add_argument("--subtitle", default="")
parser.add_argument("--font", default="")
a = parser.parse_args()
canvas = Image.new("RGB", (1200, 630), "#111827")
d = ImageDraw.Draw(canvas)
regular = ImageFont.truetype(a.font, 68) if a.font else ImageFont.load_default()
small = ImageFont.truetype(a.font, 32) if a.font else ImageFont.load_default()
d.rectangle((76, 85, 91, 545), fill="#65D6C3")
max_width = 980
lines = []
for word in a.title.split():
    line = (lines[-1] + " " + word) if lines else word
    if lines and d.textbbox((0, 0), line, font=regular)[2] <= max_width:
        lines[-1] = line
    else:
        lines.append(word)
for i, line in enumerate(lines[:4]):
    d.text((120, 120 + 82 * i), line, font=regular, fill="white")
d.text((120, 520), a.subtitle[:90], font=small, fill="#B6C6D6")
canvas.save(a.output)
print(a.output)

