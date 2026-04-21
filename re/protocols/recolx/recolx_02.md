# Recolx Protocol 02

> **Status**: WIP — not yet captured; inferred from decompiled Dart source  
> **Source**: `ble_cmd_send_02.dart` / `ble_data_handler_02.dart`, model `"02"`, companyId `0` (no filter)  
> **Hardware**: Not available — protocol correctness cannot be confirmed by live capture

---

## Overview

Model 02 shares the same GATT layout and frame format (`55 AA`) as [Protocol 01](recolx_01.md). The key differences are:

- **No manufacturer company ID** — identified by BLE name prefix only (`Recolx`)
- Because service UUID `200a` is shared with model 01, the app selects between them using the company ID present/absent in the advertisement

TX commands and RX opcodes are assumed identical to Protocol 01 but **unverified** — no live capture has been done.

---

## GATT Profile

Identical to Protocol 01:

| Short UUID | Role                    |
|------------|-------------------------|
| `200a`     | Primary service         |
| `202a`     | Command write (CMD_TX)  |
| `203a`     | Control notify (CTRL_RX)|
| `204a`     | Audio + file-sync       |
| `ff12/15/14` | OTA service/write/notify |

---

## Frame Format

Same as Protocol 01:

- **TX**: `55 AA <cmd> <sub> [payload...]`
- **RX ctrl**: `AA 55 <len> <op> [payload...]`, dispatch on `data[3]`
- **RX audio**: `data[0] == 0x9C` → live SBC; else → file-sync packet

See [recolx_01.md](recolx_01.md) for full command and opcode tables.

---

## TODO

- [ ] Live Frida capture to confirm TX/RX is identical to Protocol 01
- [ ] Confirm file sync packet format matches
- [ ] Identify any model-02-specific opcodes or settings
