import math

class Stanza:
    def __init__(self, nome):
        self.nome = nome
        self.tipo = "normale"
        self.oggetti = []

        self.row = 0
        self.col = 0
        self.x = self.y = 0
        self.w = self.h = 0
        self.porta = {}

    def compute_size(self):
        self.w = 220
        self.h = 180

    def layout_objects(self):
        if not self.oggetti:
            return
        cx = self.x + self.w / 2
        cy = self.y + self.h / 2
        r = min(self.w, self.h) * 0.3
        for i, o in enumerate(self.oggetti):
            a = 2 * math.pi * i / len(self.oggetti)
            o.pos = (cx + r * math.cos(a), cy + r * math.sin(a))


class Oggetto:
    def __init__(self, nome, stanza, connessi):
        self.nome = nome
        self.stanza = stanza
        self.connessi = connessi
        self.pos = (0, 0)
        self.visibile = True


class Corridoio:
    def __init__(self, a, b):
        self.a = a
        self.b = b
        self.x = self.y = 0
        self.w = self.h = 0
