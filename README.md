# Lightr
Control Hue lights in a room with a Raspberry Pi and roatry encoder switches

# Running
- Copy/clone the source across to a Raspberry Pi running Raspbian
- Run ```cp config.default.json config.json``` and then open config.json and ensure the Philips Hue bridge IP/UserId & GPIO pin configuration matches the GPIO connections you've set up
- Run ```sudo scripts/install_deps.sh``` from the source root folder
- Run ```npm install```
- Run ``sudo systemctl restart lightr```

The app should now start up (and automatically restart when the Pi is rebooted). The first screen will give you an option to select which light group it should control (You can get back to this screen laster by pressing the toggle buttons in the order 3-2-1-2-3-1).
