"""Draw the original Tortoise and Hare test picture book (all assets generated locally)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math, random

OUT = Path(__file__).resolve().parents[1] / "test-results" / "ocr-samples"
OUT.mkdir(parents=True, exist_ok=True)
W, H, S = 1200, 1600, 2
BG = '#faf6ea'
GREEN = '#5a9976'
INK = '#344a40'
TERRACOTTA = '#d58d67'
random.seed(310)
font_path = r'C:\Windows\Fonts\msyhbd.ttc'
font_regular = r'C:\Windows\Fonts\msyh.ttc'
def font(n, bold=True): return ImageFont.truetype(font_path if bold else font_regular, n*S)
def box(x0,y0,x1,y1): return (int(x0*S),int(y0*S),int(x1*S),int(y1*S))
def xy(points): return [(int(x*S),int(y*S)) for x,y in points]
def oval(d, coords, color, outline=None, width=2): d.ellipse(box(*coords), fill=color, outline=outline, width=width*S)
def line(d, pts, color, width): d.line(xy(pts), fill=color, width=width*S, joint='curve')
def poly(d, pts, color): d.polygon(xy(pts), fill=color)
def roundbox(d, coords, radius, fill, outline=None, width=2): d.rounded_rectangle(box(*coords), radius*S, fill=fill, outline=outline, width=width*S)
def text(d, pos, value, f, fill=INK, anchor='la', stroke=0): d.text((int(pos[0]*S),int(pos[1]*S)), value, font=f, fill=fill, anchor=anchor, stroke_width=stroke*S, stroke_fill=BG)

def cloud(d,x,y,k=1):
    oval(d,(x,y+12*k,x+190*k,y+74*k),'#fffdf6')
    for dx,dy,r in [(36,25,36),(82,8,48),(135,29,35)]: oval(d,(x+(dx-r)*k,y+(dy-r)*k,x+(dx+r)*k,y+(dy+r)*k),'#fffdf6')
def flower(d,x,y,c='#ffce80',s=1):
    line(d,[(x,y+25*s),(x,y+45*s)],'#689d72',3)
    for a in range(5):
        px=x+12*s*math.cos(a*2*math.pi/5);py=y+12*s*math.sin(a*2*math.pi/5)
        oval(d,(px-8*s,py-8*s,px+8*s,py+8*s),c)
    oval(d,(x-6*s,y-6*s,x+6*s,y+6*s),'#e39557')
def tree(d,x,y,s=1):
    roundbox(d,(x-16*s,y-170*s,x+20*s,y+30*s),12*s,'#b57859')
    for ox,oy,rad,col in [(-65,-175,67,'#79ac80'),(22,-210,85,'#609b72'),(91,-160,65,'#83b789')]:
        oval(d,(x+(ox-rad)*s,y+(oy-rad)*s,x+(ox+rad)*s,y+(oy+rad)*s),col)
    for ox,oy in [(-60,-180),(20,-200),(84,-147)]: oval(d,(x+(ox-8)*s,y+(oy-8)*s,x+(ox+8)*s,y+(oy+8)*s),'#f6d99b')
def butterfly(d,x,y,c='#f3a7a5'):
    oval(d,(x-25,y-22,x-2,y+3),c);oval(d,(x+2,y-22,x+25,y+3),c)
    oval(d,(x-17,y+1,x-2,y+18),c);oval(d,(x+2,y+1,x+17,y+18),c)
    line(d,[(x,y-4),(x,y+14)],'#69594b',3)

def tortoise(d,x,y,s=1,walk=False):
    # Layered shell, soft highlights, cheerful face; identical silhouette on all pages.
    oval(d,(x-122*s,y+77*s,x+125*s,y+124*s),'#4b765e')
    for dx in [-81,-29,50,100]:
        oval(d,(x+(dx-21)*s,y+98*s,x+(dx+21)*s,y+149*s),'#78a681')
    oval(d,(x-126*s,y-50*s,x+104*s,y+121*s),'#528b69')
    oval(d,(x-111*s,y-39*s,x+91*s,y+106*s),'#78aa7a',outline='#3c775d',width=5)
    # Shell mosaic pieces.
    for cx,cy,rx,ry in [(-53,-11,39,31),(28,-13,40,30),(-65,54,35,27),(10,55,41,30),(68,54,20,22)]:
        oval(d,(x+(cx-rx)*s,y+(cy-ry)*s,x+(cx+rx)*s,y+(cy+ry)*s),'#91bb86',outline='#5b956e',width=4)
    oval(d,(x+82*s,y+33*s,x+206*s,y+137*s),'#94bd83')
    oval(d,(x+143*s,y-10*s,x+262*s,y+108*s),'#9fc88d')
    oval(d,(x+223*s,y+51*s,x+253*s,y+78*s),'#b6d69d')
    oval(d,(x+200*s,y+21*s,x+211*s,y+34*s),INK)
    oval(d,(x+219*s,y+42*s,x+245*s,y+61*s),'#eaa087')
    line(d,[(x+209*s,y+73*s),(x+225*s,y+78*s),(x+238*s,y+72*s)],'#556e4d',3)
    if walk:
        oval(d,(x-118*s,y+134*s,x-54*s,y+151*s),'#d8caa2')
        oval(d,(x+75*s,y+134*s,x+143*s,y+151*s),'#d8caa2')

def hare(d,x,y,s=1,asleep=False,run=False):
    oval(d,(x-125*s,y+94*s,x+112*s,y+140*s),'#a4b893') if asleep else None
    # Tall ears and the peach inner ears are deliberately recognizable in every scene.
    oval(d,(x+14*s,y-238*s,x+67*s,y-18*s),'#c89c7f')
    oval(d,(x+83*s,y-242*s,x+136*s,y-23*s),'#c89c7f')
    oval(d,(x+30*s,y-216*s,x+52*s,y-42*s),'#f4c7b7')
    oval(d,(x+99*s,y-217*s,x+121*s,y-45*s),'#f4c7b7')
    oval(d,(x-91*s,y-26*s,x+110*s,y+156*s),'#d7ad90')
    oval(d,(x-30*s,y-7*s,x+151*s,y+129*s),'#f4e1c5')
    oval(d,(x-42*s,y-72*s,x+147*s,y+85*s),'#d7ad90')
    oval(d,(x+5*s,y+40*s,x+102*s,y+101*s),'#f8ead7')
    oval(d,(x+102*s,y+48*s,x+154*s,y+84*s),'#f7d0b9')
    if asleep:
        line(d,[(x+44*s,y+12*s),(x+66*s,y+17*s),(x+82*s,y+11*s)],'#674e45',4)
    else:
        oval(d,(x+58*s,y+1*s,x+69*s,y+17*s),'#493c38')
        oval(d,(x+61*s,y+2*s,x+64*s,y+6*s),'#fffdf8')
    oval(d,(x-48*s,y+68*s,x-2*s,y+115*s),'#f7e4cc')
    oval(d,(x-80*s,y+126*s,x+3*s,y+155*s),'#d5a385')
    oval(d,(x+54*s,y+128*s,x+145*s,y+158*s),'#d5a385')
    oval(d,(x-111*s,y+79*s,x-48*s,y+144*s),'#faf0db')
    if run:
        for dy in [67,91,115]: line(d,[(x-155*s,y+dy*s),(x-220*s,y+(dy+5)*s)],'#99b6a8',5)
    line(d,[(x+134*s,y+60*s),(x+169*s,y+53*s)],'#856f58',2)
    line(d,[(x+133*s,y+70*s),(x+168*s,y+79*s)],'#856f58',2)

def base(page, accent='#e7f0de', sunset=False):
    im=Image.new('RGB',(W*S,H*S),BG);d=ImageDraw.Draw(im)
    roundbox(d,(46,45,1154,1555),42,'#fffdf7',outline='#e7dfca',width=3)
    roundbox(d,(75,74,1125,1175),36,'#f2e6cd' if sunset else accent)
    oval(d,(120,315,1050,1160),'#d2e4c4' if not sunset else '#f0d3a9')
    cloud(d,165,220,.8);cloud(d,794,181,.74)
    # Distant hills, winding path and tiny foreground flowers.
    oval(d,(-160,763,650,1266),'#91bd8c')
    oval(d,(500,720,1310,1316),'#79ac82')
    poly(d,[(478,1174),(615,852),(716,780),(851,785),(884,871),(724,943),(670,1174)],'#f1d8ac')
    for (px,py) in [(145,1060),(340,1117),(1020,1050),(900,1140),(260,925)]: flower(d,px,py,'#f3b9aa' if px%2 else '#ffe0a1',.75)
    text(d,(105,1245),f'{page:02d}  /  龟兔赛跑',font(22),fill='#789280')
    return im,d

def caption(d,lines):
    roundbox(d,(83,1280,1117,1515),35,'#fff8ed',outline='#dfcda9',width=2)
    # Keep text short enough for a child and for easy manual OCR correction.
    for i,line_ in enumerate(lines): text(d,(600,1346+i*77),line_,font(42 if len(line_)<24 else 38),anchor='ma')

def save(im,number):
    im=im.resize((W,H),Image.Resampling.LANCZOS)
    path=OUT/f'{number:02d}-龟兔赛跑.png';im.save(path,optimize=True)
    print(path.name, path.stat().st_size)

# 1 Cover: warm forest under a floating title; also counts as a real book page.
im,d=base(1);tree(d,186,888,.85);tree(d,978,869,.73)
roundbox(d,(182,165,1018,387),49,'#fff7e7',outline='#e9cfab',width=3)
text(d,(600,190),'龟 兔 赛 跑',font(84),anchor='ma')
text(d,(600,314),'一本关于坚持的小故事',font(32,False),fill='#819783',anchor='ma')
tortoise(d,308,819,1.12);hare(d,737,770,1.05)
butterfly(d,630,617);caption(d,['小乌龟和小兔子，','谁能先到达终点呢？']);save(im,1)

# 2 The race begins at the forest sign.
im,d=base(2);tree(d,200,827,.9);tree(d,970,861,.8)
roundbox(d,(481,456,743,527),20,'#fff7df',outline='#a17659',width=4)
text(d,(612,466),'森林跑步赛',font(38),anchor='ma')
line(d,[(604,527),(604,790)],'#ad7a54',11)
tortoise(d,265,832,1.08);hare(d,785,839,.94)
caption(d,['兔子说：“我跑得最快！”','乌龟说：“我们比一比吧。”']);save(im,2)

# 3 Fast hare runs ahead.
im,d=base(3);tree(d,166,822,.78);tree(d,1032,828,.75)
for x,y in [(320,495),(405,462),(650,575)]: butterfly(d,x,y,'#f2bb9c')
tortoise(d,156,960,.72,walk=True);hare(d,747,815,1.12,run=True)
caption(d,['比赛开始！兔子一下跑远了。','乌龟一步一步向前走。']);save(im,3)

# 4 The hare naps under an apple tree.
im,d=base(4);tree(d,754,860,1.35)
oval(d,(518,1006,1057,1110),'#efd9b0');hare(d,735,878,1.05,asleep=True)
for x,y in [(1015,552),(559,484)]: flower(d,x,y,'#ffcf92',1)
tortoise(d,121,969,.66,walk=True)
caption(d,['兔子想：“乌龟还远着呢。”','他在树下睡着了。']);save(im,4)

# 5 The tortoise keeps going past the sleeping hare.
im,d=base(5,sunset=True);tree(d,370,843,1.17)
oval(d,(545,1023,1073,1116),'#edd5a7');hare(d,310,908,.78,asleep=True)
tortoise(d,670,907,1.02,walk=True)
for x,y in [(368,655),(470,600),(565,562)]: flower(d,x,y,'#ffcda3',.75)
caption(d,['乌龟没有停下。','一步，又一步，他走过了兔子。']);save(im,5)

# 6 The finish, with a friendly handshake.
im,d=base(6,sunset=True);tree(d,158,859,.76);tree(d,1054,858,.8)
line(d,[(378,580),(935,580)],'#866d5c',11)
for i in range(10):
    x=390+i*53
    poly(d,[(x,586),(x+24,586),(x+13,627)],'#f0b79e' if i%2 else '#fff7e7')
line(d,[(410,580),(410,1075)],'#916c55',11);line(d,[(925,580),(925,1080)],'#916c55',11)
tortoise(d,560,925,1.02);hare(d,255,855,1.02)
caption(d,['乌龟先到了终点！','兔子说：“坚持真了不起。”']);save(im,6)
