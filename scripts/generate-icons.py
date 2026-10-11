"""Generate the จดเงิน notebook icons. Requires Python and Pillow on Windows."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
size = 1024
image = Image.new('RGB', (size, size))
draw = ImageDraw.Draw(image)
for y in range(size):
    ratio = y / (size - 1)
    color = tuple(round(a + (b - a) * ratio) for a, b in zip((128, 150, 164), (76, 99, 117)))
    draw.line((0, y, size, y), fill=color)
draw.rounded_rectangle((232, 191, 803, 843), radius=120, fill='#405969')
draw.rounded_rectangle((221, 178, 792, 830), radius=120, fill='#e6d9bf')
draw.rounded_rectangle((233, 190, 780, 818), radius=108, fill='#fffaf0')
font = ImageFont.truetype(r'C:\Windows\Fonts\tahomabd.ttf', 360)
box = draw.textbbox((0, 0), 'จ', font=font)
draw.text(((size - (box[2] - box[0])) / 2 - box[0], 480 - (box[3] - box[1]) / 2 - box[1]), 'จ', font=font, fill='#995f49')
draw.rounded_rectangle((343, 694, 595, 714), radius=10, fill='#dabb79')
draw.ellipse((626, 665, 676, 715), fill='#8b7198')
for target in (192, 512):
    image.resize((target, target), Image.Resampling.LANCZOS).save(root / f'icon-{target}.png')
print('Generated notebook icons (192 and 512 pixels).')
