import cv2, numpy as np
img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
CX, CY, ROUT = 551, 244, 185
strip = cv2.warpPolar(zone, (2400, 300), (CX, CY), ROUT, cv2.WARP_POLAR_LINEAR | cv2.INTER_LINEAR)
cv2.imencode(".png", strip)[1].tofile("/tmp/polar_full.png")
band = strip[165:295, :]
band = cv2.resize(band, (2400, 260), interpolation=cv2.INTER_CUBIC)
cv2.imencode(".png", band)[1].tofile("/tmp/polar_band.png")
print("ok", strip.shape)
