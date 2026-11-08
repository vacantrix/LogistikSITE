import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
hsv = cv2.cvtColor(zone, cv2.COLOR_BGR2HSV)
m = (cv2.inRange(hsv, (0, 50, 60), (10, 255, 255)) | cv2.inRange(hsv, (160, 50, 60), (180, 255, 255))).astype(np.float32) / 255.0
H, W = m.shape
yy, xx = np.mgrid[0:H, 0:W]

# 1) грубый центр по плотности, затем mean-shift диском R=200
R = 200
k = cv2.getGaussianKernel(2 * R + 1, R / 2.2); ker = k @ k.T; ker /= ker.max()
dens = cv2.filter2D(m, -1, ker, borderType=cv2.BORDER_CONSTANT)
cy, cx = [float(v) for v in np.unravel_index(np.argmax(dens), dens.shape)]
for it in range(8):
    disk = ((xx - cx) ** 2 + (yy - cy) ** 2) <= R * R
    sel = m * disk
    tot = sel.sum()
    ncy = (sel.sum(axis=1) * np.arange(H)).sum() / tot
    ncx = (sel.sum(axis=0) * np.arange(W)).sum() / tot
    done = abs(ncy - cy) < 2 and abs(ncx - cx) < 2
    cy, cx = ncy, ncx
    if done: break
print(f"центр после mean-shift R200: ({cx:.0f},{cy:.0f})")

# 2) радиальный профиль покрытия: где кольцо
dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
for r in range(100, 280, 15):
    ann = (dist >= r - 7) & (dist <= r + 7)
    print(f"  r={r}: покрытие={float(m[ann].mean()):.2f}")
