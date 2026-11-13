"""Builds the SVG diagrams in this folder (run: python docs/diagrams/build.py).

Grammar from the diagram-design skill (github.com/cathrynlavery/diagram-design): paper ground,
hairline boxes, orthogonal connectors with r=8 bends, masked labels 6px off their line, one
focal node in the accent. Skin is Remembot's: archival paper and carbon ink, cobalt as the
accent, verdigris for calls to external services. Fonts fall back to system stacks because
GitHub shows these as images and loads no web fonts.
"""
from pathlib import Path

PAPER, PAPER2, INK, MUTED = '#faf8f5', '#f2efe9', '#141413', '#5c5a55'
RULE, ACCENT, ACCENT_TINT, LINK = 'rgba(20,20,19,0.16)', '#254edb', 'rgba(37,78,219,0.07)', '#115e59'
SANS = "Geist, -apple-system, 'Segoe UI', system-ui, sans-serif"
MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
SERIF = "Newsreader, Georgia, 'Times New Roman', serif"
HERE = Path(__file__).parent


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class Svg:
    def __init__(self, w, h, eyebrow, title):
        self.w, self.h, self.lines, self.nodes = w, h, [], []
        self.head = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title)}">',
            '<defs>',
            *(f'<marker id="{i}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c}"/></marker>'
              for i, c in (('arrow', MUTED), ('arrow-accent', ACCENT), ('arrow-link', LINK))),
            '</defs>',
            f'<rect width="100%" height="100%" fill="{PAPER}"/>',
            f'<text x="32" y="34" font-family="{MONO}" font-size="9" font-weight="500" letter-spacing="1.6" fill="{MUTED}">{esc(eyebrow.upper())}</text>',
            f'<text x="32" y="60" font-family="{SERIF}" font-size="22" fill="{INK}">{esc(title)}</text>',
        ]

    def box(self, x, y, w, h, name, sub='', focal=False, tag=''):
        stroke, fill = (ACCENT, ACCENT_TINT) if focal else (RULE, PAPER)
        out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{PAPER}"/>',
               f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="{1.4 if focal else 1}"/>']
        ty = y + (h / 2 + 4 if not sub else h / 2 - 3)
        if tag:
            out.append(f'<text x="{x + 12}" y="{y + 16}" font-family="{MONO}" font-size="7.5" font-weight="500" letter-spacing="1.4" fill="{ACCENT if focal else MUTED}">{esc(tag.upper())}</text>')
            ty += 5
        out.append(f'<text x="{x + 12}" y="{ty}" font-family="{SANS}" font-size="12.5" font-weight="600" fill="{INK}">{esc(name)}</text>')
        for i, line in enumerate(sub.split('\n') if sub else []):
            out.append(f'<text x="{x + 12}" y="{ty + 15 + i * 12}" font-family="{MONO}" font-size="9" fill="{MUTED}">{esc(line)}</text>')
        self.nodes += out

    def path(self, d, color=MUTED, dashed=False, marker='arrow'):
        dash = ' stroke-dasharray="5,4"' if dashed else ''
        self.lines.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.2"{dash} marker-end="url(#{marker})"/>')

    def label(self, x, y, text, color=MUTED, anchor='middle'):
        w = len(text) * 5.3 + 10
        rx = x - w / 2 if anchor == 'middle' else x - 5
        self.lines.append(f'<rect x="{rx:.1f}" y="{y - 9}" width="{w:.1f}" height="13" fill="{PAPER}"/>')
        self.lines.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{MONO}" font-size="8.5" letter-spacing="0.4" fill="{color}">{esc(text)}</text>')

    def note(self, x, y, text, color=MUTED, size=9, anchor='start', family=MONO):
        self.nodes.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{family}" font-size="{size}" fill="{color}">{esc(text)}</text>')

    def raw(self, s, behind=True):
        (self.lines if behind else self.nodes).append(s)

    def save(self, name):
        (HERE / name).write_text('\n'.join(self.head + self.lines + self.nodes + ['</svg>']) + '\n', encoding='utf8')


def elbow_h(x1, y1, x2, y2, bx, r=8):
    """Horizontal out, vertical at bx, horizontal in: right-angle bends with radius r."""
    sy = 1 if y2 > y1 else -1
    return (f'M{x1} {y1} H{bx - r} Q{bx} {y1} {bx} {y1 + sy * r} V{y2 - sy * r} Q{bx} {y2} {bx + r} {y2} H{x2}')


# 1 ─ Architecture ──────────────────────────────────────────────────────────────────────────
s = Svg(940, 470, '01 · Architecture', 'One Worker in front of everything')
s.box(32, 186, 180, 78, 'Browser', 'public/ · app.js, auth.js\nno framework, no build', tag='client')
s.box(300, 166, 236, 118, 'Cloudflare Worker', 'src/app.ts · auth, CSRF,\nrate limits, security headers\nsrc/agent.ts · the turn loop', focal=True, tag='runtime')
s.box(300, 336, 236, 80, 'D1 (SQLite)', 'db/schema.sql · users, sessions,\nturns + FTS5, thread_notes', tag='memory')
s.box(700, 88, 210, 66, 'Groq · gpt-oss-120b', 'primary model, free tier', tag='model')
s.box(700, 192, 210, 66, 'OpenAI · gpt-6-luna', 'fallback, fast tier', tag='model')
s.box(700, 300, 210, 66, 'Firecrawl search', '/v2/search · 3 results/query', tag='tool')
s.path('M212 225 H300', ACCENT, marker='arrow-accent'); s.label(256, 216, 'HTTPS · SSE', ACCENT)
s.path('M418 284 V336'); s.label(446, 314, 'SQL')
s.path(elbow_h(536, 195.5, 700, 121, 600), LINK, marker='arrow-link'); s.label(655, 112, 'chat stream', LINK)
s.path('M536 225 H700', LINK, dashed=True, marker='arrow-link'); s.label(650, 216, 'on 429 / 5xx', LINK)
s.path(elbow_h(536, 254.5, 700, 333, 660), LINK, marker='arrow-link'); s.label(683, 324, '≤6', LINK)
s.note(32, 450, 'Static pages are served by the same Worker (run_worker_first): HTTPS redirect and headers apply everywhere.', size=9)
s.save('architecture.svg')

# 2 ─ Sequence of one turn ──────────────────────────────────────────────────────────────────
s = Svg(940, 560, '02 · Sequence', 'One question, about 1.5 s to the first word')
lanes = {'Browser': 90, 'Worker': 270, 'D1': 450, 'Firecrawl': 630, 'Groq': 810}
for name, x in lanes.items():
    s.box(x - 62, 82, 124, 36, name, focal=(name == 'Worker'))
    s.raw(f'<line x1="{x}" y1="118" x2="{x}" y2="520" stroke="{RULE}" stroke-dasharray="3,4"/>')
def msg(a, b, y, text, color=MUTED, dashed=False, marker='arrow'):
    x1, x2 = lanes[a], lanes[b]
    x2 += -4 if x2 > x1 else 4
    s.path(f'M{x1} {y} H{x2}', color, dashed, marker)
    s.label((x1 + x2) / 2, y - 8, text, color)
msg('Browser', 'Worker', 160, 'POST /api/chat', ACCENT, marker='arrow-accent')
s.raw(f'<rect x="{lanes["Worker"] + 8}" y="186" width="{lanes["Firecrawl"] - lanes["Worker"] + 8}" height="96" rx="6" fill="none" stroke="{RULE}" stroke-dasharray="2,3"/>')
s.note(lanes['Worker'] + 16, 200, 'IN PARALLEL', size=7.5)
msg('Worker', 'D1', 222, 'recall: day windows + FTS5')
msg('Worker', 'Firecrawl', 246, 'search(the message)', LINK, marker='arrow-link')
msg('D1', 'Worker', 266, 'memory · ~1 ms', dashed=True)
msg('Firecrawl', 'Worker', 300, 'top 3 results · ~0.8 s', LINK, dashed=True, marker='arrow-link')
msg('Worker', 'Groq', 340, 'prompt + memory + results', LINK, marker='arrow-link')
msg('Groq', 'Worker', 376, 'tokens stream · first in ~0.5 s', LINK, dashed=True, marker='arrow-link')
msg('Worker', 'Browser', 412, 'SSE: memory, search, text, done', ACCENT, marker='arrow-accent')
msg('Worker', 'D1', 452, 'remember(turn, cited sources)')
s.note(32, 544, 'If Groq returns 429/5xx or is unreachable, the same call goes to OpenAI at once. If the results are thin, the model searches again (≤6 queries, ≤4 calls).', size=9)
s.save('sequence.svg')

# 3 ─ The agent loop ────────────────────────────────────────────────────────────────────────
s = Svg(760, 640, '03 · Flowchart', 'Every turn ends: a budget of 6 searches, 4 model calls')
X, W = 230, 260
s.box(X, 88, W, 50, 'Message arrives', 'POST /api/chat · signed in')
s.box(X, 178, W, 58, 'Recall + pre-search', 'memory and search(message), together')
s.box(X, 276, W, 58, 'Model call n', 'tools on, unless n = 4', focal=True)
s.raw(f'<polygon points="{X + W/2},374 {X + W/2 + 92},410 {X + W/2},446 {X + W/2 - 92},410" fill="{PAPER}" stroke="{RULE}"/>')
s.note(X + W/2, 414, 'web_search?', color=INK, size=12, anchor='middle', family=SANS)
s.box(X, 486, W, 50, 'Answer streams', 'cited as [n], shown live')
s.box(X, 568, W, 50, 'Remember', 'turn + timestamp + cited sources')
cx = X + W / 2
for y1, y2 in ((138, 178), (236, 276), (334, 374), (536, 568)):
    s.path(f'M{cx} {y1} V{y2}')
s.path(f'M{cx} 446 V486', ACCENT, marker='arrow-accent'); s.label(cx + 20, 470, 'no', ACCENT, anchor='start')
s.box(560, 382, 170, 58, 'Run the queries', 'all in parallel\nbudget: 6 per turn')
s.path(f'M{cx + 92} 410 H560', LINK, marker='arrow-link'); s.label(522, 401, 'yes', LINK)
s.path(f'M645 382 V313 Q645 305 637 305 H{X + W}', LINK, dashed=True, marker='arrow-link'); s.label(600, 296, 'results + budget left', LINK)
s.note(32, 300, 'The last call has', size=9); s.note(32, 313, 'no tool, so it must', size=9); s.note(32, 326, 'answer.', size=9)
s.save('agent-loop.svg')

# 4 ─ Memory recall ─────────────────────────────────────────────────────────────────────────
s = Svg(940, 400, '04 · Data flow', 'Recall happens in code, before the model sees anything')
s.box(32, 170, 170, 62, '"…last Tuesday?"', 'the user\'s message', tag='input')
s.box(270, 96, 200, 62, 'time.ts', 'phrase → day windows, user tz', tag='code')
s.box(270, 248, 200, 62, 'keywordsOf()', 'stemmed, stop words dropped', tag='code')
s.box(540, 96, 200, 62, 'Turns in each window', 'up to 6, most on topic')
s.box(540, 248, 200, 62, 'FTS5 · BM25 matches', 'only if the day was empty')
s.box(540, 170, 200, 62, 'Recent timeline', '12 newest, any thread')
s.box(780, 160, 140, 82, 'Context block', 'clock, 14-day calendar,\nMEMORY with dates', focal=True, tag='prompt')
s.path(elbow_h(202, 190, 270, 127, 236)); s.path(elbow_h(202, 212, 270, 279, 236))
s.path('M470 127 H540'); s.path('M470 279 H540')
s.path(elbow_h(740, 127, 780, 185, 760), ACCENT, marker='arrow-accent')
s.path('M740 201 H780', ACCENT, marker='arrow-accent')
s.path(elbow_h(740, 279, 780, 217, 760), ACCENT, marker='arrow-accent')
s.note(32, 360, 'About 1 ms, no model call. A day with no history reaches the model as "no exchanges recorded", which stops it inventing one.', size=9)
s.note(32, 374, 'Ambiguity is kept: "last Tuesday" on a Thursday gives two candidate days; memory decides which is real.', size=9)
s.save('memory-recall.svg')

# 5 ─ Database schema ───────────────────────────────────────────────────────────────────────
s = Svg(940, 470, '05 · Database schema', 'One schema file for SQLite locally and D1 in production')
def table(x, y, name, cols, focal=False):
    h = 30 + 16 * len(cols)
    stroke = ACCENT if focal else RULE
    s.raw(f'<rect x="{x}" y="{y}" width="200" height="{h}" rx="8" fill="{PAPER}" stroke="{stroke}" stroke-width="{1.4 if focal else 1}"/>', behind=False)
    s.raw(f'<path d="M{x} {y + 26} H{x + 200}" stroke="{RULE}"/>', behind=False)
    s.note(x + 12, y + 18, name, color=INK, size=12, family=SANS)
    for i, (col, typ) in enumerate(cols):
        s.note(x + 12, y + 44 + 16 * i, col, color=INK, size=9.5)
        s.note(x + 188, y + 44 + 16 * i, typ, size=8.5, anchor='end')
    return h
table(32, 96, 'users', [('id', 'PK'), ('email', 'UNIQUE NOCASE'), ('name', 'TEXT'), ('pass', 'PBKDF2 hash')])
table(32, 280, 'sessions', [('token_hash', 'PK sha-256'), ('user_id', '→ users'), ('expires_at', '30 days')])
table(370, 96, 'turns', [('id', 'PK'), ('user_id', '→ users'), ('thread_id', 'TEXT'), ('asked_at', 'ms, agent clock'), ('question', 'TEXT'), ('answer', 'TEXT'), ('sources', 'JSON')], focal=True)
table(708, 96, 'turns_fts', [('rowid', '= turns.id'), ('question', 'porter'), ('answer', 'unicode61')])
table(708, 260, 'thread_notes', [('user_id', 'PK'), ('thread_id', 'PK'), ('topic', 'TEXT'), ('followup', 'has {when}')])
table(370, 330, 'auth_events', [('key', 'login:, ip:, turn:'), ('at', 'kept 1 day')])
s.path('M232 137 H370'); s.label(301, 128, 'owns')
s.path('M132 196 V280'); s.label(160, 240, 'signs in', anchor='start')
s.path('M570 137 H708'); s.label(639, 128, 'indexed by')
s.path(elbow_h(570, 185, 708, 301, 640)); s.label(652, 250, 'per thread', anchor='start')
s.note(32, 446, 'Ownership is by user_id in every query (no FK constraints); deleting a chat or an account removes its turns, index rows and notes together.', size=9)
s.save('database.svg')
print('built', sorted(p.name for p in HERE.glob('*.svg')))
