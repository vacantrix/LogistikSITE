import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
m = (cv2.inRange(hsv, (0, 60, 60), (10, 255, 255)) | cv2.inRange(hsv, (160, 60, 60), (180, 255, 255))).astype(np.float32) / 255.0
H, W = m.shape
# плотность розового в диске: свёртка маски дисковым ядром
for R in (110, 130, 150, 170):
    k = cv2.getGaussianKernel(2 * R + 1, R / 2.2)
    ker = (k @ k.T)
    ker = ker / ker.max()
    dens = cv2.filter2D(m, -1, ker, borderType=cv2.BORDER_CONSTANT)
    cy, cx = np.unravel_index(np.argmax(dens), dens.shape)
    yy, xx = np.ogrid[:H, :W]
    disk = ((xx - cx) ** 2 + (yy - cy) ** 2) <= R * R
    cover = float(m[disk].mean())
    print(f"R={R}: центр=({cx},{cy}) покрытие диска={cover:.2f}")
