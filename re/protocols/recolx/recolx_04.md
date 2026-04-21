# Recolx Protocol 04 (WiFi Pen)

> **Status**: WIP — partially decompiled; no live capture  
> **Source**: `ble_cmd_send_04.dart` / `ble_data_handler_04.dart`, model `"04"`, companyId `0x6572` (25970)  
> **Hardware**: Not available — protocol correctness cannot be confirmed by live capture

---

## Overview

Model 04 is a **WiFi-capable recording pen**. File sync does **not** go over BLE — files are transferred via WiFi or cloud. The BLE link is used only for device control (recording start/stop, settings, time sync, battery).

---

## GATT Profile

| Short UUID | Role                     |
|------------|--------------------------|
| `1801`     | Discover service         |
| `6001`     | Write service            |
| `6002`     | Command write (CMD_TX)   |
| `6003`     | Read / notify (CTRL_RX)  |
| `6004`     | Update notify            |
| `ff12/15/14` | OTA service/write/notify |

All expanded with `-0000-1000-8000-00805f9b34fb`.

---

## Frame Format

**TX**: `A0 <opcode> <sub> [value]` — 3 or 4 bytes

- Simple (3-byte): `A0 <op> 0x00`
- Toggle (4-byte): `A0 <op> 0x01 <0|1>` — `0`=off, `1`=on (note: opposite polarity to Protocol 01)
- JSON command: `A0 87 <len> <json bytes>`

**RX**: dispatch on `data[2]`; only `0x54` decoded in Dart source (others TODO).

---

## Connect Sequence

```
TX: A0 87 <len> {"time":"yyyyMMddHHmmss"}   syncTime (JSON)
TX: A0 80 00                                 unknown init
TX: A0 56 01 00                              unknown init
```

## Known TX Commands

| Frame                          | Name              |
|--------------------------------|-------------------|
| `A0 87 <len> {"time":"..."}` | syncTime (JSON)   |
| `A0 80 00`                    | init (unknown)    |
| `A0 56 01 00`                 | init (unknown)    |

## Known RX Opcodes

| Op     | Meaning          |
|--------|------------------|
| `0x54` | Recording started |

---

## TODO

- [ ] Live capture to map all RX opcodes
- [ ] Identify all TX commands (recording stop, battery, settings)
- [ ] Confirm WiFi file sync flow (out of scope for BLE RE)
