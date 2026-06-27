"""
qr.py — Minimal QR code generator for MicroPython.
Byte mode, Error Correction Level L, versions 1-4.
Returns a 2D list of booleans (True = dark module).

Usage:
    import qr
    matrix = qr.generate("http://192.168.4.1")
    size = len(matrix)  # e.g. 21 for version 1
"""

# ---------------------------------------------------------------------------
# GF(256) arithmetic (prime polynomial x^8+x^4+x^3+x^2+1 = 0x11D)
# ---------------------------------------------------------------------------

_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _mul(a, b):
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _poly_mul(p, q):
    r = [0] * (len(p) + len(q) - 1)
    for i, pi in enumerate(p):
        for j, qj in enumerate(q):
            r[i + j] ^= _mul(pi, qj)
    return r


def _rs_generator(n):
    g = [1]
    for i in range(n):
        g = _poly_mul(g, [1, _EXP[i]])
    return g


def _rs_encode(data, n_ec):
    gen = _rs_generator(n_ec)
    msg = list(data) + [0] * n_ec
    for i in range(len(data)):
        coef = msg[i]
        if coef:
            for j, g in enumerate(gen):
                msg[i + j] ^= _mul(coef, g)
    return msg[len(data):]


# ---------------------------------------------------------------------------
# Version/capacity tables  (byte mode, L error correction)
# ---------------------------------------------------------------------------
#         ver: (total codewords, ec codewords, remainder bits)
_VER_INFO = {
    1: (19,  7,  0),
    2: (34, 10,  7),
    3: (55, 15,  7),
    4: (80, 20,  7),
}
# Max data bytes (byte mode, L): total_cw - ec_cw - 2 (mode+length headers)
# Actually: data_cw = total_cw - ec_cw;  usable bytes = data_cw - 3 (2 byte header + 1 terminator byte approx)
# Simpler: just use known capacity table
_MAX_BYTES = {1: 17, 2: 32, 3: 53, 4: 78}

# Alignment pattern centres (version 2+ has one at (6,18), etc.)
_ALIGN_POS = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26]}

# Format info strings for mask patterns 0-7 with ECC level L (01)
# Pre-computed from spec (15-bit BCH including mask bits)
_FORMAT_L = [
    0b111011111000100,  # mask 0
    0b111001011110011,  # mask 1
    0b111110110101010,  # mask 2
    0b111100010011101,  # mask 3
    0b110011000101111,  # mask 4
    0b110001100011000,  # mask 5
    0b110110001000001,  # mask 6
    0b110100101110110,  # mask 7
]


# ---------------------------------------------------------------------------
# Matrix helpers
# ---------------------------------------------------------------------------

def _make_matrix(size):
    return [[None] * size for _ in range(size)]


def _place_finder(m, r, c):
    for dr in range(7):
        for dc in range(7):
            edge = dr in (0, 6) or dc in (0, 6)
            inner = 2 <= dr <= 4 and 2 <= dc <= 4
            m[r + dr][c + dc] = edge or inner


def _place_separator(m, size):
    for i in range(8):
        for pos in [(7, i), (i, 7), (size - 8, i), (i, size - 8),
                    (7, size - 1 - i), (size - 1 - i, 7)]:
            if 0 <= pos[0] < size and 0 <= pos[1] < size and m[pos[0]][pos[1]] is None:
                m[pos[0]][pos[1]] = False


def _place_timing(m, size):
    for i in range(8, size - 8):
        if m[6][i] is None:
            m[6][i] = (i % 2 == 0)
        if m[i][6] is None:
            m[i][6] = (i % 2 == 0)


def _place_alignment(m, positions):
    for r in positions:
        for c in positions:
            if m[r][c] is not None:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    edge = abs(dr) == 2 or abs(dc) == 2
                    centre = dr == 0 and dc == 0
                    m[r + dr][c + dc] = edge or centre


def _place_dark_module(m, version):
    m[4 * version + 9][8] = True


def _reserve_format(m, size):
    for i in range(6):
        m[8][i] = False
        m[i][8] = False
    m[8][7] = False
    m[7][8] = False
    m[8][8] = False
    for i in range(8):
        m[size - 1 - i][8] = False
        m[8][size - 1 - i] = False


def _data_positions(size):
    """Yield (row, col) for data modules in QR placement order."""
    col = size - 1
    going_up = True
    while col >= 1:
        if col == 6:
            col -= 1
        cols = [col, col - 1]
        rows = range(size - 1, -1, -1) if going_up else range(size)
        for row in rows:
            for c in cols:
                if 0 <= c < size and _is_data(size, row, c):
                    yield row, c
        col -= 2
        going_up = not going_up


def _is_data(size, r, c):
    if c == 6 or r == 6:
        return False
    if r < 9 and c < 9:
        return False
    if r < 9 and c >= size - 8:
        return False
    if r >= size - 8 and c < 9:
        return False
    return True


def _apply_mask(matrix, size, mask_id):
    fns = [
        lambda r, c: (r + c) % 2 == 0,
        lambda r, c: r % 2 == 0,
        lambda r, c: c % 3 == 0,
        lambda r, c: (r + c) % 3 == 0,
        lambda r, c: (r // 2 + c // 3) % 2 == 0,
        lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
        lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
        lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
    ]
    fn = fns[mask_id]
    m = [row[:] for row in matrix]
    for r in range(size):
        for c in range(size):
            if _is_data(size, r, c) and fn(r, c):
                m[r][c] = not m[r][c]
    return m


def _write_format(m, size, mask_id):
    bits = _FORMAT_L[mask_id]
    fmt = [(bits >> (14 - i)) & 1 == 1 for i in range(15)]
    # Top-left area
    seqs = [0, 1, 2, 3, 4, 5, 7, 8]
    for i, col in enumerate(seqs):
        m[8][col] = fmt[i]
    for i, row in enumerate([7, 5, 4, 3, 2, 1, 0]):
        m[row][8] = fmt[i]
    m[8][8] = fmt[7]
    # Bottom-left / top-right
    for i in range(7):
        m[size - 1 - i][8] = fmt[i]
    for i in range(8):
        m[8][size - 8 + i] = fmt[7 + i]


def _penalty(m, size):
    score = 0
    # Rule 1: 5+ same-colour in a row/column
    for line in m + [[m[r][c] for r in range(size)] for c in range(size)]:
        run, cur = 0, None
        for v in line:
            if v == cur:
                run += 1
                if run == 5:
                    score += 3
                elif run > 5:
                    score += 1
            else:
                cur, run = v, 1
    # Rule 2: 2×2 blocks
    for r in range(size - 1):
        for c in range(size - 1):
            v = m[r][c]
            if v == m[r][c+1] == m[r+1][c] == m[r+1][c+1]:
                score += 3
    return score


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate(text):
    """
    Generate a QR code matrix for `text`.
    Returns a 2D list of booleans (True = dark).
    Raises ValueError if text is too long for version 4-L (78 bytes max).
    """
    data = text.encode("iso-8859-1")
    n = len(data)

    version = None
    for v, cap in _MAX_BYTES.items():
        if n <= cap:
            version = v
            break
    if version is None:
        raise ValueError(f"Text too long ({n} bytes); max 78 for version 4-L")

    total_cw, ec_cw, rem_bits = _VER_INFO[version]
    data_cw = total_cw - ec_cw
    size = 17 + 4 * version

    # --- Build codeword sequence ---
    bits = []

    def add_bits(val, length):
        for i in range(length - 1, -1, -1):
            bits.append((val >> i) & 1)

    add_bits(0b0100, 4)     # byte mode indicator
    add_bits(n, 8)          # character count (8 bits for versions 1-9)
    for byte in data:
        add_bits(byte, 8)
    # Terminator
    for _ in range(min(4, data_cw * 8 - len(bits))):
        bits.append(0)
    # Pad to multiple of 8
    while len(bits) % 8:
        bits.append(0)
    # Pad codewords
    pad_seq = [0b11101100, 0b00010001]
    pi = 0
    while len(bits) < data_cw * 8:
        add_bits(pad_seq[pi % 2], 8)
        pi += 1

    codewords = [int("".join(str(b) for b in bits[i:i+8]), 2)
                 for i in range(0, data_cw * 8, 8)]

    ec = _rs_encode(codewords, ec_cw)
    all_cw = codewords + ec

    # Convert to bit stream
    stream = []
    for cw in all_cw:
        for i in range(7, -1, -1):
            stream.append((cw >> i) & 1)
    stream += [0] * rem_bits

    # --- Build matrix skeleton ---
    m = _make_matrix(size)
    _place_finder(m, 0, 0)
    _place_finder(m, 0, size - 7)
    _place_finder(m, size - 7, 0)
    _place_separator(m, size)
    _place_timing(m, size)
    _place_alignment(m, _ALIGN_POS[version])
    _place_dark_module(m, version)
    _reserve_format(m, size)

    # Place data bits
    for bit, (r, c) in zip(stream, _data_positions(size)):
        m[r][c] = bit == 1

    # Replace any remaining None with False (shouldn't happen)
    for r in range(size):
        for c in range(size):
            if m[r][c] is None:
                m[r][c] = False

    # Choose best mask
    best_m, best_score = None, None
    for mask_id in range(8):
        candidate = _apply_mask(m, size, mask_id)
        _write_format(candidate, size, mask_id)
        s = _penalty(candidate, size)
        if best_score is None or s < best_score:
            best_m, best_score = candidate, s

    return best_m
