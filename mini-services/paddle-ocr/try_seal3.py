import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
hsv = cv2.cvtColor(zone, cv2.COLOR_BGR2HSV)
m = (cv2.inRange(hsv, (0, 60, 60), (10, 255, 255)) | cv2.inRange(hsv, (160, 60, 60), (180, 255, 255))).astype(np.float32) / 255.0
H, W = m.shape
for R in (90, 110, 130, 150):
    k = cv2.getGaussianKernel(2 * R + 1, R / 2.2)
    ker = k @ k.T
    ker = ker / ker.max()
    dens = cv2.filter2D(m, -1, ker, borderType=cv2.BORDER_CONSTANT)
    cy, cx = np.unravel_index(np.argmax(dens), dens.shape)
    yy, xx = np.ogrid[:H, :W]
    disk = ((xx - cx) ** 2 + (yy - cy) ** 2) <= R * R
    print(f"R={R}: центр зоны=({cx},{cy}) -> полные ({cx},{cy + 104}) покрытие={float(m[disk].mean()):.2f}")
# вырежем найденное и сохраним
best = None
for R in (110, 130):
    k = cv2.getGaussianKernel(2 * R + 1, R / 2.2); ker = k @ k.T; ker /= ker.max()
    dens = cv2.filter2D(m, -1, ker, borderType=cv2.BORDER_CONSTANT)
    cy, cx = np.unravel_index(np.argmax(dens), dens.shape)
    x0, x1 = max(0, cx - R - 20), min(W, cx + R + 20)
    y0, y1 = max(0, cy - R - 20), min(H, cy + R + 20)
    crop = zone[y0:y1, x0:x1]
    big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    cv2.imencode(".png", big)[1].tofile(f"/tmp/seal_R{R}.png")
    print(f"saved R{R}: crop {crop.shape} big {big.shape}")
