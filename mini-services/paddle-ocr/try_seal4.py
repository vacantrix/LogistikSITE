import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
hsv = cv2.cvtColor(zone, cv2.COLOR_BGR2HSV)
m = (cv2.inRange(hsv, (0, 50, 60), (10, 255, 255)) | cv2.inRange(hsv, (160, 50, 60), (180, 255, 255))).astype(np.float32) / 255.0
H, W = m.shape
R = 110
k = cv2.getGaussianKernel(2 * R + 1, R / 2.2); ker = k @ k.T; ker /= ker.max()
dens = cv2.filter2D(m, -1, ker, borderType=cv2.BORDER_CONSTANT)
cy, cx = np.unravel_index(np.argmax(dens), dens.shape)
cy, cx = float(cy), float(cx)
for it in range(6):
    yy, xx = np.ogrid[:H, :W]
    disk = ((xx - cx) ** 2 + (yy - cy) ** 2) <= R * R
    sel = m * disk
    tot = sel.sum()
    ncy = (sel.sum(axis=1) * np.arange(H)).sum() / tot
    ncx = (sel.sum(axis=0) * np.arange(W)).sum() / tot
    print(f"iter{it}: ({cx:.0f},{cy:.0f}) -> ({ncx:.0f},{ncy:.0f}) масса={tot:.0f}")
    if abs(ncy - cy) < 2 and abs(ncx - cx) < 2:
        cy, cx = ncy, ncx
        break
    cy, cx = ncy, ncx
x0, x1 = max(0, int(cx - R - 30)), min(W, int(cx + R + 30))
y0, y1 = max(0, int(cy - R - 30)), min(H, int(cy + R + 30))
crop = zone[y0:y1, x0:x1]
big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
cv2.imencode(".png", big)[1].tofile("/tmp/seal_ms.png")
print(f"центр=({cx:.0f},{cy:.0f}) crop=({x0},{y0},{x1},{y1}) {crop.shape}")
