import sys
from pathlib import Path
from PIL import Image
from collections import deque
import json, hashlib
# Usage: python3 scripts/import-clawd.py DIRECTORY_WITH_Waving_CrabWalking_JumpingHappy_Pointing_GIFS
source_dir=Path(sys.argv[1])
out=Path(__file__).resolve().parents[1]/'icons/mascot/octopus'
clips={}
for name in ['Waving','CrabWalking','JumpingHappy','Pointing']:
 path=source_dir/(name+'.gif')
 im=Image.open(path); seq=[];last=None
 for i in range(im.n_frames):
  im.seek(i); frame=im.convert('RGBA')
  grid={(x,y):frame.getpixel((x*50+25,y*50+25)) for y in range(37) for x in range(55)}
  outside=set();todo=deque([(x,y) for x,y in grid if x in (0,54) or y in (0,36)])
  while todo:
   xy=todo.popleft()
   if xy in outside or xy not in grid or grid[xy][3]>127: continue
   outside.add(xy)
   x,y=xy;todo.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
  # The official GIF eyes are enclosed transparent holes. Ink them black on any panel theme.
  for xy in grid:
   if grid[xy][3]<=127 and xy not in outside: grid[xy]=(0,0,0,255)
  colors={}
  for y in range(37):
   x=0
   while x<55:
    color=grid[(x,y)];start=x;x+=1
    while x<55 and grid[(x,y)]==color: x+=1
    if color[3]>127:
     key='#%02x%02x%02x'%color[:3]
     colors.setdefault(key,[]).append(f'M{start} {y}h{x-start}v1h{-x+start}z')
  viewbox={'Waving':'13 15 28 24','CrabWalking':'13 19 28 20','JumpingHappy':'13 6 28 32','Pointing':'13 15 32 24'}[name]
  svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="{viewbox}" shape-rendering="crispEdges">'+''.join(f'<path fill="{c}" d="{"".join(p)}"/>' for c,p in colors.items())+'</svg>\n'
  duration=im.info.get('duration',80)
  if svg==last:
   seq[-1][1]+=duration
  else:
   file=f'{name.lower()}-{len(seq):02}.svg';(out/file).write_text(svg);seq.append([file,duration]);last=svg
 clips[name]=seq
stand=(out/clips['Waving'][0][0]).read_text().replace('viewBox="13 15 28 24"', 'viewBox="13 19 28 20"')
for p in out.glob('robot-*.svg'):p.write_text(stand)
manifest={'source':'https://claude.ai/images/clawd/core/','sources':{n:{'file':f'Clawd-{n}.gif','sha256':hashlib.sha256((source_dir/(n+'.gif')).read_bytes()).hexdigest()} for n in clips},'wake':clips['Waving'],'active':[clips['CrabWalking'],clips['JumpingHappy'],clips['Pointing']],'idle':clips['Pointing']}
(out/'animations.json').write_text(json.dumps(manifest,indent=2)+'\n')
print({n:len(s) for n,s in clips.items()})
