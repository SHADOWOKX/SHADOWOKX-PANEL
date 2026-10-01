"""Rasterize the centered Linux vector cells without changing frame geometry."""
from pathlib import Path
import re, json, sys
from PIL import Image, ImageDraw
repo=Path(__file__).resolve().parents[2]
source=Path(sys.argv[1]) if len(sys.argv)>1 else repo/'icons'/'mascot'/'octopus'
output=repo/'windows'/'src'/'ShadowokxPanel'/'Assets'/'Companions'/'octopus'
output.mkdir(parents=True,exist_ok=True)
for path in source.glob('*.svg'):
    svg=path.read_text()
    x0,y0,w,h=map(float,re.search(r'viewBox="([^"]+)"',svg).group(1).split())
    image=Image.new('RGBA',(96,96))
    draw=ImageDraw.Draw(image)
    for attrs,commands in re.findall(r'<path([^>]*?) d="([^"]+)"',svg):
        color=re.search(r'fill="([^"]+)"',attrs).group(1)
        transform=re.search(r'translate\(([-\d.]+) ([-\d.]+)\)',attrs)
        dx,dy=map(float,transform.groups()) if transform else (0,0)
        for x,y,cw,ch in re.findall(r'M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)',commands):
            x,y,cw,ch=map(float,(x,y,cw,ch))
            left,top=round((x+dx-x0)*96/w),round((y+dy-y0)*96/h)
            right,bottom=round((x+cw+dx-x0)*96/w),round((y+ch+dy-y0)*96/h)
            draw.rectangle((left,top,right-1,bottom-1),fill=color)
    image.save(output/(path.stem+'.png'))
    image.save(output/(path.stem+'.ico'),sizes=[(16,16),(24,24),(32,32),(48,48),(64,64)])
(output/'animations.json').write_text((source/'animations.json').read_text())
print('Synced centered Linux Clawd frames and tray icons')
