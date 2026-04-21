# Recolx Protocol 01

> **Status**: Verified from live Frida captures (Recolx v1.2.8, Android 13)  
> **Source app**: `ai.recolx.app` v1.2.8 (Flutter/Dart AOT)  
> **Test device**: Recolx pen, BLE name prefix `Recolx`, company ID `0x0642` (1602)

---

## GATT Profile

| Short UUID | Full UUID                                | Role                    | Properties             |
|------------|------------------------------------------|-------------------------|------------------------|
| `200a`     | `0000200a-0000-1000-8000-00805f9b34fb`   | Primary service         | —                      |
| `202a`     | `0000202a-0000-1000-8000-00805f9b34fb`   | Command write (CMD_TX)  | Write-no-response      |
| `203a`     | `0000203a-0000-1000-8000-00805f9b34fb`   | Control notify (CTRL_RX)| Notify                 |
| `204a`     | `0000204a-0000-1000-8000-00805f9b34fb`   | Audio + file-sync       | Notify                 |
| `ff12`     | `0000ff12-0000-1000-8000-00805f9b34fb`   | OTA service             | —                      |
| `ff15`     | `0000ff15-0000-1000-8000-00805f9b34fb`   | OTA write               | Write                  |
| `ff14`     | `0000ff14-0000-1000-8000-00805f9b34fb`   | OTA notify              | Notify                 |

**Device identification**: advertises service `200a`. Scan filter: name prefix `Recolx` + manufacturer data company ID `0x0642`.

---

## Frame Format

### TX (host → device, `202a`)

```
55 AA <cmd> <sub> [payload...]
```

No length field, no checksum.

### RX control (device → host, `203a`)

```
AA 55 <len> <op> [payload...]
```

- `len` = 1 (op byte) + payload length
- `op` = dispatch key at `data[3]`
- `payload` = `data[4 .. 3+len]`

### RX audio/file (`204a`)

Demuxed on `data[0]`:

- `data[0] == 0x9C` → live SBC frame (standard SBC sync word); forward directly to player
- `data[0] != 0x9C` → file-sync packet (see [File Sync Protocol](#file-sync-protocol))

---

## Connect Sequence

```
TX: 55 AA 0F 02 <"yyyyMMddHHmmss" ASCII>   syncTime
RX: AA 55 01 02                             TIME_SYNC_ACK
TX: 55 AA 01 0E                             getBattery
TX: 55 AA 01 12                             getFirmwareVersion
TX: 55 AA 01 0B                             refreshStorage
TX: 55 AA 01 17                             queryDeviceSettings
```

`queryDeviceSettings` (0x17) triggers a burst of individual setting responses — see [Settings](#settings-opcodes).

---

## Outgoing Commands (TX)

### Simple 4-byte commands (`cmd=0x01`)

| Frame            | Name                |
|------------------|---------------------|
| `55 AA 01 03`    | startRecord step 1  |
| `55 AA 01 04`    | stopRecord          |
| `55 AA 01 05`    | getFileList         |
| `55 AA 01 08`    | cancelFileTransfer  |
| `55 AA 01 0B`    | refreshStorage      |
| `55 AA 01 0E`    | getBattery          |
| `55 AA 01 0F`    | queryRecordStatus   |
| `55 AA 01 12`    | getFirmwareVersion  |
| `55 AA 01 17`    | queryDeviceSettings |
| `55 AA 01 1E`    | formatStorage       |
| `55 AA 01 21`    | startRecord step 2  |
| `55 AA 01 22`    | stopRecord ACK      |
| `55 AA 01 2C`    | queryElapsedTime    |

### Toggle commands (`cmd=0x02`, 5 bytes)

State byte: `01` = off, `02` = on.

| Frame                | Name       |
|----------------------|------------|
| `55 AA 02 13 <st>`   | setLED     |
| `55 AA 02 14 <st>`   | setUSB     |
| `55 AA 02 16 <st>`   | setWAV     |
| `55 AA 02 18 <st>`   | setMotor   |
| `55 AA 02 1D <st>`   | setMode — `01`=phone mode, `02`=normal mode |

### Time sync (`cmd=0x0F sub=0x02`)

```
55 AA 0F 02 <"yyyyMMddHHmmss" as 14 ASCII bytes>
```

### Delete file (`cmd=0x0F sub=0x0A`)

```
55 AA 0F 0A 00 00 00 00 <filename as 14 ASCII bytes>
```

### Sync file (`cmd=0x13 sub=0x07`)

```
55 AA 13 07 00 00 00 00 <filename as 14 ASCII bytes>
```

---

## Incoming Events (RX, `203a`)

Dispatch on `op = data[3]`, `payload = data[4..]`.

### Control opcodes

| Op     | Name              | Payload fields |
|--------|-------------------|----------------|
| `0x01` | DISCONNECT        | — |
| `0x02` | TIME_SYNC_ACK     | — |
| `0x03` | REC_STARTED       | `[0..13]` filename (14 ASCII digits) |
| `0x04` | REC_STOPPED       | `[0..13]` filename, `[14..17]` file size uint32 BE |
| `0x05` | FILE_ENTRY        | `[0..13]` filename, `[14..17]` file size uint32 BE |
| `0x06` | FILE_LIST_END     | — |
| `0x07` | SYNC_ACK          | `[0..13]` filename, `[14..17]` file size uint32 BE |
| `0x08` | SYNC_COMPLETE     | — |
| `0x09` | SYNC_COMPLETE     | — |
| `0x0A` | DELETE_RESULT     | `[0]`: `0x02` = success |
| `0x0C` | STORAGE_FREE      | `[0..3]` free MB, uint32 BE |
| `0x0D` | STORAGE_TOTAL     | `[0..3]` total MB, uint32 BE |
| `0x0E` | BATTERY           | `[0]` percent; `0xFF` → 0% |
| `0x0F` | REC_STATUS        | `[0..]` current filename (null-prefixed, 14 ASCII digits) |
| `0x10` | REC_PAUSE         | `[0]`: `0x02`=paused, `0x04`=resumed |
| `0x12` | FIRMWARE_VERSION  | `[0..]` version string (ASCII) |
| `0x13` | LED_STATE         | `[0]`: `0x01`=on, `0x00`=off |
| `0x14` | USB_STATE         | `[0]`: `0x01`=on, `0x00`=off |
| `0x16` | WAV_STATE         | `[0]`: `0x01`=on, `0x00`=off |
| `0x18` | MOTOR_STATE       | `[0]`: `0x01`=on, `0x00`=off |
| `0x1D` | PRESET_MODE       | `[0]` mode value |
| `0x1E` | FORMAT_RESULT     | `[0]`: `0x04`=success |
| `0x20` | DISCONNECT        | — |
| `0x29` | STOP_SYNC         | — |
| `0x2B` | DISCONNECT        | — |
| `0x2C` | REC_TIME          | `[0]` lo byte, `[2]` hi byte → `(payload[2]<<8)|payload[0]` seconds |
| `0x30` | CHARGING_STATE    | `[0]`: `0x04`=charging |
| `0xFA` | ERROR/DISCONNECT  | — |
| `0xFD` | STOP_SYNC_ACK     | — |
| `0xFE` | FILE_LIST_FAIL    | — |

### Settings opcodes

All sent in a burst in response to `queryDeviceSettings` (`55 AA 01 17`). Single payload byte each.

| Op     | Name         | Notes |
|--------|--------------|-------|
| `0x15` | SETTING_15   | Unknown; observed `0x17` |
| `0x19` | SETTING_19   | Unknown; observed `0x06` |
| `0x1A` | SETTING_1A   | Unknown; observed `0x03` |
| `0x1B` | SETTING_1B   | Unknown; observed `0x0C` |
| `0x1C` | SETTING_1C   | Unknown; observed `0x10` |
| `0x27` | SETTING_27   | Unknown; observed `0x1E` |

---

## Multi-Step Sequences

### Start recording

```
TX: 55 AA 01 03    startRecord step 1
TX: 55 AA 01 21    startRecord step 2
RX: AA 55 0F 03 <filename>   REC_STARTED
```

### Stop recording + auto file sync

```
TX: 55 AA 01 04                          stopRecord
RX: AA 55 13 04 <filename> <size_BE4>    REC_STOPPED
TX: 55 AA 01 22                          stopRecord ACK  (sent automatically by app)
TX: 55 AA 13 07 00 00 00 00 <filename>   syncFile        (sent automatically by app)
RX: AA 55 13 07 <filename> <size_BE4>    SYNC_ACK
-- file packets on 204a --
RX: AA 55 01 09                          SYNC_COMPLETE
TX: 55 AA 01 08                          cancelFileTransfer
RX: AA 55 01 FD                          STOP_SYNC_ACK
```

### File list request

```
TX: 55 AA 01 05    getFileList
RX: AA 55 13 05 <filename> <size_BE4>   FILE_ENTRY  (one per file)
...
RX: AA 55 01 06                         FILE_LIST_END
```

---

## File Sync Protocol

File-sync packets arrive on `204a` (identified by `data[0] != 0x9C`).

### Packet header (bytes 0–9)

| Bytes  | Field           | Notes |
|--------|-----------------|-------|
| `0..1` | `52 58`         | Preamble (`RX`) |
| `2..5` | position        | uint32 BE; increments by `dataLength` each packet |
| `6`    | dataLength      | Audio bytes in this packet; `0xF0` = full (240B), less = last packet |
| `7`    | firstChecksum   | Byte-sum checksum (not fully verified) |
| `8..9` | audioChecksum   | uint16 BE byte-sum of audioData |
| `10..` | audioData       | `dataLength` bytes |

### Assembled stream layout

After collecting all `audioData` bytes:

| Range        | Content |
|--------------|---------|
| `[0..9]`     | `recolx.ai\x01` — 10-byte app-level marker, strip before decoding |
| `[10..521]`  | SBC frames XOR'd with `0x55` — decode with `^ 0x55` to get standard SBC (`0x9C` sync) |
| `[522..end]` | Raw SBC frames, `0x9C` sync, no transform needed |

---

## Audio Format

- **Live stream** (`204a`, `data[0] == 0x9C`): raw SBC frames, 40 bytes each
- **File sync** (`204a`, decoded): SBC — same codec, same parameters
- Each BLE notify = one SBC frame (40 bytes)

---

## DRM Bypass (PairIP)

`ai.recolx.app` uses PairIP license enforcement via `LicenseContentProvider`, registered in `AndroidManifest.xml`. On app launch the provider auto-starts and kills the process if not licensed.

**Patch**: remove the provider and activity from `AndroidManifest.xml` before Frida gadget injection:

```xml
<!-- Remove these two lines from the manifest -->
<activity android:exported="false" android:name="com.pairip.licensecheck.LicenseActivity"/>
<provider android:authorities="ai.recolx.app.com.pairip.licensecheck.LicenseContentProvider"
          android:exported="false"
          android:name="com.pairip.licensecheck.LicenseContentProvider"/>
```

**Toolchain**:
1. `apktool d base.apk -o decoded/`
2. Edit `decoded/AndroidManifest.xml` — remove both PairIP entries
3. `apktool b decoded/ -o base.nopairip.apk`
4. `objection patchapk -s base.nopairip.apk` → `base.nopairip.objection.apk`
5. Sign splits with objection keystore, `adb install-multiple`
