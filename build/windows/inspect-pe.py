import struct
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r"E:\data\Github\PuchiPix\dist-desktop\PuchiPix.exe"

with open(path, "rb") as handle:
    data = handle.read()

pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
assert data[pe_offset : pe_offset + 4] == b"PE\x00\x00", "not a PE file"

machine, section_count = struct.unpack_from("<HH", data, pe_offset + 4)
opt_offset = pe_offset + 24
opt_magic = struct.unpack_from("<H", data, opt_offset)[0]
print("machine: 0x%04X (0x8664 = amd64)" % machine)
print("optional header magic: 0x%04X (0x20B = PE32+)" % opt_magic)

opt_size = struct.unpack_from("<H", data, pe_offset + 20)[0]
section_table = pe_offset + 24 + opt_size

print("sections:")
found_rsrc = False
for index in range(section_count):
    entry = section_table + index * 40
    name = data[entry : entry + 8].rstrip(b"\x00").decode("ascii", "replace")
    virtual_size, virtual_addr, raw_size, raw_offset = struct.unpack_from(
        "<IIII", data, entry + 8
    )
    print(
        "  %-8s vsize=%-8d vaddr=0x%-8x rawsize=%-8d rawoff=0x%x"
        % (name, virtual_size, virtual_addr, raw_size, raw_offset)
    )
    if name == ".rsrc" and raw_size > 0:
        found_rsrc = True
        rsrc_offset = raw_offset
        rsrc_size = raw_size

if not found_rsrc:
    print("RESULT: no .rsrc section -> resources NOT linked")
    raise SystemExit(1)

print("RESULT: .rsrc present, %d bytes at 0x%x" % (rsrc_size, rsrc_offset))

blob = data[rsrc_offset : rsrc_offset + rsrc_size]
for marker, label in (
    (b"V\x00S\x00_\x00V\x00E\x00R\x00S\x00I\x00O\x00N\x00_\x00I\x00N\x00F\x00O\x00", "VS_VERSION_INFO"),
    (b"P\x00u\x00c\x00h\x00i\x00P\x00i\x00x\x00", "ProductName string"),
):
    print("  contains %-18s : %s" % (label, marker in blob))
