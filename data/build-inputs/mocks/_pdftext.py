import re, zlib, sys, json

PDF_PATH = sys.argv[1]
data = open(PDF_PATH, 'rb').read()

objs = {}
for m in re.finditer(rb'(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b', data):
    num = int(m.group(1))
    start = m.end()
    end = data.find(b'endobj', start)
    if end == -1:
        end = len(data)
    objs[num] = data[start:end]

def strip_ws(s, i):
    n = len(s)
    while i < n:
        c = s[i:i+1]
        if c in b' \t\r\n\f\0':
            i += 1
        elif c == b'%':
            j = s.find(b'\n', i)
            i = j+1 if j != -1 else n
        else:
            break
    return i

def parse_value(s, i):
    i = strip_ws(s, i)
    if i >= len(s):
        return None, i
    c = s[i:i+1]
    if c == b'/':
        j = i+1
        while j < len(s) and s[j:j+1] not in b' \t\r\n\f\0/<>[]()%':
            j += 1
        return ('name', s[i+1:j].decode('latin1')), j
    if c == b'(':
        j = i
        buf = bytearray()
        j += 1
        depth = 1
        while j < len(s) and depth > 0:
            ch = s[j:j+1]
            if ch == b'\\':
                buf.append(s[j]); buf.append(s[j+1] if j+1 < len(s) else 0)
                j += 2
                continue
            elif ch == b'(':
                depth += 1
            elif ch == b')':
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            buf.append(s[j])
            j += 1
        return ('string', bytes(buf)), j
    if c == b'<' and s[i+1:i+2] == b'<':
        j = i+2
        d = {}
        while True:
            j = strip_ws(s, j)
            if s[j:j+2] == b'>>':
                j += 2
                break
            keyval, j = parse_value(s, j)
            if keyval is None or keyval[0] != 'name':
                break
            key = keyval[1]
            val, j = parse_value(s, j)
            d[key] = val
        return ('dict', d), j
    if c == b'<':
        j = s.find(b'>', i)
        return ('hexstring', s[i+1:j]), j+1
    if c == b'[':
        j = i+1
        arr = []
        while True:
            j = strip_ws(s, j)
            if s[j:j+1] == b']':
                j += 1
                break
            v, j = parse_value(s, j)
            arr.append(v)
        return ('array', arr), j
    m = re.match(rb'[+-]?[0-9]*\.?[0-9]+', s[i:])
    if m:
        numtxt = m.group(0)
        j = i + len(numtxt)
        save = j
        j2 = strip_ws(s, j)
        m2 = re.match(rb'[0-9]+', s[j2:])
        if m2:
            j3 = j2 + len(m2.group(0))
            j4 = strip_ws(s, j3)
            if s[j4:j4+1] == b'R' and (j4+1 >= len(s) or s[j4+1:j4+2] in b' \t\r\n\f\0/<>[]()%'):
                return ('ref', int(numtxt), int(m2.group(0))), j4+1
        val = float(numtxt) if (b'.' in numtxt) else int(numtxt)
        return ('num', val), save
    m = re.match(rb'true|false|null', s[i:])
    if m:
        return ('kw', m.group(0).decode()), i+len(m.group(0))
    return ('unknown', s[i:i+1]), i+1

def parse_object(body):
    val, i = parse_value(body, 0)
    return val

parsed = {}
for num, body in objs.items():
    try:
        parsed[num] = parse_object(body)
    except Exception:
        parsed[num] = None

def get_dict(val):
    if val is None:
        return None
    if val[0] == 'dict':
        return val[1]
    return None

def resolve(val):
    while val is not None and val[0] == 'ref':
        val = parsed.get(val[1])
    return val

def get_stream_raw(num):
    body = objs.get(num)
    if body is None:
        return None
    m = re.search(rb'stream\r?\n', body)
    if not m:
        return None
    start = m.end()
    end = body.find(b'endstream', start)
    if end == -1:
        return None
    raw = body[start:end]
    if raw.endswith(b'\r\n'):
        raw = raw[:-2]
    elif raw.endswith(b'\n') or raw.endswith(b'\r'):
        raw = raw[:-1]
    return raw

def get_stream_decoded(num):
    d = get_dict(parsed.get(num))
    raw = get_stream_raw(num)
    if raw is None:
        return None
    filt = d.get('Filter') if d else None
    filt = resolve(filt) if filt else None
    filters = []
    if filt:
        if filt[0] == 'name':
            filters = [filt[1]]
        elif filt[0] == 'array':
            filters = [resolve(x)[1] for x in filt[1]]
    out = raw
    for f in filters:
        if f == 'FlateDecode':
            try:
                out = zlib.decompress(out)
            except Exception:
                try:
                    out = zlib.decompressobj().decompress(out)
                except Exception as e:
                    print("flate fail", num, e, file=sys.stderr)
    return out

root_num = None
for num, val in parsed.items():
    d = get_dict(val)
    if d and 'Type' in d and d['Type'] == ('name','Catalog'):
        root_num = num
        break
root = get_dict(parsed[root_num])
pages_root = resolve(root['Pages'])

def collect_pages(node, acc):
    d = get_dict(node)
    if d is None:
        return
    t = d.get('Type')
    if t == ('name','Pages'):
        kids = resolve(d.get('Kids'))
        if kids and kids[0]=='array':
            for k in kids[1]:
                collect_pages(resolve(k), acc)
    elif t == ('name','Page'):
        acc.append(d)

pages = []
collect_pages(pages_root, pages)
print("num pages:", len(pages), file=sys.stderr)

def get_inherited(d, key):
    cur = d
    seen = 0
    while cur is not None and seen < 20:
        if key in cur:
            return resolve(cur[key])
        parent = cur.get('Parent')
        if parent is None:
            break
        cur = get_dict(resolve(parent))
        seen += 1
    return None

def parse_tounicode(cmap_bytes):
    text = cmap_bytes.decode('latin1', errors='replace')
    mapping = {}
    for m in re.finditer(r'beginbfchar(.*?)endbfchar', text, re.S):
        body = m.group(1)
        for mm in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', body):
            src = mm.group(1); dst = mm.group(2)
            code = int(src, 16)
            chars = bytes.fromhex(dst)
            try:
                s = chars.decode('utf-16-be')
            except Exception:
                s = ''
            mapping[code] = s
    for m in re.finditer(r'beginbfrange(.*?)endbfrange', text, re.S):
        body = m.group(1)
        for mm in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', body):
            lo = int(mm.group(1),16); hi = int(mm.group(2),16)
            dststart = mm.group(3)
            dstbytes = bytes.fromhex(dststart)
            base = int.from_bytes(dstbytes,'big')
            for c in range(lo, hi+1):
                val = base + (c-lo)
                try:
                    s = val.to_bytes(2,'big').decode('utf-16-be')
                except Exception:
                    s = ''
                mapping[c] = s
        for mm in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]', body, re.S):
            lo = int(mm.group(1),16); hi = int(mm.group(2),16)
            arr = re.findall(r'<([0-9A-Fa-f]+)>', mm.group(3))
            for idx, c in enumerate(range(lo, hi+1)):
                if idx < len(arr):
                    chars = bytes.fromhex(arr[idx])
                    try:
                        s = chars.decode('utf-16-be')
                    except Exception:
                        s = ''
                    mapping[c] = s
    return mapping

def parse_w_array(w_val, dw):
    widths = {}
    if w_val is None or w_val[0] != 'array':
        return widths
    arr = w_val[1]
    i = 0
    n = len(arr)
    while i < n:
        first = resolve(arr[i])
        if first is None or first[0] != 'num':
            i += 1
            continue
        c_first = int(first[1])
        nxt = resolve(arr[i+1]) if i+1 < n else None
        if nxt and nxt[0] == 'array':
            for k, wv in enumerate(nxt[1]):
                wvr = resolve(wv)
                if wvr and wvr[0]=='num':
                    widths[c_first+k] = wvr[1]
            i += 2
        elif nxt and nxt[0] == 'num':
            c_last = int(nxt[1])
            w3 = resolve(arr[i+2]) if i+2 < n else None
            wv = w3[1] if w3 and w3[0]=='num' else dw
            for c in range(c_first, c_last+1):
                widths[c] = wv
            i += 3
        else:
            i += 1
    return widths

def get_font_info(fontref):
    fd = get_dict(fontref)
    if fd is None:
        return None
    subtype = fd.get('Subtype')
    info = {'subtype': subtype[1] if subtype else None, 'tounicode': None, 'bytes_per_char': 1, 'widths': {}, 'dw': 1000}
    tu = fd.get('ToUnicode')
    if tu:
        tunum = tu[1] if tu[0]=='ref' else None
        stream = get_stream_decoded(tunum) if tunum else None
        if stream:
            info['tounicode'] = parse_tounicode(stream)
    if subtype and subtype[1] == 'Type0':
        info['bytes_per_char'] = 2
        df = fd.get('DescendantFonts')
        dfr = resolve(df) if df else None
        if dfr and dfr[0]=='array' and dfr[1]:
            desc = get_dict(resolve(dfr[1][0]))
            if desc:
                dwv = desc.get('DW')
                dwvr = resolve(dwv) if dwv else None
                dw = dwvr[1] if dwvr and dwvr[0]=='num' else 1000
                info['dw'] = dw
                w = desc.get('W')
                wr = resolve(w) if w else None
                info['widths'] = parse_w_array(wr, dw)
    return info

def get_width(finfo, code):
    if finfo is None:
        return 500
    return finfo['widths'].get(code, finfo['dw'])

def decode_string_with_font(raw_bytes, finfo):
    if finfo is None:
        return raw_bytes.decode('latin1', errors='replace')
    if finfo['tounicode']:
        bpc = finfo['bytes_per_char']
        out = []
        if bpc == 2:
            for i in range(0, len(raw_bytes)-1, 2):
                code = (raw_bytes[i]<<8) | raw_bytes[i+1]
                out.append(finfo['tounicode'].get(code, ''))
        else:
            for b in raw_bytes:
                out.append(finfo['tounicode'].get(b, ''))
        return ''.join(out)
    return raw_bytes.decode('latin1', errors='replace')

def tokenize_content(cs):
    i = 0
    n = len(cs)
    tokens = []
    while i < n:
        c = cs[i:i+1]
        if c in b' \t\r\n\f\0':
            i += 1
            continue
        if c == b'%':
            j = cs.find(b'\n', i)
            i = j+1 if j!=-1 else n
            continue
        if c == b'/':
            j = i+1
            while j<n and cs[j:j+1] not in b' \t\r\n\f\0/<>[]()%':
                j+=1
            tokens.append(('name', cs[i+1:j].decode('latin1')))
            i = j
            continue
        if c == b'(':
            depth=1; j=i+1; buf=bytearray()
            while j<n and depth>0:
                ch = cs[j:j+1]
                if ch==b'\\':
                    if j+1<n:
                        buf.append(cs[j]); buf.append(cs[j+1])
                    j+=2
                    continue
                elif ch==b'(':
                    depth+=1
                elif ch==b')':
                    depth-=1
                    if depth==0:
                        j+=1
                        break
                buf.append(cs[j])
                j+=1
            tokens.append(('string', bytes(buf)))
            i=j
            continue
        if c == b'<' and cs[i+1:i+2]==b'<':
            depth=1; j=i+2
            while j<n and depth>0:
                if cs[j:j+2]==b'<<':
                    depth+=1; j+=2
                elif cs[j:j+2]==b'>>':
                    depth-=1; j+=2
                else:
                    j+=1
            tokens.append(('dict', cs[i:j]))
            i=j
            continue
        if c == b'<':
            j = cs.find(b'>', i)
            hexstr = cs[i+1:j]
            hexstr = re.sub(rb'\s', b'', hexstr)
            if len(hexstr)%2==1:
                hexstr += b'0'
            try:
                bs = bytes.fromhex(hexstr.decode('ascii'))
            except Exception:
                bs = b''
            tokens.append(('hexstring', bs))
            i = j+1
            continue
        if c == b'[':
            tokens.append(('op','['))
            i+=1
            continue
        if c == b']':
            tokens.append(('op',']'))
            i+=1
            continue
        m = re.match(rb'[+-]?[0-9]*\.?[0-9]+', cs[i:])
        if m and (m.group(0) not in (b'', b'.', b'-', b'+')):
            tokens.append(('num', float(m.group(0))))
            i += len(m.group(0))
            continue
        m = re.match(rb"[A-Za-z*\"\']+", cs[i:])
        if m:
            tokens.append(('op', m.group(0).decode('latin1')))
            i += len(m.group(0))
            continue
        i += 1
    return tokens

def get_page_fonts(page_dict):
    res = get_inherited(page_dict, 'Resources')
    resd = get_dict(res)
    fonts = {}
    if resd and 'Font' in resd:
        fontd = get_dict(resolve(resd['Font']))
        if fontd:
            for k, v in fontd.items():
                fonts[k] = get_font_info(resolve(v))
    return fonts

def get_page_contents_bytes(page_dict):
    c = page_dict.get('Contents')
    if c is None:
        return b''
    cr = resolve(c)
    parts = []
    if cr[0] == 'array':
        for item in cr[1]:
            num = item[1] if item[0]=='ref' else None
            if num is not None:
                s = get_stream_decoded(num)
                if s: parts.append(s)
    else:
        if c[0]=='ref':
            s = get_stream_decoded(c[1])
            if s: parts.append(s)
    return b'\n'.join(parts)

def mat_mul(a,b):
    a0,a1,a2,a3,a4,a5=a
    b0,b1,b2,b3,b4,b5=b
    return [
        a0*b0+a1*b2, a0*b1+a1*b3,
        a2*b0+a3*b2, a2*b1+a3*b3,
        a4*b0+a5*b2+b4, a4*b1+a5*b3+b5
    ]

def apply_point(x, y, m):
    return (x*m[0] + y*m[2] + m[4], x*m[1] + y*m[3] + m[5])

def extract_page_text_items(page_dict):
    fonts = get_page_fonts(page_dict)
    content = get_page_contents_bytes(page_dict)
    toks = tokenize_content(content)
    items = []
    tm = [1,0,0,1,0,0]
    tlm = [1,0,0,1,0,0]
    ctm = [1,0,0,1,0,0]
    gstack = []
    cur_font = None
    font_size = 0
    i=0
    n=len(toks)
    args=[]
    seq = 0
    while i<n:
        kind,val = toks[i]
        if kind in ('num','name','string','hexstring'):
            args.append((kind,val))
            i+=1
            continue
        if kind=='op' and val=='[':
            j=i+1
            arr=[]
            while j<n and not (toks[j][0]=='op' and toks[j][1]==']'):
                arr.append(toks[j])
                j+=1
            args.append(('arr', arr))
            i=j+1
            continue
        if kind=='op':
            op = val
            if op=='q':
                gstack.append(list(ctm))
            elif op=='Q':
                if gstack:
                    ctm = gstack.pop()
            elif op=='cm':
                nums=[a[1] for a in args if a[0]=='num']
                if len(nums)>=6:
                    ctm = mat_mul(nums[-6:], ctm)
            elif op=='Tf':
                if len(args)>=2:
                    cur_font = args[-2][1] if args[-2][0]=='name' else cur_font
                    font_size = args[-1][1] if args[-1][0]=='num' else font_size
            elif op=='Tm':
                nums=[a[1] for a in args if a[0]=='num']
                if len(nums)>=6:
                    tm = nums[-6:]
                    tlm = list(tm)
            elif op in ('Td','TD'):
                nums=[a[1] for a in args if a[0]=='num']
                if len(nums)>=2:
                    tx,ty = nums[-2:]
                    tlm = mat_mul([1,0,0,1,tx,ty], tlm)
                    tm = list(tlm)
            elif op=='T*':
                tlm = mat_mul([1,0,0,1,0,0], tlm)
                tm = list(tlm)
            elif op in ('Tj',"'",'"'):
                strs=[a for a in args if a[0] in ('string','hexstring')]
                if strs:
                    raw = strs[-1][1]
                    finfo = fonts.get(cur_font)
                    text = decode_string_with_font(raw, finfo)
                    dx, dy = apply_point(tm[4], tm[5], ctm)
                    # compute device-space end x using last CID's width
                    w_local = 0.0
                    if finfo is not None and len(raw) >= 2:
                        code = (raw[-2]<<8) | raw[-1]
                        w_local = get_width(finfo, code)/1000.0*font_size
                    ex, ey = apply_point(tm[4]+w_local*tm[0], tm[5]+w_local*tm[1], ctm)
                    items.append({'x':dx,'y':dy,'xend':ex,'text':text,'size':font_size,'seq':seq})
                    seq += 1
            elif op=='TJ':
                arrs=[a for a in args if a[0]=='arr']
                if arrs:
                    dx, dy = apply_point(tm[4], tm[5], ctm)
                    buf=[]
                    last_code = None
                    for it in arrs[-1]:
                        if not (isinstance(it, tuple) and len(it) >= 2): continue
                        k, v = it[0], it[1]
                        if k in ('string','hexstring'):
                            finfo = fonts.get(cur_font)
                            buf.append(decode_string_with_font(v, finfo))
                            if finfo is not None and len(v) >= 2:
                                last_code = ((v[-2]<<8) | v[-1], finfo)
                        elif k=='num':
                            if v < -100:
                                buf.append(' ')
                    text = ''.join(buf)
                    w_local = 0.0
                    if last_code is not None:
                        code, finfo = last_code
                        w_local = get_width(finfo, code)/1000.0*font_size
                    ex, ey = apply_point(tm[4]+w_local*tm[0], tm[5]+w_local*tm[1], ctm)
                    items.append({'x':dx,'y':dy,'xend':ex,'text':text,'size':font_size,'seq':seq})
                    seq += 1
            args=[]
            i+=1
            continue
        i+=1
    return items

def reconstruct_lines(items, y_tol=2.0):
    if not items:
        return []
    items = sorted(items, key=lambda it: (-round(it['y']/y_tol), it['x']))
    lines = []
    cur_y = None
    cur_line = []
    for it in items:
        if cur_y is None or abs(it['y']-cur_y) > y_tol:
            if cur_line:
                lines.append(cur_line)
            cur_line = [it]
            cur_y = it['y']
        else:
            cur_line.append(it)
    if cur_line:
        lines.append(cur_line)
    out = []
    for line in lines:
        line_sorted = sorted(line, key=lambda it: (it['x'], it['seq']))
        text_parts = []
        prev_end = None
        for it in line_sorted:
            t = it['text']
            if prev_end is not None:
                gap = it['x'] - prev_end
                if gap > 0.6 and not t.startswith(' ') and text_parts and not text_parts[-1].endswith(' '):
                    text_parts.append(' ')
            text_parts.append(t)
            prev_end = it.get('xend', it['x'])
        out.append((line_sorted[0]['y'], ''.join(text_parts)))
    return out

mode = sys.argv[2] if len(sys.argv) > 2 else 'lines'

all_text = []
for pi, pg in enumerate(pages):
    items = extract_page_text_items(pg)
    all_text.append(f"\n===== PAGE {pi+1} =====\n")
    if mode == 'stream':
        for it in items:
            t = it['text']
            if t.strip():
                all_text.append(t)
    else:
        lines = reconstruct_lines(items)
        for y, t in lines:
            all_text.append(t)

result = '\n'.join(all_text)
result = result.replace('\t', ' ')
outpath = sys.argv[2]
with open(outpath, 'w', encoding='utf-8') as f:
    f.write(result)
print("wrote", outpath, "chars:", len(result), file=sys.stderr)
