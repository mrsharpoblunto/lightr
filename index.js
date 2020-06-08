const EventEmitter = require('events').EventEmitter;
const Gpio = require('onoff').Gpio;
const http = require('http');


class RotaryEncoder extends EventEmitter {
	constructor({a,b,toggle, inc}) {
		super();
		this.inc = inc;
		this.gpioA = new Gpio(a, 'in', 'both');
		this.gpioB = new Gpio(b, 'in', 'both');
		this.gpioToggle = new Gpio(toggle, 'in', 'rising');
		this.gpioA.watch((err, value) => {
			this.a = value;
		});
		this.gpioB.watch((err, value) => {
			this.b = value;
			this.tick();
		});
		this.gpioToggle.watch((err, value) => {
			this.emit('toggle');
		});
	}
	tick() {
		const {a,b} = this;

		if (a == 0 && b === 0 || a === 1 && b === 1) {
			this.emit('rotation', this.inc);
		} else if (a === 1 && b === 0 || a === 0 && b === 1 || a === 2 && b === 0) {
			this.emit('rotation', -this.inc);
		}
	}
}

class HueAPI {
	constructor(bridge, user) {
		this.bridge = bridge;
		this.user = user;
	}
	getGroup(groupId) {
		return this._httpGet('/groups/' + groupId);
	}
	putGroup(groupId, data) {
		return this._httpPut('/groups/' + groupId + '/action', data);
	}
	_httpGet(path) {
		return new Promise((resolve, reject) => {
			http.get({
				host: this.bridge,
				port: 80,
				path: '/api/' + this.user + path
			}, res => {
				res.setEncoding('utf8');
				let body = '';
				res.on('data', data => {
					body += data;
				});
				res.on('end', () => {
					body = JSON.parse(body);
					resolve(body);
				});
			}).on('error', (e) => {
				reject(e);
			});
		});
	}
	_httpPut(path, data) {
		return new Promise((resolve, reject) => {
			const req = http.request({
				host: this.bridge,
				port: 80,
				method: 'PUT',
				path: '/api/' + this.user + path,
				headers: { 'Content-Type': 'application/json' }
			}, res => {
				res.setEncoding('utf8');
				let body = '';
				res.on('data', data => {
					body += data;
				});
				res.on('end', () => {
					body = JSON.parse(body);
					resolve(body);
				});
			});
			req.on('error', (e) => {
				reject(e);
			});
			req.write(JSON.stringify(data));
			req.end();
		});
	}
}

function throttlePromise(fn,delay) {
	let running = false;
	let waiting = false;
	let start = Date.now();
	let lastArgs = null;
	let lastThis = null;
	const completed = function() {
		if (lastArgs != null) {
			const nextArgs = lastArgs;
			const nextThis = lastThis;
			lastArgs = null;
			lastThis = null;
			throttled.apply(nextThis, nextArgs);
		}
	};
	const throttled = function(...args) {
		if (running || waiting) {
			lastThis = this;
			lastArgs = args;
			return;
		}
		running = true;
		if (delay) {
			waiting = true;
			const t = setTimeout(() => {
				waiting = false;
				if (!running) {
					completed();
				}
			}, delay);
		}
		fn.apply(this, args).then((response) => {
			running = false;
			if (!waiting) {
				completed();
			}
		}).catch((e) => {
			running = false;
			if (!waiting) {
				completed();
			}
		});
	};
	return throttled;
}

const bridge = '192.168.0.4';
const userId = 'O7nK3Cv1WUSGeOtiuzWbPCsxbjxCdIwmRFWPo72Z';
const api = new HueAPI(bridge, userId);
api.getGroup(7).then(group => {
	console.log(group);
	let on = group.action.on;
	let waiting = false;
	const encoder = new RotaryEncoder({
		a: 17,
		b: 18,
		toggle: 27, 
		inc: 32
	});
	encoder.on('rotation', throttlePromise((value) => {
		return api.putGroup(7, {
			bri_inc: value
		}).then(response => {
			console.log(response);
		});
	}, 500));
	encoder.on('toggle', throttlePromise(() => {
		on = !on;
		return api.putGroup(7, {
			on: on
		}).then(response => {
			console.log(response);
		});
	}));
});



