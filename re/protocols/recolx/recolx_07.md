# Recolx Protocol 07 (EarPhone)

> **Status**: WIP — partially decompiled; no live capture  
> **Source**: `ble_cmd_send_07.dart` / `ble_data_handler_07.dart`, models `"05"` (EarPhone3) / `"06"` (EarPhone2)  
> **Hardware**: Not available — protocol correctness cannot be confirmed by live capture

---

## Overview

Protocol 07 covers two TWS earphone hardware variants. Audio is forwarded to the JL Bluetooth stack as Opus frames — no local BLE audio handling.

---

## GATT Profile

### EarPhone3 (model `05`, companyId `0xEFAB`)

| Short/Full UUID                          | Role             |
|------------------------------------------|------------------|
| `1910`                                   | Discover service |
| `0000dba7-0000-1111-2222-123456789abc`   | Write            |
| `0000dba8-0000-1111-2222-123456789abc`   | Command write    |
| `0000dba9-0000-1111-2222-123456789abc`   | Read / notify    |
| `1913`                                   | Update notify    |

### EarPhone2 (model `06`, no companyId filter)

| Short UUID | Role             |
|------------|------------------|
| `1910`     | Discover + write service |
| `1912`     | Command write    |
| `1911`     | Read / notify    |
| `1913`     | Update notify    |

Both share OTA: `ff12` / `ff15` / `ff14`.

---

## Frame Format

Two TX formats coexist:

**Query** (5 bytes): `AA <op> 01 FF <checksum>`  
**Command** (variable): `55 AA <cmd> <sub> [value...]`

---

## Connect Sequence

```
TX: AA 04 01 FF DD   getBattery
TX: AA 01 01 FF E8   getFirmwareVersion
TX: AA 13 01 FF D6   stopRecording ACK
```

---

## TX Commands

### Query frames (`AA <op> 01 FF <cs>`)

| Frame               | Name              |
|---------------------|-------------------|
| `AA 04 01 FF DD`    | getBattery        |
| `AA 01 01 FF E8`    | getFirmwareVersion|
| `AA 12 01 FF E9`    | getCallStatus     |
| `AA 07 01 01 F8`    | format            |

### Command frames (`55 AA ...`)

| Frame                   | Name                        |
|-------------------------|-----------------------------|
| `55 AA 01 05`           | getFileList                 |
| `55 AA 01 08`           | cancelFileTransfer           |
| `55 AA 01 10`           | pauseRecording              |
| `55 AA 02 13 <01\|02>`  | setLED                      |
| `55 AA 02 14 <01\|02>`  | setUSB                      |
| `55 AA 02 16 <01\|02>`  | setWAV                      |
| `55 AA 02 18 <01\|02>`  | setMotor                    |

### Recording frames (`AA 05 ...`)

| Frame                  | Name                        |
|------------------------|-----------------------------|
| `AA 05 02 00 A1 D6`    | stopRecording               |
| `AA 05 02 B1 01 D6`    | startRecording (SBC)        |
| `AA 05 02 A1 03 D6`    | startRecording (OGG)        |
| `AA 05 02 A3 03 D6`    | startRecording (JL-BT)      |

---

## RX Opcodes

Dispatch on `data[2]`:

| Op     | Meaning          | Payload fields |
|--------|------------------|----------------|
| `0x01` | Firmware version | HW: `data[6]`.`data[8]`.`data[10]`, SW: `data[12]`.`data[14]`.`data[16]` |
| `0x04` | TWS battery      | `data[6]`=left, `data[8]`=right; bit 7 = charging flag |
| `0x12` | Call status      | `data[6]`: `8`=active, `10`=ended |

---

## Audio

Forwarded to JL Bluetooth as Opus frames. Not handled locally.

---

## TODO

- [ ] Live capture on both EarPhone3 and EarPhone2 variants
- [ ] Verify query checksum algorithm
- [ ] Map remaining RX opcodes
- [ ] Confirm recording audio format (Opus parameters)
