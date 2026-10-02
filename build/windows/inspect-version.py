import re
import struct
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r"E:\data\Github\PuchiPix\dist-desktop\PuchiPix.exe"

with open(path, "rb") as handle:
    data = handle.read()

pe = struct.unpack_from("<I", data, 0x3C)[0]
opt = pe + 24
opt_size = struct.unpack_from("<H", data, pe + 20)[0]
section_count = struct.unpack_from("<H", data, pe + 6)[0]
section_table = pe + 24 + opt_size

rsrc_raw = rsrc_vaddr = None
for index in range(section_count):
    entry = section_table + index * 40
    name = data[entry : entry + 8].rstrip(b"\x00").decode("ascii", "replace")
    if name == ".rsrc":
        _, rsrc_vaddr, _, rsrc_raw = struct.unpack_from("<IIII", data, entry + 8)
        break

if rsrc_raw is None:
    print("no .rsrc section")
    raise SystemExit(1)

marker = "VS_VERSION_INFO".encode("utf-16-le")
pos = data.find(marker, rsrc_raw, rsrc_raw + 40000)
if pos < 0:
    print("VS_VERSION_INFO not found")
    raise SystemExit(1)

block_start = pos - 6
wLength, wValueLength, wType = struct.unpack_from("<HHH", data, block_start)
print("VS_VERSION_INFO: wLength=%d wValueLength=%d wType=%d" % (wLength, wValueLength, wType))

ffi_start = block_start + 6 + len(marker) + 2
if (ffi_start % 4) != 0:
    ffi_start += 4 - (ffi_start % 4)
signature = struct.unpack_from("<I", data, ffi_start)[0]
ms = struct.unpack_from("<I", data, ffi_start + 8)[0]
ls = struct.unpack_from("<I", data, ffi_start + 12)[0]
print("VS_FIXEDFILEINFO signature: 0x%08X %s" % (
    signature, "OK" if signature == 0xFEEF04BD else "UNEXPECTED"))
print("binary version: %d.%d.%d.%d" % (ms >> 16, ms & 0xFFFF, ls >> 16, ls & 0xFFFF))

block_end = block_start + wLength
print("string table entries:")
for match in re.finditer(rb"((?:[\x20-\x7e]\x00){4,})", data[block_start:block_end]):
    text = match.group(0).decode("utf-16-le", "replace")
    if text in {
        "VS_VERSION_INFO",
        "StringFileInfo",
        "VarFileInfo",
        "Translation",
    }:
        continue
    print(f"  {text}")
