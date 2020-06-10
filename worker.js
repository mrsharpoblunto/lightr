const i2c = require('i2c-bus');
const i2cBus = i2c.openSync(1);
const Oled = require('oled-i2c-bus');
const font = require('oled-font-5x7');

function getDay(date) {
	switch (date.getDay()) {
		case 0:
			return 'Sunday';
		case 1:
			return 'Monday';
		case 2:
			return 'Tuesday';
		case 3: 
			return 'Wednesday';
		case 4:
			return 'Thursday';
		case 5:
			return 'Friday';
		case 6: 
			return 'Saturday';
	}
}

function getMonth(date) {
	switch (date.getMonth()) {
		case 0:
			return 'January';
		case 1:
			return 'February';
		case 2:
			return 'March';
		case 3: 
			return 'April';
		case 4:
			return 'May';
		case 5:
			return 'June';
		case 6: 
			return 'July';
		case 7: 
			return 'August';
		case 8: 
			return 'September';
		case 9: 
			return 'October';
		case 10: 
			return 'November';
		case 11: 
			return 'December';
	}
}

const IDLE_TIME = 10000;
const oled = new Oled(i2cBus, {
	  width: 128,
	  height: 64,
	  address: 0x3C
}); 
let queuedMessage = null;
let idleStart = Date.now();
let prevTime = null;
let prevState = null;

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
				// don't redraw if the state is the same as it was previously
				if (!prevState || JSON.stringify(m) !== JSON.stringify(prevState)) {
					if (!prevState) {
						oled.stopScroll();
						oled.dimDisplay(false);
						oled.clearDisplay(false);
						oled.setCursor(1, 1);
						oled.writeString(font, 1, 'Light: ', 1, false);
						oled.setCursor(1, 18);
						oled.writeString(font, 2, 'H', 1, false);
						oled.setCursor(1, 34);
						oled.writeString(font, 2, 'S', 1, false);
						oled.setCursor(1, 50);
						oled.writeString(font, 2, 'L', 1, false);
					}

					if (!prevState || prevState.on !== m.on) { 
						oled.setCursor(38, 1);
						oled.writeString(font, 1, m.on ? 'On ': 'Off', 1, false);
					}

					const getProgress = (value, max) => {
						return Math.max(0, Math.round((Math.min(value, max) / max) * (127-15)));
					};

					if (!prevState || prevState.hue !== m.hue) {
						oled.fillRect(14, 18, 127, 14, 1);
						let hProgress = getProgress(m.hue, 65535.0);
						oled.fillRect(15 + hProgress, 19, (127-15-hProgress), 12, 0);
					}

					if (!prevState || prevState.sat !== m.sat) {
						oled.fillRect(14, 34, 127, 14, 1);
						let sProgress = getProgress(m.sat, 254.0);
						oled.fillRect(15 + sProgress, 35, (127-15-sProgress), 12, 0);
					}

					if (!prevState || prevState.bri !== m.bri) {
						oled.fillRect(14, 50, 127, 14, 1);
						let lProgress = getProgress(m.bri, 254.0);
						oled.fillRect(15 + lProgress, 51, (127-15-lProgress), 12, 0);
					}

					oled.update();

					prevState = m;
				}
			} catch (err) {
				process.exit(1);
			}

			prevTime = null;
			idleStart = Date.now();
		});
	}
	queuedMessage = message;
});

setInterval(() => {
	if (Date.now() - idleStart > IDLE_TIME) {
		prevState = null;
		const now = new Date();
		try {
			if (!prevTime || now.getMinutes() !== prevTime.getMinutes()) {
				oled.clearDisplay(false);
				oled.setCursor(1, 1);
				oled.writeString(font, 1, getDay(now) + ' ' + getMonth(now) + ' ' + now.getDate(), 1, false);
				oled.setCursor(11, 22);
				oled.writeString(font, 4, now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'), 1, false);
				oled.update();
			}
			if (!prevTime) {
				oled.startScroll('left', 0,1);
				oled.dimDisplay(true);
			}
		} catch (err) {
			process.exit(1);
		}
		prevTime = now;
	}
}, 1000);
