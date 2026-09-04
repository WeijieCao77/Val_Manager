#!/usr/bin/env python3
"""
Turn a NetEase Cloud Music download (.ncm) into a track for public/music.

    python3 scripts/ncm_to_aac.py "~/Music/网易云音乐/VALORANT,Grabbitz - Die For You.ncm" die-for-you

writes public/music/die-for-you.m4a and prints the line to add to
src/data/music.ts. AAC-LC at 96k through Apple's encoder (ffmpeg's aac_at,
macOS only): about the quality of a 160k mp3 at half the bytes, which is
what a phone on a slow connection needs — the 160k mp3s this started with
were reported as stuttering. The moov atom is moved to the front so the
browser can start playing before the file has finished arriving. Needs
ffmpeg on the PATH and the `cryptography` package. The .ncm container is the
download format of the owner's own library; this only unwraps it, the way
the desktop app does when it plays the file.
"""
import base64
import json
import os
import struct
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

CORE = b'hzHRAmso5kInbaxW'
META = b"#14ljk_!\\]&0U<'("
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def aes_ecb(key: bytes, data: bytes) -> bytes:
    d = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    out = d.update(data) + d.finalize()
    return out[:-out[-1]]


def unwrap(src: str, out: str) -> dict:
    f = open(src, 'rb')
    if f.read(8) != b'CTENFDAM':
        sys.exit(f'{src}: not an .ncm file')
    f.seek(2, 1)
    klen = struct.unpack('<I', f.read(4))[0]
    key = aes_ecb(CORE, bytes(b ^ 0x64 for b in f.read(klen)))[17:]
    box = bytearray(range(256))
    c = last = off = 0
    for i in range(256):
        swap = box[i]
        c = (swap + last + key[off]) & 0xff
        off = (off + 1) % len(key)
        box[i], box[c] = box[c], swap
        last = c
    mlen = struct.unpack('<I', f.read(4))[0]
    mdata = bytes(b ^ 0x63 for b in f.read(mlen))
    meta = json.loads(aes_ecb(META, base64.b64decode(mdata[22:]))[6:])
    # crc32 and a gap byte, then the cover frame: its reserved size, the
    # image's own size, the image, and padding up to the reserved size
    f.seek(5, 1)
    frame = struct.unpack('<I', f.read(4))[0]
    f.seek(4 + frame, 1)
    xor = bytes(box[(box[j & 0xff] + box[(box[j & 0xff] + (j & 0xff)) & 0xff]) & 0xff] for j in range(1, 257))
    with open(out, 'wb') as o:
        while True:
            chunk = bytearray(f.read(0x8000))
            if not chunk:
                break
            for i in range(len(chunk)):
                chunk[i] ^= xor[i & 0xff]
            o.write(chunk)
    return meta


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, slug = os.path.expanduser(sys.argv[1]), sys.argv[2]
    outdir = os.path.join(ROOT, 'public', 'music')
    os.makedirs(outdir, exist_ok=True)
    raw = os.path.join(outdir, f'.{slug}.raw')
    meta = unwrap(src, raw)
    title = meta.get('musicName', slug)
    artist = ' · '.join(a[0] for a in meta.get('artist', []))
    m4a = os.path.join(outdir, f'{slug}.m4a')
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vn',
        '-ar', '44100', '-c:a', 'aac_at', '-aac_at_mode', 'cvbr', '-b:a', '96k',
        '-movflags', '+faststart', '-map_metadata', '-1',
        '-metadata', f'title={title}', '-metadata', f'artist={artist}', m4a,
    ], check=True)
    os.remove(raw)
    print(f'{m4a}  {os.path.getsize(m4a) / 1e6:.1f} MB  {meta.get("duration", 0) // 1000}s')
    print(f"  {{ id: '{slug}', title: '{title}', artist: '{artist}', file: 'music/{slug}.m4a?v=2' }},")


if __name__ == '__main__':
    main()
