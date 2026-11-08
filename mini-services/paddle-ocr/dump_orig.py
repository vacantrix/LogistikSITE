import cv2, numpy as np
img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001.jpg", np.uint8), cv2.IMREAD_COLOR)
print("orig:", img.shape)
big = cv2.resize(img, None, fx=0.9, fy=0.9)
cv2.imencode(".png", big)[1].tofile("/tmp/orig_full.png")
# левая половина верха крупно
crop = img[0:900, 0:700]
cv2.imencode(".png", crop)[1].tofile("/tmp/orig_left.png")
