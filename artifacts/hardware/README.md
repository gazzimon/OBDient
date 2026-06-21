# Hardware proof

OBDient runs on **real consumer hardware** (Mobile track requirement). The primary
proof is in the [demo video](../README.md#-demo-video), which shows the physical
phone pairing with the ELM327 adapter and pulling live data from the car.

## Setup shown

| Component | Detail |
|-----------|--------|
| Phone | Physical Android device (Android 10+, Bluetooth Classic) |
| Adapter | ELM327 Bluetooth Classic — chip PIC18F25K80, firmware 1.5, SPP protocol |
| Vehicle | Connected via the standard OBD-II port |
| Pairing | Android Bluetooth, PIN `1234` |

> Bluetooth Classic and the QVAC Bare runtime do **not** work on the Android
> emulator or Expo Go — this can only run on a real phone.

## Stills

Add one or more frames from the demo video here as proof images, e.g.:

- `setup.jpg` — phone + ELM327 plugged into the car's OBD-II port.
- `dashboard.jpg` — live data streaming on the device.

_(Drop the image files in this folder and reference them above.)_
