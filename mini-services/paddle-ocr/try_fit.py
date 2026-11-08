import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
hsv = cv2.cvtColor(zone, cv2.COLOR_BGR2HSV)
m = (cv2.inRange(hsv, (0, 50, 60), (10, 255, 255)) | cv2.inRange(hsv, (160, 50, 60), (180, 255, 255))) > 0
H, W = m.shape
yy, xx = np.mgrid[0:H, 0:W]
cx, cy = 551.0, 244.0
for it in range(4):
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    ann = m & (d > 110) & (d < 200)
    ys, xs = np.where(ann)
    A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))].astype(float)
    b = (xs ** 2 + ys ** 2).astype(float)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    ncx, ncy, c = sol
    r = np.sqrt(c + ncx ** 2 + ncy ** 2)
    print(f"iter{it}: центр=({ncx:.1f},{ncy:.1f}) R={r:.1f} пикселей={len(xs)}")
    if abs(ncx - cx) < 1 and abs(ncy - cy) < 1:
        cx, cy = ncx, ncy
        break
    cx, cy = ncx, ncy

# разворот по найденному центру
zone3 = img[104:560, :]
strip = cv2.warpPolar(zone3, (2400, 320), (cx, cy), r + 20, cv2.WARP_POLAR_LINEAR | cv2.INTER_LINEAR)
cv2.imencode(".png", strip)[1].tofile("/tmp/polar_fit.png")
band = strip[int(320 * 110 / (r + 20)):int(320 * 190 / (r + 20)), :]
cv2.imencode(".png", cv2.resize(band, (2400, 240)))[1].tofile("/tmp/polar_fit_band.png")
print("saved")
