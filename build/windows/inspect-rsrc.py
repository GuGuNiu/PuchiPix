import struct
import sys

RT_NAMES = {
    1: "RT_CURSOR",
    2: "RT_BITMAP",
    3: "RT_ICON",
    4: "RT_MENU",
    5: "RT_DIALOG",
    6: "RT_STRING",
    9: "RT_ACCELERATOR",
    10: "RT_RCDATA",
    12: "RT_GROUP_CURSOR",
    14: "RT_GROUP_ICON",
    16: "RT_VERSION",
    24: "RT_MANIFEST",
}

path = sys.argv[1] if len(sys.argv) > 1 else r"E:\data\Github\PuchiPix\dist-desktop\PuchiPix.exe"

with open(path, "rb") as handle:
    data = handle.read()

pe = struct.unpack_from("<I", data, 0x3C)[0]
opt = pe + 24
opt_size = struct.unpack_from("<H", data, pe + 20)[0]
section_count = struct.unpack_from("<H", data, pe + 6)[0]

resource_rva, resource_size = struct.unpack_from("<II", data, opt + 112 + 2 * 8)
if resource_rva == 0:
    print("no resource directory")
    raise SystemExit(1)

section_table = pe + 24 + opt_size
rsrc_raw = None
rsrc_vaddr = None
for index in range(section_count):
    entry = section_table + index * 40
    name = data[entry : entry + 8].rstrip(b"\x00").decode("ascii", "replace")
    if name == ".rsrc":
        _, rsrc_vaddr, _, rsrc_raw = struct.unpack_from("<IIII", data, entry + 8)
        break

if rsrc_raw is None:
    print("no .rsrc section")
    raise SystemExit(1)


def to_raw(section_offset):
    return rsrc_raw + section_offset


def walk(directory_offset, depth, prefix):
    count_named, count_id = struct.unpack_from("<HH", data, to_raw(directory_offset) + 12)
    total = count_named + count_id
    for index in range(total):
        entry_offset = to_raw(directory_offset + 16 + index * 8)
        name_id, offset_to_data = struct.unpack_from("<II", data, entry_offset)
        is_name = bool(name_id & 0x80000000)
        is_subdir = bool(offset_to_data & 0x80000000)

        if is_name:
            str_offset = to_raw(name_id & 0x7FFFFFFF)
            str_len = struct.unpack_from("<H", data, str_offset)[0]
            label = data[str_offset + 2 : str_offset + 2 + str_len * 2].decode(
                "utf-16-le", "replace"
            )
        elif depth == 0:
            label = RT_NAMES.get(name_id, f"type#{name_id}")
        else:
            label = f"id#{name_id}"

        if is_subdir:
            print("  " * depth + f"{prefix}{label}/")
            walk(offset_to_data & 0x7FFFFFFF, depth + 1, "")
        else:
            leaf = to_raw(offset_to_data & 0x7FFFFFFF)
            data_rva, size, codepage, _ = struct.unpack_from("<IIII", data, leaf)
            print(
                "  " * depth
                + f"{prefix}{label}  size={size} codepage={codepage} rva=0x{data_rva:x}"
            )


print(f"resource dir rva=0x{resource_rva:x} size={resource_size}")
walk(0, 0, "")
