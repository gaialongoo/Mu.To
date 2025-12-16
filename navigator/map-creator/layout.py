from model import Corridoio

START_X = 100
START_Y = 120
GAP_X = 120
GAP_Y = 140

def build_layout(stanze):
    grid = {(s.row, s.col): s for s in stanze}
    corridoi = []

    for s in stanze:
        s.compute_size()
        s.x = START_X + s.col * (s.w + GAP_X)
        s.y = START_Y + s.row * (s.h + GAP_Y)
        s.porta = {
            "N": (s.x + s.w/2, s.y),
            "S": (s.x + s.w/2, s.y + s.h),
            "W": (s.x, s.y + s.h/2),
            "E": (s.x + s.w, s.y + s.h/2)
        }
        s.layout_objects()

    for s in stanze:
        if (s.row, s.col + 1) in grid:
            t = grid[(s.row, s.col + 1)]
            c = Corridoio(s, t)
            c.x = s.porta["E"][0]
            c.y = s.porta["E"][1] - 20
            c.w = t.porta["W"][0] - c.x
            c.h = 40
            corridoi.append(c)

        if (s.row + 1, s.col) in grid:
            t = grid[(s.row + 1, s.col)]
            c = Corridoio(s, t)
            c.x = s.porta["S"][0] - 20
            c.y = s.porta["S"][1]
            c.w = 40
            c.h = t.porta["N"][1] - c.y
            corridoi.append(c)

    return corridoi
