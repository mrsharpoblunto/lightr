const i2c = require('i2c-bus');
const i2cBus = i2c.openSync(1);
const Oled = require('oled-i2c-bus');
const font = require('oled-font-5x7');

class UIRenderer {
  constructor() {
    this.oled = new Oled(i2cBus, {
      width: 128,
      height: 64,
      address: 0x3C
  }); 
    this.renderers = {};
    this.currentMode = null;
    this.currentState = null;
  }
  addRenderer(mode, renderer) {
    this.renderers[mode] = renderer;
    return this;
  }
  render(newMode, newState) {
      if (newMode !== this.currentMode) {
        this.currentState = null;
      }

			try {
        const renderer = this.renderers[newMode];
        renderer(this.currentState, newState, this.oled);
        this.currentState = newState;
			} catch (err) {
        console.log(err.stack);
				process.exit(1);
			}

      this.currentMode = newMode;
  }
}

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

process.on('uncaughtException', (err) => {
  console.error(err.stack);
  process.exit(1);
});

const uiRenderer = new UIRenderer()
  .addRenderer('lightgroup_control', (prev,next, oled) => {
    if (prev && JSON.stringify(next) === JSON.stringify(prev)) {
      return;
    }
    if (!prev) {
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

    if (!prev || prev.on !== next.on) { 
      oled.setCursor(38, 1);
      oled.writeString(font, 1, next.on ? 'On ': 'Off', 1, false);
    }

    const getProgress = (value, max) => {
      return Math.max(0, Math.round((Math.min(value, max) / max) * (127-15)));
    };

    if (!prev || prev.hue !== next.hue) {
      oled.fillRect(14, 18, 127, 14, 1);
      let hProgress = getProgress(next.hue, 65535.0);
      oled.fillRect(15 + hProgress, 19, (127-15-hProgress), 12, 0);
    }

    if (!prev || prev.sat !== next.sat) {
      oled.fillRect(14, 34, 127, 14, 1);
      let sProgress = getProgress(next.sat, 254.0);
      oled.fillRect(15 + sProgress, 35, (127-15-sProgress), 12, 0);
    }

    if (!prev || prev.bri !== next.bri) {
      oled.fillRect(14, 50, 127, 14, 1);
      let lProgress = getProgress(next.bri, 254.0);
      oled.fillRect(15 + lProgress, 51, (127-15-lProgress), 12, 0);
    }

    oled.update();
  }).addRenderer('lightgroup_select', (prev, next, oled) => {
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      return;
    }

    oled.stopScroll();
    oled.dimDisplay(false);
    oled.clearDisplay(false);

    const selectedIndex = next.selected;
    const start = Math.max(0, selectedIndex - 2);
    const end = Math.min(next.options.length, start + 5);

    oled.setCursor(1, 1);
    oled.writeString(font, 1, 'Choose light group:', false);
    let i = 0;
    for (let index = start; index < end; ++index) {
      if (index === selectedIndex) {
        oled.setCursor(1, 18  + (8 * i));
        oled.writeString(font, 1, '>', false);
      }
      oled.setCursor(8, 18 + (8 * i++));
      oled.writeString(font,1, next.options[index].value, 1, false);
    }

    oled.update();
  }).addRenderer('clock', (prev, next, oled) => {
    if (prev && next.getMinutes() === prev.getMinutes()) {
      return;
    }
    oled.clearDisplay(false);
    oled.setCursor(1, 1);
    oled.writeString(font, 1, getDay(next) + ' ' + getMonth(next) + ' ' + next.getDate(), 1, false);
    oled.setCursor(11, 22);
    oled.writeString(font, 4, next.getHours().toString().padStart(2,'0') + ':' + next.getMinutes().toString().padStart(2,'0'), 1, false);
    oled.update();

    if (!prev) {
      oled.startScroll('left', 0,1);
      oled.dimDisplay(true);
    }
  });

const IDLE_TIME = 10000;
let queuedMessage = null;
let idleStart = Date.now();

process.on('message', (message) => {
	// rendering is real slow, so keep just the last UI state change around
	// and ignore intermediary changes.
	if (queuedMessage === null) {
		// defer until the next tick so we give the process time to empty out
		// any pending messages  before hogging the main thread again
		process.nextTick(() => {
			const m = queuedMessage;
			queuedMessage = null;
      uiRenderer.render(m.mode, m.state);
			idleStart = Date.now();
		});
	}
	queuedMessage = message;
});

setInterval(() => {
	if (Date.now() - idleStart > IDLE_TIME) {
    uiRenderer.render('clock', new Date());
	}
}, 1000);

