"""Извлечение оси трассы А-146 (Абинск -> Новороссийск) из векторных тайлов OpenFreeMap.

Декодирует Mapbox Vector Tiles (protobuf) чистым Python без зависимостей,
сшивает обрезанные по границам тайлов линии и строит непрерывную полилинию
от точки погрузки в Абинске до точки выгрузки в Новороссийске.
Результат: /tmp/a146.json — [[lng, lat], ...]
"""
import json
import math
import struct
import urllib.request

TILE_TPL = "https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf"

# --- минимальный protobuf-ридер для MVT -------------------------------------

def read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7

def read_field(buf, pos):
    key, pos = read_varint(buf, pos)
    field, wire = key >> 3, key & 7
    if wire == 0:
        val, pos = read_varint(buf, pos)
    elif wire == 2:
        ln, pos = read_varint(buf, pos)
        val = buf[pos:pos + ln]
        pos += ln
    elif wire == 5:
        val = buf[pos:pos + 4]
        pos += 4
    elif wire == 1:
        val = buf[pos:pos + 8]
        pos += 8
    else:
        raise ValueError(f"wire {wire}")
    return field, wire, val, pos

def decode_tile(data):
    """Возвращает {layer_name: [feature, ...]}, feature = {keys:.., geom: [(x,y)..]}."""
    layers = {}
    pos = 0
    while pos < len(data):
        f, w, v, pos = read_field(data, pos)
        if f == 3:  # Layers
            layers.update(decode_layer(v))
        else:
            pass
    return layers

def decode_layer(buf):
    """Автоопределение схемы: MVT 2.1 (version=1,name=2,features=3,keys=4,values=5)
    или старая 2.0 (name=1,features=2,keys=3,values=4)."""
    fields = []
    pos = 0
    while pos < len(buf):
        f, w, v, pos = read_field(buf, pos)
        fields.append((f, w, v))
    old = any(f == 1 and w == 2 and isinstance(v, (bytes, bytearray)) for f, w, v in fields)
    name = None
    keys, values, feats = [], [], []
    if old:
        # старая схема: name=1, features=2, keys=3, values=4 — фичи могут идти раньше ключей
        fkey, fval, ffeat = 3, 4, 2
    else:
        fkey, fval, ffeat = 4, 5, 3
    for f, w, v in fields:
        if old and f == 1:
            name = v.decode('utf-8')
        elif not old and f == 2:
            name = v.decode('utf-8')
        elif f == fkey:
            keys.append(v.decode('utf-8'))
        elif f == fval:
            values.append(decode_value(v))
    for f, w, v in fields:
        if f == ffeat:
            feats.append(decode_feature(v, keys, values))
    return {name: feats} if name else {}

def decode_value(buf):
    pos = 0
    out = None
    while pos < len(buf):
        f, w, v, pos = read_field(buf, pos)
        if f == 1:
            out = v.decode('utf-8')
        elif f == 2:
            out = struct.unpack('<f', v)[0]
        elif f == 3:
            out = struct.unpack('<d', v)[0]
        elif f == 4:
            out = v  # int64 varint
        elif f == 5:
            out = v  # uint64 varint
        elif f == 6:
            out = (v >> 1) ^ -(v & 1)  # sint (zigzag)
        elif f == 7:
            out = v != 0
    return out

def decode_feature(buf, keys, values):
    tags_raw = b''
    gtype = None
    geom = None
    pos = 0
    while pos < len(buf):
        f, w, v, pos = read_field(buf, pos)
        if f == 1:
            pass  # id
        elif f == 2:
            tags_raw = v
        elif f == 3:
            gtype = v
        elif f == 4:
            geom = v
    tags = []
    if tags_raw:
        p = 0
        while p < len(tags_raw):
            val, p = read_varint(tags_raw, p)
            tags.append(val)
    props = {}
    for i in range(0, len(tags) - 1, 2):
        props[keys[tags[i]]] = values[tags[i + 1]]
    coords = decode_geom(geom, gtype)
    return {'props': props, 'coords': coords, 'type': gtype}

def decode_geom(geom, gtype):
    if geom is None:
        return []
    x = y = 0
    pos = 0
    lines = []
    cur = []
    while pos < len(geom):
        key, pos = read_varint(geom, pos)
        cmd = key & 7
        cnt = key >> 3
        if cmd == 1:  # MoveTo
            for _ in range(cnt):
                dx, pos = read_zig(geom, pos)
                dy, pos = read_zig(geom, pos)
                if cur:
                    lines.append(cur)
                x += dx
                y += dy
                cur = [(x, y)]
        elif cmd == 2:  # LineTo
            for _ in range(cnt):
                dx, pos = read_zig(geom, pos)
                dy, pos = read_zig(geom, pos)
                x += dx
                y += dy
                cur.append((x, y))
        elif cmd == 7:  # Close
            pass
    if cur:
        lines.append(cur)
    return lines if gtype == 2 else lines  # LineString/MultiLine

def read_zig(buf, pos):
    v, pos = read_varint(buf, pos)
    return (v >> 1) ^ -(v & 1), pos

# --- тайлы -------------------------------------------------------------------

def deg2tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def tile2deg(x, y, z):
    n = 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat

def fetch_tile(z, x, y):
    import gzip
    url = TILE_TPL.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={'User-Agent': 'azmz-demo-builder/1.0'})
    try:
        data = urllib.request.urlopen(req, timeout=30).read()
        if data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
        return data
    except Exception as e:
        print(f"tile {z}/{x}/{y} ERR {e}")
        return None

def extract(z, bbox):
    """Скачивает тайлы bbox, возвращает список фичей слоя transportation."""
    lon1, lat1, lon2, lat2 = bbox
    x1, y1 = deg2tile(lon1, lat2, z)
    x2, y2 = deg2tile(lon2, lat1, z)
    feats = []
    for tx in range(int(x1), int(x2) + 1):
        for ty in range(int(y1), int(y2) + 1):
            data = fetch_tile(z, tx, ty)
            if not data:
                continue
            layers = decode_tile(data)
            tr = layers.get('transportation', [])
            ox, oy = tile2deg(tx, ty, z)
            n = 2 ** z
            _, top_lat = tile2deg(tx, ty, z)
            _, bot_lat = tile2deg(tx, ty + 1, z)
            for f in tr:
                for line in f['coords']:
                    coords = []
                    for px, py in line:
                        lat = bot_lat + (1 - py / 4096) * (top_lat - bot_lat)
                        lon = ox + (px / 4096) * (360 / n)
                        coords.append([round(lon, 6), round(lat, 6)])
                    feats.append({'props': f['props'], 'coords': coords})
    return feats

# --- сшивка линий ------------------------------------------------------------

def stitch(feats, start_pt, end_pt, max_gap_deg=2e-4):
    """Сшивает линии по совпадению концов; возвращает цепочку от start до end."""
    # индекс: округлённая точка -> список (feat_idx, end_idx)
    idx = {}
    def key(p):
        return (round(p[0] * 5000), round(p[1] * 5000))
    for i, f in enumerate(feats):
        c = f['coords']
        if len(c) < 2:
            continue
        idx.setdefault(key(c[0]), []).append((i, 0))
        idx.setdefault(key(c[-1]), []).append((i, 1))
    # ближайшая фича к start
    def dist2(a, b):
        return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
    best = min(range(len(feats)), key=lambda i: min(dist2(feats[i]['coords'][0], start_pt), dist2(feats[i]['coords'][-1], start_pt)))
    used = {best}
    chain = list(feats[best]['coords'])
    # наращиваем вперёд
    while True:
        tail = key(chain[-1])
        cands = [(i, e) for (i, e) in idx.get(tail, []) if i not in used]
        if not cands:
            break
        i, e = cands[0]
        c = feats[i]['coords']
        add = c if e == 1 else list(reversed(c))
        chain.extend(add[1:])
        used.add(i)
        if dist2(chain[-1], end_pt) < max_gap_deg ** 2:
            break
    # наращиваем назад
    while True:
        head = key(chain[0])
        cands = [(i, e) for (i, e) in idx.get(head, []) if i not in used]
        if not cands:
            break
        i, e = cands[0]
        c = feats[i]['coords']
        add = c if e == 0 else list(reversed(c))
        chain = add[:-1] + chain
        used.add(i)
        if dist2(chain[0], start_pt) < max_gap_deg ** 2:
            break
    return chain

if __name__ == '__main__':
    bbox = (37.70, 44.68, 38.22, 44.92)
    z = 12
    print(f"тайлы z{z} bbox {bbox}...")
    feats = extract(z, bbox)
    print('transportation lines:', len(feats))

    # второй слой: названия/номера дорог
    names_feats = []
    import math as _m
    lon1, lat1, lon2, lat2 = bbox
    x1, y1 = deg2tile(lon1, lat2, z)
    x2, y2 = deg2tile(lon2, lat1, z)
    for tx in range(int(x1), int(x2) + 1):
        for ty in range(int(y1), int(y2) + 1):
            data = fetch_tile(z, tx, ty)
            if not data:
                continue
            layers = decode_tile(data)
            tn = layers.get('transportation_name', [])
            ox, oy = tile2deg(tx, ty, z)
            n = 2 ** z
            _, top_lat = tile2deg(tx, ty, z)
            _, bot_lat = tile2deg(tx, ty + 1, z)
            for f in tn:
                for line in f['coords']:
                    coords = []
                    for px, py in line:
                        lat = bot_lat + (1 - py / 4096) * (top_lat - bot_lat)
                        lon = ox + (px / 4096) * (360 / n)
                        coords.append([round(lon, 6), round(lat, 6)])
                    names_feats.append({'props': f['props'], 'coords': coords})
    print('transportation_name lines:', len(names_feats))
    a146 = [f for f in names_feats if '146' in str(f['props'].get('ref', '')) or '146' in str(f['props'].get('name', ''))]
    print('А-146 lines:', len(a146), 'points:', sum(len(f['coords']) for f in a146))
    json.dump(names_feats, open('/tmp/tname-z12.json', 'w'))
    json.dump(a146, open('/tmp/a146-lines.json', 'w'))
    for f in a146[:20]:
        print(f['props'], f['coords'][0], '->', f['coords'][-1], 'pts', len(f['coords']))
