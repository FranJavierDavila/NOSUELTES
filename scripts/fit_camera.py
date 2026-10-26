"""Fit camera (targetY T, dist D) to the user's screenshot observations.

Observations (1568x1100 screenshot, vertical fov 0.95 rad, look = T+0.35,
camera y = T+1.12, camera z = -D):
  wall top edge (y=6.0)      at ~870 px
  top hold      (y=5.62)     at ~930 px
  r11           (y=5.28)     at ~970 px
  r10           (y=4.94)     at ~1015 px
  r9            (y=4.60)     at ~1050 px
All holds z ~ -0.18, wall face z ~ -0.125.
"""
import math

H = 1100.0
FOV = 0.95
half_tan = math.tan(FOV / 2)

def px(y_obj, T, D, z_obj=-0.18):
    cam_y = T + 1.12
    dy = cam_y - y_obj
    dz = D + z_obj  # horizontal distance to object plane
    ang_obj = math.atan2(dy, dz)          # below horizontal
    axis = math.atan2(0.77, D)            # camera axis below horizontal
    rel = ang_obj - axis                  # below axis
    t = math.tan(rel) / half_tan          # NDC-ish
    return H / 2 + t * (H / 2)

def err(T, D):
    obs = [(6.0, 870, 0.0), (5.62, 930, -0.18), (5.28, 970, -0.18), (4.94, 1015, -0.18), (4.60, 1050, -0.18)]
    e = 0.0
    for yo, po, zo in obs:
        e += (px(yo, T, D, zo) - po) ** 2
    return e

best = None
for T in [x * 0.05 for x in range(0, 240)]:
    for D in [x * 0.05 for x in range(80, 320)]:
        e = err(T, D)
        if best is None or e < best[0]:
            best = (e, T, D)
print("best fit: err=%.0f  targetY=%.2f  dist=%.2f" % best)
e, T, D = best
for yo, label in [(6.0, "top edge"), (5.62, "top"), (5.28, "r11"), (4.94, "r10"), (4.60, "r9"), (2.1, "start"), (1.6, "pelvis?")]:
    print(f"  {label:9s} y={yo:.2f} -> px {px(yo, T, D):6.0f}")
