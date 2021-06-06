# Lightr

Control Philips Hue smart lights in a room with a Raspberry Pi and rotary encoder switches. Each switch controls the Hue, Saturation, & Lightness of a particular light.

![Showing colors changing](/lightr.gif)

## Software

- Copy/clone the source across to a Raspberry Pi running Raspbian
- Get the IP and a user id from your Philips Hue Bridge (Guide [here](https://developers.meethue.com/develop/get-started-2/))
- Run ```cp config.default.json config.json``` and then open config.json and ensure the Philips Hue bridge IP/UserId are set
- Run ```sudo scripts/install_deps.sh``` from the source root folder
- Run ```npm install```
- Run ``sudo systemctl restart lightr```

The app should now start up (and automatically restart when the Pi is rebooted). The first screen will give you an option to select which light group it should control (You can get back to this screen laster by pressing the toggle buttons in the order 3-2-1-2-3-1).

## Hardware

- 3x rotary encoder switches [Amazon](https://www.amazon.com/gp/product/B06XQTHDRR/ref=ppx_yo_dt_b_search_asin_title?ie=UTF8&psc=1)
- 1x I2C OLED screen [Amazon](https://www.amazon.com/gp/product/B072Q2X2LL/ref=ppx_yo_dt_b_search_asin_title?ie=UTF8&psc=1)
- open up config.json and using the [pinout](https://pinout.xyz/) for your Raspberry PI wire up each rotary encoder from the GPIO pin to the following pin on the encoder as follows. So for example using the defaults, GPIO pin 6 would go to rotary encoder 3's DT pin.
 - a<x>Pin -> Encoder<x> DT
 - b<x>Pin -> Encoder<x> CLK
 - toggle<x>Pin -> Encoder<x> SW
- The I2C screen needs to be hooked up to GPIO pins 2 (SDA) & 3 (SCL)

![The assembled light controller](/assembly.jpg)

