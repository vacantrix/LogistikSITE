import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
for sat_lo in (60, 90, 120):
    m = cv2.inRange(hsv, (0, sat_lo, 60), (10, 255, 255)) | cv2.inRange(hsv, (160, sat_lo, 60), (180, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print(f"--- sat_lo={sat_lo}: {len(cnts)} contours")
    for c in cnts:
        a = cv2.contourArea(c)
        if a < 4000:
            continue
        per = cv2.arcLength(c, True)
        roundness = 4 * np.pi * a / (per * per) if per else 0
        x, y, w, h = cv2.boundingRect(c)
        print(f"    area={a:7.0f} round={roundness:.2f} box=({x},{y},{w},{h})")
