# Mobvoi Link Protocol (TicNote Card)

> **Status**: Verified from live Frida captures and Dart source (TicNote Card, app `com.mobvoi.ainote` v3.1.1)  
> **Source app**: `com.mobvoi.ainote` (Dart AOT — `util/tools/dartBle/`)  
> **ODM**: Mobvoi (北京出门问问). The `com.mobvoi.nveasy_ble_plugin` Java package is a BLE transport shim only — all protocol logic is in Dart.

---

## GATT Profile

| Role           | UUID                                       | Properties                      |
|----------------|--------------------------------------------|---------------------------------|
| Service        | `00001910-0000-1000-8000-00805f9b34fb`     | —                               |
| Notify         | `00002bb0-0000-1000-8000-00805f9b34fb`     | Notify                          |
| Write          | `00002bb1-0000-1000-8000-00805f9b34fb`     | Write / Write-no-response       |
| OTA service    | `00239a6f-c616-89bb-3374-f05af588a7b3`     | —                               |
| OTA write      | `00239a7f-c616-89bb-3374-f15af588a7b3`     | —                               |
| OTA notify     | `00239a8f-c616-89bb-3374-f25af588a7b3`     | —                               |

**Device identification**: service UUID starts with `00001910`. BLE name prefix `TicNote`.

> **Note**: The `06068d0c-*` UUID family with ASCII `*APP#cmd#` framing seen in other Notta/NvEasy devices belongs to a **different service** unrelated to TicNote hardware. The confirmed live service on TicNote is `1910` with a binary protocol.

---

## Frame Format

Two frame types multiplex on the same notify characteristic:

### Type 01 — Command / Response

```
01 <cmd> 00 [payload...]
```

- `data[0]` = `0x01` — command frame marker
- `data[1]` = `cmd` — command byte
- `data[2]` = `0x00` — always zero
- `data[3..]` = payload (variable)

### Type 02 — Audio Stream

```
02 <sessionId:4LE> <offset:4LE> <N:1> <audioBytes:N>
```

- `data[0]` = `0x02` — audio frame marker
- `data[1..4]` = sessionId, uint32 little-endian
- `data[5..8]` = byte offset within file, uint32 little-endian
- `data[9]` = N — audio byte count in this packet
- `data[10..10+N-1]` = audio bytes (Opus-in-AVO payload)

---

## Connect / Handshake Sequence

```
TX: 01 01 00 02 01 00                           hello (step 1)
RX: 01 01 00 ...                                HANDSHAKE_HELLO_RESP (cmd=1)
TX: 01 01 00 02 01 01 <token:16> <pad:9>        token (step 2)
RX: 01 02 00 ...                                HANDSHAKE_TOKEN_RESP (cmd=2)

TX: 01 04 00                                    syncTime
TX: 01 03 00                                    getDeviceState
TX: 01 09 00                                    getBattery
TX: 01 06 00                                    getStorage
```

Token value: `"1234567890000000"` (16 ASCII bytes), followed by 9 zero-padding bytes.  
40 ms delay between each post-handshake query.

---

## Outgoing Commands (TX)

| Frame                                          | Cmd  | Name           |
|------------------------------------------------|------|----------------|
| `01 03 00`                                     | `03` | getDeviceState |
| `01 04 00`                                     | `04` | syncTime       |
| `01 06 00`                                     | `06` | getStorage     |
| `01 09 00`                                     | `09` | getBattery     |
| `01 14 00`                                     | `14` | startRecord    |
| `01 17 00`                                     | `17` | stopRecord     |
| `01 1A 00`                                     | `1A` | getFileList    |
| `01 1C <sessionId:4LE> <offset:4LE>`           | `1C` | syncFile       |
| `01 1D 00`                                     | `1D` | stopSync       |

---

## Incoming Events (RX)

All command responses have `data[0]=0x01`, dispatch on `data[1]` (cmd byte), payload at `data[3..]`.

| Cmd  | Name                 | Payload fields |
|------|----------------------|----------------|
| `01` | HANDSHAKE_HELLO_RESP | — |
| `02` | HANDSHAKE_TOKEN_RESP | — |
| `03` | DEVICE_STATE         | (not yet decoded) |
| `04` | SYNC_TIME_ACK        | — |
| `06` | STORAGE              | `[0..3]` used bytes LE uint32, `[4..7]` total bytes LE uint32 |
| `09` | BATTERY              | `[0]` charging (`1`=yes), `[1]` percent |
| `14` | REC_START            | `[0..3]` sessionId LE uint32 |
| `15` | REC_STOP_RESP        | — |
| `16` | REC_PAUSE            | — |
| `17` | REC_STOP             | — |
| `1A` | FILE_LIST            | `[0..3]` unknown, `[4..7]` count LE, then `count×8` bytes: `[0..3]`=sessionId LE, `[4..7]`=size LE |
| `1C` | SYNC_ACK             | — |
| `1D` | SYNC_CRC             | signals transfer complete |
| `1E` | SYNC_END             | signals transfer complete |
| `21` | CMD_ERROR            | — |
| `22` | CMD_ACK              | — |

> File entries use sessionId as the file identifier; treated as a Unix timestamp (seconds).

---

## Multi-Step Sequences

### Start recording (device-initiated push)

The device sends `REC_START` (cmd `14`) when it begins recording (e.g. button press). The app responds by requesting the live audio stream:

```
RX: 01 14 00 <sessionId:4LE>       REC_START (device push)
TX: 01 1C <sessionId:4LE> 00 00 00 00   syncFile offset=0
-- type-02 audio frames arrive --
```

### Stop recording

```
TX: 01 17 00                        stopRecord
TX: 01 1D 00                        stopSync
RX: 01 17 00                        REC_STOP (device push)
```

### File download

```
TX: 01 1A 00                        getFileList
RX: 01 1A 00 <payload>              FILE_LIST

TX: 01 1C <sessionId:4LE> <offset:4LE>   syncFile
-- type-02 audio frames arrive --
RX: 01 1D 00  or  01 1E 00          SYNC_CRC or SYNC_END → transfer complete
```

---

## Audio Format

- **Format**: Opus-in-AVO container
- **Live stream**: 40-byte chunks, buffered until a full AVO frame is assembled
- **File download**: all audio bytes from type-02 packets concatenated in order, trimmed to the file's declared size

No delete command exists in the BLE protocol.

---

## OTA

Commands `50` / `51` / `52` (`setOta` / `setOtaData` / `setOtaFinish`) use the OTA service UUIDs above. Wire format not yet determined.
