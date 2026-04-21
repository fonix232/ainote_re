# AI Note/Voice Recorder - Reverse Engineering

The market has been flooded by a variety of AI (voice) recorders/note takers in all sorts of form factors and specifications.

These devices share quite a few characteristics: at the core, they're a simple Bluetooth/WiFi connected set of microphones with 16/32/64GB of storage, a battery, and optionally a display. The "AI" part generally comes from a cloud service connected to these devices.

And this service is the core of the problem I have with these otherwise useful devices: you don't know where your data goes, what happens to it, to whom it's sold, and so on. Yet, the devices are advertised as a perfect addition to corporate workflows, potentially exfiltrating business secrets to competition (or allowing those secrets to be sold to the competition).

The only truly secure AI pipeline is one you have absolute control over, from the first moment the voice recording enters it, to the point where the pipeline spits out transcriptions, summarisations, transformations, and plethora other, useful output.

The goal of this repository is to analyse a variety of these devices, reverse engineer their protocols, and pull them into an open ecosystem - much like the awesome people over at omi.me have done.

## Hardware

While the number of device variations is pretty big, these devices are actually fairly standardised, with only a handful of options for MCUs and protocols.

## Devices

The following devices have been so far targeted for RE:

### Recolx AI

- Manufacturer:
- Model:
- FCCID: 

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
