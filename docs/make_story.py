# Builds 1080x1920 IG-story images: StrideQuick floating over the Stride UI.
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageFont

ROOT = r"C:\Users\Yossi\Desktop\Desktop_MIDI_APP"
UI    = ROOT + r"\StrideUI.png"
QUICK = ROOT + r"\StrideQuick.png"
FONT  = ROOT + r"\docs\_fonts\Outfit.ttf"

W, H = 1080, 1920
INK=(244,241,234); INK2=(201,194,181); COP=(229,138,46); COPLT=(221,154,82)

def F(size, weight):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f

def mul_alpha(img, f):
    r,g,b,a = img.split()
    return Image.merge('RGBA',(r,g,b,a.point(lambda v:int(v*f))))

# shared device prep
_dev = Image.open(QUICK).convert('RGBA')
DW = 920; DH = round(_dev.height*DW/_dev.width)
_dev = _dev.resize((DW, DH), Image.LANCZOS)
DX = (W-DW)//2; DCY = 1052; DY = DCY - DH//2
_has_alpha = _dev.split()[3].getextrema()[0] < 250
if not _has_alpha:
    m = Image.new('L',(DW,DH),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,DW-1,DH-1], radius=24, fill=255)
    _dev.putalpha(m)
AMASK = _dev.split()[3]

def silhouette(color, off=(0,0)):
    layer = Image.new('RGBA',(W,H),(0,0,0,0))
    solid = Image.new('RGBA',(DW,DH),color)
    layer.paste(solid,(DX+off[0],DY+off[1]),AMASK)
    return layer

def build(out, bright, blur, st, sb, gA, rimA, colorE):
    ui = Image.open(UI).convert('RGB')
    s = max(W/ui.width, H/ui.height)
    ui = ui.resize((int(ui.width*s)+1, int(ui.height*s)+1), Image.LANCZOS)
    l,t = (ui.width-W)//2,(ui.height-H)//2
    bg = ui.crop((l,t,l+W,t+H)).filter(ImageFilter.GaussianBlur(blur))
    bg = ImageEnhance.Brightness(bg).enhance(bright)
    bg = ImageEnhance.Color(bg).enhance(colorE).convert('RGBA')

    scrim = Image.new('RGBA',(W,H),(0,0,0,0)); sd = ImageDraw.Draw(scrim)
    for y in range(H):
        a = int(max(max(0.0,1-y/640)*st, max(0.0,(y-1230)/(H-1230))*sb))
        if a: sd.line([(0,y),(W,y)], fill=(7,7,8,a))
    bg = Image.alpha_composite(bg, scrim)

    glow = Image.new('RGBA',(W,H),(0,0,0,0))
    ImageDraw.Draw(glow).ellipse([W//2-560,DCY-360,W//2+560,DCY+360], fill=(230,138,46,gA))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))
    bg = Image.alpha_composite(bg, mul_alpha(silhouette((230,138,46,255)).filter(ImageFilter.GaussianBlur(46)), rimA))
    bg = Image.alpha_composite(bg, mul_alpha(silhouette((0,0,0,255),(0,34)).filter(ImageFilter.GaussianBlur(40)), 0.62))

    bg.alpha_composite(_dev,(DX,DY))
    draw = ImageDraw.Draw(bg)
    if not _has_alpha:
        draw.rounded_rectangle([DX,DY,DX+DW-1,DY+DH-1], radius=24, outline=(229,138,46,90), width=2)

    def tracked(text, cx, y, font, fill, tr):
        ws=[draw.textlength(c,font=font) for c in text]
        x=cx-(sum(ws)+tr*(len(text)-1))/2
        for c,w in zip(text,ws): draw.text((x,y),c,font=font,fill=fill); x+=w+tr

    tracked("INSIDE ABLETON LIVE", W//2, 336, F(30,700), COPLT, 8)
    draw.text((W//2,408),"One press.",          font=F(76,800), fill=INK, anchor="ma")
    draw.text((W//2,496),"Endless variations.", font=F(76,800), fill=COP, anchor="ma")
    draw.rounded_rectangle([W//2-62,600,W//2+62,606], radius=3, fill=COP)
    tracked("SOUND DESIGN ENGINE", W//2, 1520, F(22,700), COPLT, 10)
    draw.text((W//2,1556),"stridehub.io", font=F(30,600), fill=INK2, anchor="ma")

    bg.convert('RGB').save(out,'PNG'); print("saved", out)

# A: moody (UI mostly atmospheric)
build(ROOT + r"\docs\StrideQuick_Story_moody.png", 0.46, 9, 200, 215, 95, 0.55, 1.04)
# B: UI visible (curves read through)
build(ROOT + r"\docs\StrideQuick_Story_ui.png",    0.66, 5, 150, 200, 64, 0.50, 1.12)
