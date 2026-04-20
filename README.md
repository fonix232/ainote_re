# AI Note/Voice Recorder - Reverse Engineering

The market has been flooded by a variety of AI (voice) recorders/note takers in all sorts of form factors and specifications.

These devices share quite a few characteristics: at the core, they're a simple Bluetooth/WiFi connected set of microphones with 16/32/64GB of storage, a battery, and optionally a display. The "AI" part generally comes from a cloud service connected to these devices.

And this service is the core of the problem I have with these otherwise useful devices: you don't know where your data goes, what happens to it, to whom it's sold, and so on. Yet, the devices are advertised as a perfect addition to corporate workflows, potentially exfiltrating business secrets to competition (or allowing those secrets to be sold to the competition).

The only truly secure AI pipeline is one you have absolute control over, from the first moment the voice recording enters it, to the point where the pipeline spits out transcriptions, summarisations, transformations, and plethora other, useful output.

The goal of this repository is to analyse a variety of these devices, reverse engineer their protocols, and pull them into an open ecosystem - much like the awesome people over at omi.me have done.

## Hardware

While the number of device variations is pretty big, these devices are actually fairly standardised, with only a handful of options for MCUs and protocols.

### MCUs

During my research, I've identified a handful of primary manufacturers for the MCUs used in these devices:

- Nordic Semiconductor - surprisingly, a handful of devices (including the aforementioned Omi) utilise nRF MCUs, usually with custom protocols
- Espressif - especially the ESP32-C3 seems to be a popular choice, probably due to its well documented tooling, powerful RISC-V core, and support for BLE _and_ WiFi connectivity
- JieLi - a Chinese MCU manufacturer specialising in Bluetooth and audio processing
- Actions Technology - a Chinese fabless manufacturer, also specialising in Bluetooth and audio

## Devices

The following devices have been so far targeted for RE:

### NanoRec

This one's a straight up copy of the Plaud Note, in design, with a few minor changes.

- Manufacturer: Shenzhen Zhixin Electronic Technology (Honor brand)
- Model: AI Voice Recorder A3
- FCCID: 2BH9P-RECZXA3
- MCU: ActionsTech ATS3085
- Protocol: XLX 3085 (A0 0A variant)
- App: Doway
- Features:
  - Slide to Record
  - OLED display
  - Built-in MagSafe magnetic attachment (no charging!)
  - USB-C connector on top
  - dual MEMS microphone on top

The hardware build is quite solid, though the OLED display, as usual, is somewhat low resolution. The entire exterior build mimics the Plaud Note, from the vertical striping through the arrangement of the slide-to-record and power buttons.

The microphones are aimed towards the top of the device, which may make for an awkward angling for good quality recording in a larger room.

The built-in MagSafe ring means it requires no extra pouches, packages, etc. to attach to any MagSafe-enabled device.

### [Zhixin Voice Recorder A2]

- FCCID: 2BH9P-RECZXA2

Virtually identical to the A3, with a handful of key differences:

- no USB-C
- no MagSafe
- USB connectivity and charging occurs through a linear magnetic PoGo attachment

## Protocols

In my investigation, I've identified a handful of protocols. Some manufacturers simply rely on the MCU/ODM manufacturer's own protocols, while others develop their own.

Regardless of format, these center around a handful of features:

- Device state:
  - Usually includes static device info (MAC address, serial number, etc.)
  - Some dynamic device info (e.g. custom Bluetooth name)
  - Can include storage, connectivity, etc.
- Storage:
  - Basic storage reporting (used/free/total storage amount, in blocks or kB)
  - List of recordings (usually stored as timestamp + file size)
  - Recording management capability (sync to host, delete)
- Live stream:
  - During recording, the device will also dump a raw stream (usually SBC or PCM) over a BLE characteristic for real time processing on the host
- Settings:
  - Most devices will support at least a handful of settings (e.g. recording format, turning the indicator LED/display on and off, splitting recordings into X minute chunks, enabling/disabling the built in haptic motor, changing the recording mode between call and note, etc.)

Some devices may offer more features, some provide only basic APIs.
