const i2c = require('i2c-bus');
const i2cBus = i2c.openSync(1);
const Oled = require('oled-i2c-bus');
const font = require('oled-font-5x7');
const oled = new Oled(i2cBus, {
	  width: 128,
	  height: 64,
	  address: 0x3C
});

let queuedMessage = null;
process.on('message', (message) => {
	// rendering is real slow, so keep just the last UI state change around
	// and ignore intermediary changes.
	if (queuedMessage === null) {
		// defer until the next tick so we give the process time to empty out
		// any pending messages  before hogging the main thread again
		process.nextTick(() => {
			const m = queuedMessage;
			queuedMessage = null;
			try {
				oled.clearDisplay(false);
				oled.setCursor(1, 1);
				oled.writeString(font, 1, 'Light: ' + (m.action.on ? 'On': 'Off'), 1, false);
				oled.setCursor(1, 18);
				oled.writeString(font, 1, 'H: ' + m.action.hue, 1, false);
				oled.setCursor(1, 28);
				oled.writeString(font, 1, 'S: ' + m.action.sat, 1, false);
				oled.setCursor(1, 38);
				oled.writeString(font, 1, 'L: ' + m.action.bri, 1, false);
				oled.update();
			} catch (err) {
				process.exit(1);
			}
		});
	}
	queuedMessage = message;
});
